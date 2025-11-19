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

// NOTE: We register the webhook route *before* body parsers so the webhook
// endpoint can receive the raw body required by Stripe signature verification.
// The other routes (JSON endpoints) will be registered after express.json().
//
// Health route is safe to keep before body parsers.
app.get('/', (req, res) => res.send('License backend running'));

// ----------------- Stripe webhook endpoint (must receive raw body) -----------------
// If you use webhooks, ensure STRIPE_WEBHOOK_SECRET is set in your envs.
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET || !stripe) {
    console.log('[WEBHOOK] Stripe webhook not configured (missing secret or stripe client).');
    return res.status(501).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    // req.body is a Buffer because we used express.raw for this route
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err && err.message ? err.message : err);
    return res.status(400).send(`Webhook Error: ${err && err.message ? err.message : 'invalid signature'}`);
  }

  console.log('[WEBHOOK] Received event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_email || null;

    // generate a simple license key (replace with your production logic)
    const licenseKey = 'LIC-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    console.log('[WEBHOOK] Creating license for session:', session.id, 'license:', licenseKey);

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
      try {
        // Node 18+ has fetch globally; if your Node version doesn't, install node-fetch
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/licenses`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            license_key: licenseKey,
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

    // Optionally: send email to customerEmail here (SendGrid/nodemailer).
  }

  // Respond to Stripe
  res.json({ received: true });
});

// ----------------- Body parsers for JSON endpoints (after webhook) -----------------
// keep raw body on other routes if needed via verify
app.use(express.json({
  verify: function (req, res, buf) {
    // attach rawBody string for debugging or other uses (not used by webhook)
    req.rawBody = buf && buf.length ? buf.toString() : '';
  }
}));
app.use(express.urlencoded({ extended: false }));

// Optional light ENV debug (you can remove later)
console.log('ENV CHECK → STRIPE_SECRET_KEY?', !!STRIPE_SECRET_KEY);
console.log('ENV CHECK → STRIPE_WEBHOOK_SECRET?', !!STRIPE_WEBHOOK_SECRET);
console.log('ENV CHECK → SUPABASE_URL?', !!SUPABASE_URL);
console.log('ENV CHECK → SUPABASE_SERVICE_ROLE?', !!SUPABASE_SERVICE_ROLE);
console.log('ENV CHECK → FRONTEND_URL?', FRONTEND_URL);
console.log('ENV CHECK → ALLOWED_ORIGIN?', ALLOWED_ORIGIN);

// ----------------- Routes -----------------

// Create Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { priceId, customerEmail } = req.body || {};

    if (!priceId) {
      return res.status(400).json({ ok: false, error: "priceId is required" });
    }

    // === FALLBACK for local testing ===
    // if frontend sends this exact priceId, return a fake checkout URL
    // so you can test frontend flow without contacting Stripe.
    if (priceId === 'price_test_123') {
      return res.json({
        ok: true,
        url: 'https://example.com/fake-checkout',
        note: 'This is a fake URL for testing (price_test_123)'
      });
    }

    // Ensure stripe client is available
    if (!stripe) {
      console.error('[create-checkout-session] Stripe client not configured (STRIPE_SECRET_KEY missing)');
      return res.status(500).json({ ok: false, error: "STRIPE_SECRET_KEY missing" });
    }

    // Create real Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/auth?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/auth?canceled=true`,
      customer_email: customerEmail || undefined
    });

    return res.json({
      ok: true,
      url: session.url,
      id: session.id
    });

  } catch (err) {
    console.error('[create-checkout-session ERROR]', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'internal error' });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});

// ----------------- Start server -----------------
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server listening on ${port}`));
