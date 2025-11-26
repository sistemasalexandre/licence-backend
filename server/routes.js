// server/routes.js
// Versão atualizada — cole todo esse arquivo no seu projeto (substitui o anterior)

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
// Nota: supabase e stripe serão injetados via init(deps)
let supabase = null;
let stripe = null;

/**
 * Inicializa dependências injetadas pelo index.js (ou por quem importar).
 * Ex: init({ supabase: supabaseClient, stripe: stripeClient })
 */
function init(deps = {}) {
  if (deps.supabase) supabase = deps.supabase;
  if (deps.stripe) stripe = deps.stripe;
  console.log('Routes initialized. Supabase OK?', !!supabase, 'Stripe OK?', !!stripe);
}

/* ---------------------------
   Middlewares para o router
   --------------------------- */
// aceitar JSON normalmente para TODO o router (exceto webhook, que usa raw)
router.use(express.json());

/* ========================================================================
   Helpers
======================================================================== */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch(e) { return '{}'; }
}

/* ========================================================================
   ROUTES
   Todas na base /api/.... (assim bate com o que você vem testando)
======================================================================== */

/* -------------------------
   Register
------------------------- */
router.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado' });

    // checa se já existe
    const { data: exists, error: selErr } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .limit(1);

    if (selErr) {
      console.error('Supabase SELECT error (register):', selErr);
      throw selErr;
    }

    if (exists && exists.length)
      return res.status(400).json({ error: 'Usuário já existe.' });

    // hash da senha
    const hash = await bcrypt.hash(password, 10);

    const payload = { email, password_hash: hash, created_at: new Date().toISOString() };
    if (name) payload.name = name;

    const { data: inserted, error: insertErr } = await supabase.from('users').insert([payload]).select();
    if (insertErr) {
      console.error('Supabase INSERT error (register):', insertErr);
      throw insertErr;
    }

    return res.json({ ok: true, user: inserted && inserted[0] ? { id: inserted[0].id, email: inserted[0].email } : null });
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
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado' });

    const { data, error: selErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (selErr) {
      console.error('Supabase SELECT error (login):', selErr);
      throw selErr;
    }

    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });

    const check = await bcrypt.compare(password, user.password_hash);
    if (!check) return res.status(401).json({ error: 'Senha incorreta.' });

    // busca licença vinculada (se houver)
    let lic = [];
    try {
      const { data: licData, error: licErr } = await supabase
        .from('user_licenses')
        .select('*')
        .eq('user_email', email)
        .limit(1);

      if (licErr) {
        console.error('Supabase SELECT error (login -> user_licenses):', licErr);
      } else {
        lic = licData || [];
      }
    } catch (e) {
      console.error('Erro verificando user_licenses:', e);
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
   Ex: cliente envia email + code e ativa
------------------------- */
router.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: 'E-mail e código obrigatórios.' });

    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado' });

    const { data: lic, error: licErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', code)
      .limit(1);

    if (licErr) {
      console.error('Supabase SELECT error (activate):', licErr);
      throw licErr;
    }

    const license = lic && lic[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada.' });

    if (license.status !== 'available' && license.status !== 'reserved')
      return res.status(400).json({ error: 'Licença já utilizada.' });

    const licenseKey = license.license_key ?? license.code;

    const { data: exists, error: exErr } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);

    if (exErr) {
      console.error('Supabase SELECT error (activate -> user_licenses):', exErr);
      throw exErr;
    }

    if (!exists || !exists.length) {
      const { error: insErr } = await supabase
        .from('user_licenses')
        .insert([{ user_email: email, license_key: licenseKey, activated_at: new Date().toISOString() }]);
      if (insErr) {
        console.error('Supabase INSERT error (activate -> user_licenses):', insErr);
        throw insErr;
      }
    }

    const { error: updErr } = await supabase
      .from('licenses')
      .update({
        status: 'used',
        used_by: email,
        used_at: new Date().toISOString()
      })
      .eq('code', code);

    if (updErr) throw updErr;

    return res.json({ ok: true });
  } catch (err) {
    console.error('ACTIVATE-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Create Checkout Session (Stripe)
   - Expects: priceId, successUrl, cancelUrl, userEmail (optional)
   - Requires stripe inited via init({ stripe })
------------------------- */
router.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado.' });

    const { priceId, successUrl, cancelUrl, userEmail } = req.body;
    if (!priceId || !successUrl)
      return res.status(400).json({ error: 'priceId e successUrl são necessários.' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: userEmail,
      success_url: successUrl,
      cancel_url: cancelUrl || successUrl
    });

    return res.json({ url: session.url, id: session.id, session });
  } catch (err) {
    console.error('CREATE-CHECKOUT error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* ========================================================================
   WEBHOOK Stripe
   - importante: usa bodyParser.raw({ type: 'application/json' }) somente aqui
   - configure no dashboard Stripe o endpoint: https://SEU-DOMINIO/webhook
   - adicione STRIPE_WEBHOOK_SECRET nas envs do Render
======================================================================== */
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

    // tratar eventos que nos interessam
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_email || (session.metadata && session.metadata.email);

      if (!email) {
        console.warn('checkout.session.completed sem customer_email, ignorando.');
        return res.status(200).send({ received: true });
      }

      const clientEmail = email.toLowerCase();

      try {
        // - checa usuário
        const { data: userRows } = await supabase
          .from('users')
          .select('id,email')
          .eq('email', clientEmail)
          .limit(1);

        let userId = null;
        if (!userRows || !userRows.length) {
          // cria usuário "placeholder" sem senha
          const dummy = { email: clientEmail, password_hash: 'stripe-created', created_at: new Date().toISOString() };
          const { data: insUser, error: insErr } = await supabase.from('users').insert([dummy]).select('id').single();
          if (insErr) {
            console.error('Erro ao criar usuário a partir do webhook:', insErr);
          } else {
            userId = insUser.id;
          }
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
          used_by: clientEmail,
          code: licenseKey
        }]);

        if (licErr) {
          console.error('Erro ao inserir licença no webhook:', licErr);
        } else {
          // associar em user_licenses
          const { error: ulErr } = await supabase.from('user_licenses').insert([{
            user_email: clientEmail,
            license_key: licenseKey,
            assigned_at: new Date().toISOString()
          }]);
          if (ulErr) console.error('Erro ao inserir user_licenses no webhook:', ulErr);
        }

        // atualizar campo is_demo na tabela users (se existir)
        const { error: upUserErr } = await supabase.from('users').update({ is_demo: false }).eq('email', clientEmail);
        if (upUserErr) console.error('Erro ao atualizar user.is_demo no webhook:', upUserErr);

        console.log(`Licença criada para ${clientEmail} (checkout.session.completed) - chave ${licenseKey}`);
      } catch (procErr) {
        console.error('Erro processando checkout.session.completed:', procErr);
      }
    }

    // responder ao Stripe
    return res.json({ received: true });
  } catch (err) {
    console.error('WEBHOOK top-level error:', err);
    return res.status(500).send(`Erro interno: ${err?.message || safeJson(err)}`);
  }
});

/* ========================================================================
   Health-check simples
======================================================================== */
router.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ========================================================================
   Export and compatibility helpers
======================================================================== */
// Exporta o router e a função init
module.exports = { router, init };

// Também garante compatibilidade caso o index.js exija apenas `require('./routes')`
// e espere `init` disponível diretamente no objeto retornado ou global.
module.exports.default = module.exports;
global.init = init;
console.log('routes.js loaded — exported router and init; global.init set.');
