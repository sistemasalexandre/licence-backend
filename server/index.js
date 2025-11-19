// server/index.js
// Arquivo completo. Cole inteiro no seu projeto.

const express = require('express');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || null;

// Initialize Stripe only if key present
let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
  } catch (err) {
    console.error('Failed to initialize stripe:', err);
    stripe = null;
  }
}

// ----------------- Middlewares -----------------
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

// Health (safe before body parsers)
app.get('/', (req, res) => res.send('License backend running'));

// ----------------- Stripe webhook endpoint (must receive raw body) -----------------
// This route must be declared BEFORE express.json() so we receive raw body for Stripe verification.
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET || !stripe) {
    console.log('[WEBHOOK] Stripe webhook not configured (missing secret or stripe client).');
    return res.status(501).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err && err.message ? err.message : err);
    return res.status(400).send(`Webhook Error: ${err && err.message ? err.message : 'invalid signature'}`);
  }

  console.log('[WEBHOOK] Received event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_email || (session.customer_details && session.customer_details.email) || null;

    const licenseKey = 'LIC-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    console.log('[WEBHOOK] Creating license for session:', session.id, 'license:', licenseKey);

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/pending_licenses`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            license_key: licenseKey,
            email: customerEmail,
            used: false,
            created_at: new Date().toISOString()
          })
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error('[WEBHOOK] Supabase insert failed:', resp.status, text);
        } else {
          const data = await resp.json();
          console.log('[WEBHOOK] License saved to Supabase:', data);
        }
      } catch (err) {
        console.error('[WEBHOOK] Error saving to Supabase:', err);
      }
    } else {
      console.log('[WEBHOOK] SUPABASE_URL or SUPABASE_SERVICE_ROLE not set — skipping DB save.');
    }

    // Optionally: you can send email here if you integrate an email service.
  }

  res.json({ received: true });
});

// ----------------- Body parsers for other JSON endpoints (after webhook) -----------------
app.use(express.json({
  verify: function (req, res, buf) {
    req.rawBody = buf && buf.length ? buf.toString() : '';
  }
}));
app.use(express.urlencoded({ extended: false }));

// Optional light ENV debug (remove in production if desired)
console.log('ENV CHECK → STRIPE_SECRET_KEY?', !!STRIPE_SECRET_KEY);
console.log('ENV CHECK → STRIPE_WEBHOOK_SECRET?', !!STRIPE_WEBHOOK_SECRET);
console.log('ENV CHECK → SUPABASE_URL?', !!SUPABASE_URL);
console.log('ENV CHECK → SUPABASE_SERVICE_ROLE?', !!SUPABASE_SERVICE_ROLE);
console.log('ENV CHECK → FRONTEND_URL?', FRONTEND_URL);
console.log('ENV CHECK → ALLOWED_ORIGIN?', ALLOWED_ORIGIN);

// ----------------- Mount API routes (from routes.js) -----------------
const routes = require('./routes');
app.use('/api', routes);

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});

// ----------------- Start server -----------------
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server listening on ${port}`));
