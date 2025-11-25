// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const crypto = require('crypto');

const app = express();

/* ----------------- config ----------------- */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE nas envs.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const FRONTEND_URL = process.env.FRONTEND_URL || '';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = Stripe(STRIPE_SECRET_KEY);
  console.log('Stripe inicializado.');
} else {
  console.log('Stripe não configurado.');
}

/* ----------------- middlewares ----------------- */
app.use(express.json());
// for webhook we will use express.raw on that route
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ----------------- helpers ----------------- */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

/* ----------------- health ----------------- */
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/', (req, res) => res.send('Licence backend OK'));

/* ================= REGISTER ================= */
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data: exists, error: errExists } = await supabase.from('users').select('id').eq('email', email).limit(1);
    if (errExists) throw errExists;
    if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe' });

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const payload = { email, password_hash, name: name || null, created_at: new Date().toISOString() };
    const { data, error } = await supabase.from('users').insert([payload]).select();
    if (error) throw error;

    const user = data && data[0];
    return res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('REGISTER error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

/* ================= LOGIN ================= */
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data, error } = await supabase.from('users').select('*').eq('email', email).limit(1);
    if (error) throw error;
    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

    const { data: ul, error: ulErr } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
    if (ulErr) console.warn('Aviso ao buscar user_licenses:', ulErr);
    const hasLicense = ul && ul.length > 0;

    return res.json({ ok: true, user: { id: user.id, email: user.email }, hasLicense: !!hasLicense });
  } catch (err) {
    console.error('LOGIN error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

/* ================= ACTIVATE LICENSE (manual) ================= */
app.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email e code necessários' });

    const { data: licData, error: licErr } = await supabase.from('licenses').select('*').eq('code', code).limit(1);
    if (licErr) throw licErr;
    const license = licData && licData[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada' });

    if (license.status && !['available', 'unused', 'reserved'].includes(license.status)) {
      return res.status(400).json({ error: 'Licença não disponível' });
    }

    const licenseKey = license.license_key || license.code;

    const { data: check, error: checkErr } = await supabase
      .from('user_licenses')
      .select('id')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);
    if (checkErr) throw checkErr;

    if (!check || !check.length) {
      const { error: insErr } = await supabase.from('user_licenses').insert([{
        user_email: email,
        license_key: licenseKey,
        activated_at: new Date().toISOString()
      }]);
      if (insErr) throw insErr;
    }

    const { error: updErr } = await supabase.from('licenses').update({
      status: 'used',
      used_by: email,
      used_at: new Date().toISOString()
    }).eq('code', code);
    if (updErr) throw updErr;

    return res.json({ ok: true, message: 'Licença ativada' });
  } catch (err) {
    console.error('ACTIVATE-LICENSE error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

/* ================= CREATE CHECKOUT SESSION ================= */
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado' });
    const { priceId, customerEmail } = req.body;
    if (!priceId) return res.status(400).json({ error: 'priceId required' });

    const code = genLicenseCode();
    const payload = { code, license_key: code, status: 'reserved', created_at: new Date().toISOString() };
    const { data: licInsert, error: licErr } = await supabase.from('licenses').insert([payload]).select();
    if (licErr) throw licErr;
    const license = licInsert && licInsert[0];

    const sessionPayload = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (FRONTEND_URL || '') + '/auth.html?success=1',
      cancel_url: (FRONTEND_URL || '') + '/auth.html?cancel=1',
      metadata: { license_code: license.code }
    };
    if (customerEmail) sessionPayload.customer_email = customerEmail;

    const session = await stripe.checkout.sessions.create(sessionPayload);
    return res.json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('CREATE-CHECKOUT error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

/* ================= Stripe webhook ================= */
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) { console.warn('Webhook chamado sem stripe configurado'); return res.status(200).send({ received: true }); }

    const sig = req.headers['stripe-signature'];
    let event;
    try {
      if (STRIPE_WEBHOOK_SECRET) {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } else {
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error('Webhook signature verification failed.', err?.message || err);
      return res.status(400).send(`Webhook Error: ${err?.message || 'invalid signature'}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const license_code = session.metadata && session.metadata.license_code;
      const customer_email = session.customer_email || null;

      if (license_code) {
        try {
          const { data: lic } = await supabase.from('licenses').select('*').eq('code', license_code).limit(1);
          const license = lic && lic[0];
          if (license) {
            await supabase.from('licenses').update({ status: 'used', used_by: customer_email, used_at: new Date().toISOString() }).eq('code', license_code);

            const licenseKey = license.license_key ?? license.code;
            if (customer_email) {
              const emailLower = customer_email.toLowerCase();
              const { data: u } = await supabase.from('users').select('*').eq('email', emailLower).limit(1);
              const user = u && u[0];
              if (user) {
                await supabase.from('user_licenses').insert([{ user_email: emailLower, license_key: licenseKey, activated_at: new Date().toISOString() }]);
              } else {
                // optional: create placeholder user here if you want
              }
            }
          }
        } catch (procErr) {
          console.error('Erro processando checkout.session.completed:', procErr);
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('WEBHOOK error:', err);
    return res.status(500).send('Webhook processing error');
  }
});

/* ================= Debug: list licenses ================= */
app.get('/api/licenses', async (req, res) => {
  try {
    const { data, error } = await supabase.from('licenses').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    res.json({ ok: true, licenses: data });
  } catch (err) {
    console.error('LICENCES list error:', err);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

/* ----------------- start ----------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));
