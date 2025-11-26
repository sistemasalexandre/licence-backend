// server/routes.js
// Substitua todo o arquivo por este conteúdo

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// supabase client (criado a partir das envs)
const { createClient } = require('@supabase/supabase-js');

// stripe (opcional)
let stripe = null;

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch(e) { return '{}'; }
}

function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

/* ---------------------------
   Init: cria clientes usando env vars
   (Chamado automaticamente quando o módulo é require()d)
----------------------------*/
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY || null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE not set in environment. Many routes will fail.');
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE || '');

if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe');
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('Stripe initialized in routes.js');
} else {
  console.log('Stripe not configured (STRIPE_SECRET_KEY missing) in routes.js');
}

/* use JSON for router requests (webhook uses raw below) */
router.use(express.json());

/* -------------------------
   Register
------------------------- */
router.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    // checa se já existe
    const { data: exists, error: selErr } = await supabase
      .from('users')
      .select('id,email')
      .eq('email', email)
      .limit(1);

    if (selErr) {
      console.error('Supabase SELECT error (register):', selErr);
      return res.status(500).json({ error: selErr.message || 'Supabase error' });
    }

    if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe.' });

    // hash da senha
    const hash = await bcrypt.hash(password, 10);

    const payload = { email, password_hash: hash, created_at: new Date().toISOString() };
    if (name) payload.name = name;

    const { data: inserted, error: insertErr } = await supabase.from('users').insert([payload]).select('id,email').single();
    if (insertErr) {
      console.error('Supabase INSERT error (register):', insertErr);
      return res.status(500).json({ error: insertErr.message || 'Erro ao inserir usuário' });
    }

    return res.json({ ok: true, user: { id: inserted.id, email: inserted.email } });
  } catch (err) {
    console.error('REGISTER error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Login
------------------------- */
router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const { data, error: selErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (selErr) {
      console.error('Supabase SELECT error (login):', selErr);
      return res.status(500).json({ error: selErr.message || 'Supabase error' });
    }

    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });

    const check = await bcrypt.compare(password, user.password_hash);
    if (!check) return res.status(401).json({ error: 'Senha incorreta.' });

    // busca licença vinculada (se houver)
    const { data: lic, error: licErr } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (licErr) {
      console.error('Supabase SELECT error (login -> user_licenses):', licErr);
      // não falha por completo, retorna hasLicense=false
    }

    return res.json({
      ok: true,
      hasLicense: Array.isArray(lic) && lic.length > 0,
      user: { email }
    });
  } catch (err) {
    console.error('LOGIN error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Activate license (manual)
------------------------- */
router.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'E-mail e código obrigatórios.' });

    // procura licença pelo código (code)
    const { data: licRows, error: licErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', code)
      .limit(1);

    if (licErr) {
      console.error('Supabase SELECT error (activate):', licErr);
      return res.status(500).json({ error: licErr.message || 'Supabase error' });
    }

    const license = licRows && licRows[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada.' });

    if (license.status && !['available','reserved','unused'].includes(license.status)) {
      return res.status(400).json({ error: 'Licença não disponível.' });
    }

    const licenseKey = license.license_key ?? license.code;

    // evita duplicata
    const { data: exists, error: exErr } = await supabase
      .from('user_licenses')
      .select('id')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);

    if (exErr) {
      console.error('Supabase SELECT error (activate -> user_licenses):', exErr);
      return res.status(500).json({ error: exErr.message || 'Supabase error' });
    }

    if (!exists || !exists.length) {
      const { error: insErr } = await supabase
        .from('user_licenses')
        .insert([{ user_email: email, license_key: licenseKey, activated_at: new Date().toISOString() }]);
      if (insErr) {
        console.error('Supabase INSERT error (user_licenses):', insErr);
        return res.status(500).json({ error: insErr.message || 'Erro ao inserir user_license' });
      }
    }

    // atualiza a licença para used / assigned
    const { error: updErr } = await supabase
      .from('licenses')
      .update({ status: 'used', used_by: email, used_at: new Date().toISOString() })
      .eq('code', code);

    if (updErr) {
      console.error('Supabase UPDATE error (licenses):', updErr);
      return res.status(500).json({ error: updErr.message || 'Erro ao atualizar licença' });
    }

    return res.json({ ok: true, message: 'Licença ativada' });
  } catch (err) {
    console.error('ACTIVATE-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   has-license (GET)
------------------------- */
router.get('/api/has-license', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email é necessário' });

    const { data: ul, error } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (error) {
      console.error('Supabase (has-license):', error);
      return res.status(500).json({ error: error.message || 'Supabase error' });
    }

    return res.json({ ok: true, hasLicense: !!(ul && ul.length) });
  } catch (err) {
    console.error('HAS-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Create Checkout Session (Stripe)
------------------------- */
router.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado.' });

    const { priceId, successUrl, cancelUrl, userEmail } = req.body;
    if (!priceId || !successUrl) return res.status(400).json({ error: 'priceId e successUrl são necessários.' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: userEmail,
      success_url: successUrl,
      cancel_url: cancelUrl || successUrl
    });

    return res.json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('CREATE-CHECKOUT error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Webhook Stripe (raw body)
------------------------- */
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) {
      console.warn('Webhook received but stripe not configured.');
      return res.status(200).send({ received: true });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed.', err?.message || err);
      return res.status(400).send(`Webhook Error: ${err?.message || 'invalid signature'}`);
    }

    // tratar checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = (session.customer_email || (session.metadata && session.metadata.email) || '').toLowerCase();
      if (!email) {
        console.warn('checkout.session.completed without customer_email, ignoring.');
        return res.status(200).send({ received: true });
      }

      try {
        // tenta achar user
        const { data: userRows } = await supabase
          .from('users')
          .select('id,email')
          .eq('email', email)
          .limit(1);

        let userId = null;
        if (!userRows || !userRows.length) {
          // cria usuário placeholder
          const dummy = { email, password_hash: 'stripe-created', created_at: new Date().toISOString() };
          const { data: insUser, error: insErr } = await supabase.from('users').insert([dummy]).select('id').single();
          if (!insErr && insUser) userId = insUser.id;
        } else {
          userId = userRows[0].id;
        }

        // cria licença
        const licenseKey = genLicenseCode();
        const productId = session.metadata?.product_id || null;

        const { error: licErr } = await supabase.from('licenses').insert([{
          user_id: userId,
          license_key: licenseKey,
          product_id: productId,
          purchased_at: new Date().toISOString(),
          active: true,
          status: 'used',
          used_by: email,
          code: licenseKey // preenche code para compatibilidade
        }]);
        if (licErr) console.error('Erro ao inserir licença no webhook:', licErr);

        const { error: ulErr } = await supabase.from('user_licenses').insert([{
          user_email: email,
          license_key: licenseKey,
          assigned_at: new Date().toISOString()
        }]);
        if (ulErr) console.error('Erro ao inserir user_licenses no webhook:', ulErr);

        // marca usuário como não-demo (opcional)
        const { error: upUserErr } = await supabase.from('users').update({ is_demo: false }).eq('email', email);
        if (upUserErr) console.error('Erro ao atualizar user.is_demo no webhook:', upUserErr);

        console.log(`License created for ${email} via webhook, key ${licenseKey}`);
      } catch (procErr) {
        console.error('Error processing checkout.session.completed:', procErr);
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('WEBHOOK top-level error:', err);
    return res.status(500).send(`Erro interno: ${err?.message || safeJson(err)}`);
  }
});

/* Health */
router.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
