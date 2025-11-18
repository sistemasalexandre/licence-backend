// server/index.js
// Arquivo completo e pronto. Basta colar tudo.

const express = require('express');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;

// Stripe
let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
}

// ----------------------------------
// CORS + BODY PARSING
// ----------------------------------
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

app.use(express.json({
  verify: function (req, res, buf) {
    req.rawBody = buf.toString();
  }
}));

app.use(express.urlencoded({ extended: false }));

// ----------------------------------
// ROTAS
// ----------------------------------

// Health (teste)
app.get('/', (req, res) => res.send('License backend running'));

// -------------------------------------------------------------------
// 🔥 ROTA REAL: CREATE CHECKOUT SESSION (STRIPE)
// -------------------------------------------------------------------
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { priceId, customerEmail } = req.body || {};

    if (!priceId) {
      return res.status(400).json({ ok: false, error: "priceId is required" });
    }

    if (!stripe) {
      return res.status(500).json({ ok: false, error: "STRIPE_SECRET_KEY missing" });
    }

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
    console.error('[create-checkout-session ERROR]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ----------------------------------
// 404 - Rota inexistente
// ----------------------------------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});

// ----------------------------------
// START SERVER
// ----------------------------------
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server listening on ${port}`));
