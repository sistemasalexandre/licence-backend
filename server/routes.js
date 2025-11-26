// server/routes.js
// Versão final: router + init + endpoints usados pelo frontend

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let supabase = null;
let stripe = null;

/**
 * init(deps) - injete dependências do index.js
 * Exemplo (no index.js): const { router, init } = require('./routes'); init({ supabase, stripe });
 */
function init(deps = {}) {
  if (deps.supabase) supabase = deps.supabase;
  if (deps.stripe) stripe = deps.stripe;
  console.log('init() executado em routes com supabase e stripe.');
}

/* ---------------------------
   Middlewares
--------------------------- */
router.use(express.json()); // JSON normal
// webhook usará bodyParser.raw quando necessário

/* ---------------------------
   Helpers
--------------------------- */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}

/* ===========================
   ROUTES
   Base: /api/...
   =========================== */

/* HEALTH */
router.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* REGISTER */
router.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const { data: exists, error: selErr } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1);

    if (selErr) throw selErr;
    if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe.' });

    const hash = await bcrypt.hash(password, 10);
    const payload = { email, password_hash: hash, created_at: new Date().toISOString() };
    if (name) payload.name = name;

    const { data, error: insertErr } = await supabase.from('users').insert([payload]).select('id,email').single();
    if (insertErr) throw insertErr;

    return res.json({ ok: true, user: data });
  } catch (err) {
    console.error('REGISTER error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* LOGIN */
router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const { data, error: selErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (selErr) throw selErr;
    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });

    const { data: lic, error: licErr } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (licErr) console.warn('login -> user_licenses err:', licErr);

    return res.json({
      ok: true,
      hasLicense: Array.isArray(lic) && lic.length > 0,
      user: { id: user.id, email: user.email }
    });
  } catch (err) {
    console.error('LOGIN error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* VERIFY-LICENSE (usado pelo frontend antes de vincular) */
router.post('/api/verify-license', async (req, res) => {
  try {
    const { license, email } = req.body;
    if (!license) return res.status(400).json({ valid: false, error: 'license required' });

    const { data: licRows, error: licErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', license)
      .limit(1);

    if (licErr) throw licErr;
    const licenseRow = licRows && licRows[0];
    if (!licenseRow) return res.json({ valid: false });

    // consider available/reserved as valid, used = invalid
    const ok = !licenseRow.status || licenseRow.status === 'available' || licenseRow.status === 'reserved' || licenseRow.status === 'unused';
    return res.json({ valid: !!ok, license: licenseRow });
  } catch (err) {
    console.error('VERIFY-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* ACTIVATE LICENSE (manual) */
router.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'E-mail e código obrigatórios.' });

    const { data: lic, error: licErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', code)
      .limit(1);

    if (licErr) throw licErr;
    const license = lic && lic[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada.' });

    // status allowed
    if (license.status && !['available','reserved','unused'].includes(license.status)) {
      return res.status(400).json({ error: 'Licença já utilizada.' });
    }

    const licenseKey = license.license_key ?? license.code;

    // evitar duplicar associação
    const { data: exists, error: exErr } = await supabase
      .from('user_licenses')
      .select('id')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);

    if (exErr) throw exErr;

    if (!exists || !exists.length) {
      const { error: insErr } = await supabase
        .from('user_licenses')
        .insert([{ user_email: email, license_key: licenseKey, activated_at: new Date().toISOString() }]);
      if (insErr) throw insErr;
    }

    // atualiza licença (status, used_by, used_at)
    const { error: updErr } = await supabase
      .from('licenses')
      .update({
        status: 'used',
        used_by: email,
        used_at: new Date().toISOString()
      })
      .eq('code', code);

    if (updErr) throw updErr;

    return res.json({ ok: true, message: 'Licença ativada' });
  } catch (err) {
    console.error('ACTIVATE-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* HAS-LICENSE (checar por e-mail) */
router.get('/api/has-license', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email é necessário' });

    const { data: ul, error } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (error) throw error;
    return res.json({ ok: true, hasLicense: !!(ul && ul.length) });
  } catch (err) {
    console.error('HAS-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* CREATE CHECKOUT (Stripe) - opcional */
router.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado.' });
    const { priceId, successUrl, cancelUrl, userEmail, product_id } = req.body;
    if (!priceId || !successUrl) return res.status(400).json({ error: 'priceId e successUrl são necessários.' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: userEmail,
      success_url: successUrl,
      cancel_url: cancelUrl || successUrl,
      metadata: { product_id: product_id || '' }
    });

    return res.json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('CREATE-CHECKOUT error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* WEBHOOK (Stripe) */
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) {
      console.warn('Webhook recebido mas stripe não está configurado.');
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = (session.customer_email || (session.metadata && session.metadata.email) || '').toLowerCase();
      if (!email) return res.status(200).send({ received: true });

      try {
        const { data: userRows } = await supabase
          .from('users')
          .select('id,email')
          .eq('email', email)
          .limit(1);

        let userId = null;
        if (!userRows || !userRows.length) {
          const dummy = { email: email, password_hash: 'stripe-created', created_at: new Date().toISOString() };
          const { data: insUser, error: insErr } = await supabase.from('users').insert([dummy]).select('id').single();
          if (!insErr) userId = insUser.id;
        } else {
          userId = userRows[0].id;
        }

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
          used_at: new Date().toISOString()
        }]);

        if (!licErr) {
          const { error: ulErr } = await supabase.from('user_licenses').insert([{
            user_email: email,
            license_key: licenseKey,
            assigned_at: new Date().toISOString()
          }]);
          if (ulErr) console.error('Erro ao inserir user_licenses no webhook:', ulErr);
        } else {
          console.error('Erro ao inserir licença no webhook:', licErr);
        }

        await supabase.from('users').update({ is_demo: false }).eq('email', email);
        console.log(`Licença criada para ${email}`);
      } catch (procErr) {
        console.error('Erro processando checkout.session.completed:', procErr);
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('WEBHOOK top-level error:', err);
    return res.status(500).send(`Erro interno: ${err?.message || safeJson(err)}`);
  }
});

/* Export */
module.exports = { router, init };
