// server/routes.js
// ARQUIVO COMPLETO — VERSÃO FINAL

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Supabase e Stripe entram aqui via init(deps)
let supabase = null;
let stripe = null;

/* -------------------------------------------------------------
   Inicialização das dependências externas
------------------------------------------------------------- */
function init(deps = {}) {
  if (deps.supabase) supabase = deps.supabase;
  if (deps.stripe) stripe = deps.stripe;
}

/* -------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}

/* -------------------------------------------------------------
   Middleware JSON
------------------------------------------------------------- */
router.use(express.json());

/* =============================================================
   ROTA: Register
============================================================= */
router.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

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

    const hash = await bcrypt.hash(password, 10);

    const payload = {
      email,
      password_hash: hash,
      created_at: new Date().toISOString()
    };

    if (name) payload.name = name;

    const { error: insertErr } = await supabase.from('users').insert([payload]);

    if (insertErr) {
      console.error('Supabase INSERT error (register):', insertErr);
      throw insertErr;
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('REGISTER error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* =============================================================
   ROTA: Login
============================================================= */
router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

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

    const { data: lic, error: licErr } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (licErr) {
      console.error('Supabase SELECT error (login -> user_licenses):', licErr);
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

/* =============================================================
   ROTA: Ativar licença manual (código enviado)
============================================================= */
router.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code)
      return res.status(400).json({ error: 'E-mail e código obrigatórios.' });

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

    const licenseKey = license.license_key;

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
        .insert([{ user_email: email, license_key: licenseKey }]);

      if (insErr) throw insErr;
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

/* =============================================================
   ROTA: Verificar se usuário tem licença
============================================================= */
router.get('/api/has-license', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email obrigatório' });

    const { data, error } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (error) throw error;

    return res.json({ ok: true, hasLicense: data && data.length > 0 });

  } catch (err) {
    console.error('HAS-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* =============================================================
   ROTA ADMIN — Criar licença manual (WEB) — protegido por ADMIN_KEY
============================================================= */
router.post('/api/admin/create-license', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['x-admin_key'];

    if (!adminKey || adminKey !== process.env.ADMIN_KEY)
      return res.status(401).json({ error: 'Unauthorized (admin key)' });

    const { code, product_id } = req.body || {};

    const gen = () => {
      const p = () => crypto.randomBytes(2).toString('hex').toUpperCase();
      return `${p()}-${p()}-${p()}`;
    };

    let licenseCode = code || gen();
    const licenseKey = crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');

    const payload = {
      code: licenseCode,
      license_key: licenseKey,
      status: 'available',
      product_id: product_id || null,
      created_at: new Date().toISOString()
    };

    const { error: insErr, data } = await supabase
      .from('licenses')
      .insert([payload])
      .select();

    if (insErr) {
      console.error('Admin create license error:', insErr);
      return res.status(500).json({ error: insErr.message });
    }

    return res.json({ ok: true, license: data[0] });

  } catch (err) {
    console.error('ADMIN CREATE-LICENSE error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* =============================================================
   ROTA: Stripe Checkout Session
============================================================= */
router.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe)
      return res.status(500).json({ error: 'Stripe não configurado.' });

    const { priceId, successUrl, cancelUrl, userEmail } = req.body;

    if (!priceId || !successUrl)
      return res.status(400).json({ error: 'priceId e successUrl são obrigatórios.' });

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

/* =============================================================
   Webhook Stripe
============================================================= */
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) return res.status(200).send({ received: true });

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_email;

      if (!email) {
        console.warn('Webhook sem email, ignorando.');
        return res.json({ received: true });
      }

      const clientEmail = email.toLowerCase();

      const licenseKey = genLicenseCode();

      await supabase.from('licenses').insert([{
        code: licenseKey,
        license_key: licenseKey,
        status: 'used',
        used_by: clientEmail,
        used_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        active: true
      }]);

      await supabase.from('user_licenses').insert([{
        user_email: clientEmail,
        license_key: licenseKey,
        assigned_at: new Date().toISOString()
      }]);
    }

    return res.json({ received: true });

  } catch (err) {
    console.error('WEBHOOK error:', err);
    return res.status(500).send(`Erro interno: ${err.message}`);
  }
});

/* =============================================================
   ROTA: Healthcheck
============================================================= */
router.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* -------------------------------------------------------------
   Export
------------------------------------------------------------- */
module.exports = { router, init };
