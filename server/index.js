// server/index.js — VERSÃO FINAL

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const pool = require('./db');
const { router, sendLicenseEmail } = require('./routes');

const app = express();

// =====================================
// VARIÁVEIS DE AMBIENTE
// =====================================
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
}

// =====================================
// CORS
// =====================================
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

app.get('/', (req, res) => res.send('Backend de licenças rodando ✔'));


// =====================================
// WEBHOOK — Precisa vir ANTES do express.json()
// =====================================
app.post('/api/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {

    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(501).send('Stripe não configurado');
    }

    const signature = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Erro webhook:", err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    console.log("EVENTO:", event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const customerEmail =
        session.customer_email ||
        (session.customer_details && session.customer_details.email) ||
        null;

      const licenseKey = "LIC-" + crypto.randomBytes(6).toString("hex").toUpperCase();

      console.log("Criando licença para:", customerEmail);

      try {
        await pool.query(
          `INSERT INTO licenses (user_id, license_key, used, created_at)
           VALUES (NULL, $1, false, NOW())`,
          [licenseKey]
        );

        console.log("Licença salva no banco:", licenseKey);

        if (sendLicenseEmail && customerEmail) {
          await sendLicenseEmail(customerEmail, licenseKey);
        }

      } catch (err) {
        console.error("Erro ao salvar licença:", err);
      }
    }

    res.json({ received: true });
  }
);


// =====================================
// MIDDLEWARES (vem depois do webhook!)
// =====================================
app.use(express.json());
app.use(express.urlencoded({ extended: false }));


// =====================================
// CRIAR CHECKOUT DA STRIPE
// =====================================
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe não configurado" });

  const { priceId, customerEmail } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        { price: priceId, quantity: 1 }
      ],
      customer_email: customerEmail,
      success_url: `${FRONTEND_URL}/auth?success=true`,
      cancel_url: `${FRONTEND_URL}/auth?cancel=true`,
    });

    res.json({ ok: true, url: session.url });

  } catch (err) {
    console.error("Erro Stripe:", err);
    res.status(500).json({ error: err.message });
  }
});


// =====================================
// ROTAS PRINCIPAIS
// =====================================
app.use('/api', router);


// =====================================
// 404
// =====================================
app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});


// =====================================
// START SERVER
// =====================================
const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Servidor rodando na porta " + port));
