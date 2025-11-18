// server/index.js
// Substitua o conteúdo do arquivo atual por este.
// Pronto para colar — pode salvar e fazer deploy.

const express = require('express');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || null;

// If you have Stripe key, init stripe. If not, stripe stays null.
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
// CORS
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

// Parse JSON and keep raw body for webhook verification
app.use(express.json({
  verify: function (req, res, buf) {
    // store the raw body string for webhook signature verification
    req.rawBody = buf && buf.length ? buf.toString() : '';
  }
}));
app.use(express.urlencoded({ extended: false }));

// Simple ENV debug (prints true/false so you can see what's set)
console.log('ENV CHECK → STRIPE_SECRET_KEY?', !!STRIPE_SECRET_KEY);
console.log('ENV CHECK → STRIPE_WEBHOOK_SECRET?', !!STRIPE_WEBHOOK_SECRET);
console.log('ENV CHECK → SUPABASE_URL?', !!SUPABASE_URL);
console.log('ENV CHECK → SUPABASE_SERVICE_ROLE?', !!SUPABASE_SERVICE_ROLE);
console.log('ENV CHECK → FRONTEND_URL?', FRONTEND_URL);
console.log('ENV CHECK → ALLOWED_ORIGIN?', ALLOWED_ORIGIN);

// Request debug middleware (remove after you finish debugging)
app.use((req, res, next) => {
  console.log('--- REQ DEBUG ---');
  console.log(req.method, req.path);
  console.log('Origin:', req.headers.origin);
  console.log('Content-Type:', req.headers['content-type']);
  // don't print huge bodies in production but for now it's useful
  console.log('Body:', req.body);
  console.log('-----------------');
  next();
});

// ----------------- Routes -----------------

// Health
app.get('/', (req, res) => res.send('License backend running'));

// Create Checkout Session (used by frontend when user clicks "Comprar")
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    console.log('[HANDLER] create-checkout-session called');
    const body = req.body || {};
    const { priceId, customerEmail } = body;

    // basic validation
    if (!priceId) {
      console.log('[HANDLER] Missing priceId');
      return res.status(400).json({ ok: false, error: 'priceId is required', got: body });
    }

    // Accept a test price to avoid needing Stripe for initial tests
    if (priceId === 'price_test_123') {
      console.log('[HANDLER] Received test priceId, returning fake checkout url');
      return res.status(200).json({
        ok: true,
        url: 'https://example.com/fake-checkout',
        note: 'This is a fake URL for testing (price_test_123)'
      });
    }

    // If stripe is not configured, return error so you know to add key
    if (!stripe) {
      console.log('[HANDLER] Stripe not configured on server (STRIPE_SECRET_KEY missing)');
      return res.status(500).json({ ok: false, error: 'Stripe not configured on server' });
    }

    // Create actual Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/auth?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/auth?canceled=true`,
      customer_email: customerEmail || undefined
    });

    console.log('[HANDLER] Stripe session created:', session.id);
    return res.json({ ok: true, url: session.url, id: session.id });

  } catch (err) {
    console.error('[HANDLER ERROR create-checkout-session]', err && err.stack ? err.stack : err);
    // respond with JSON (browser will show JSON in network tab)
    return res.status(500).json({ ok: false, error: err.message || 'internal error' });
  }
});

// Stripe webhook endpoint (optional). Stripe requires verifying raw body.
// If you don't use webhooks yet, it's okay — this route will safely respond.
app.post('/api/webhook', (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET || !stripe) {
    console.log('[WEBHOOK] Stripe webhook secret or stripe client not configured.');
    return res.status(501).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = req.rawBody || '';

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err && err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('[WEBHOOK] Received event:', event.type);

  // handle relevant events
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('[WEBHOOK] checkout.session.completed for session id:', session.id);
    // Aqui você deve:
    // - verificar pagamento
    // - criar/entregar licença no seu DB (Supabase)
    // - enviar e-mail com a licença
    //
    // Exemplo (comentado): se quiser gravar no Supabase, você pode usar fetch/axios
    // com SUPABASE_SERVICE_ROLE (ATENÇÃO: service role é sensível!)
    //
    // (Deixei isto comentado porque depende de como você quer armazenar a licença)
    /*
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
      const licenseKey = generateLicenseSomehow();
      await fetch(`${SUPABASE_URL}/rest/v1/licenses`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ license_key: licenseKey, user_id: null })
      });
    }
    */
  }

  // respond 200 to acknowledge receipt
  res.json({ received: true });
});

// Fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not found' });
});

// ----------------- Start server -----------------
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server listening on ${port}`));
