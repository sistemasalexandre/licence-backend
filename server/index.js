// server/index.js — VERSÃO FINAL 100% CORRIGIDA PARA TABELA "licenses"

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const routes = require('./routes');
const crypto = require('crypto');

const app = express();

// ===============================
// VARIÁVEIS DE AMBIENTE
// ===============================
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
}

// ===============================
// CORS
// ===============================
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

app.get('/', (req, res) => res.send('Backend de licenças rodando 👍'));

// ===============================
// WEBHOOK STRIPE — DEVE RECEBER RAW BODY
// ===============================
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(501).send('Webhook não configurado');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook assinatura inválida:", err.message);
    return res.status(400).send(`Erro webhook: ${err.message}`);
  }

  console.log("EVENTO WEBHOOK:", event.type);

  // ===============================
  // CHECKOUT COMPLETO
  // ===============================
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const customerEmail =
      session.customer_email ||
      (session.customer_details && session.customer_details.email) ||
      null;

    // Gera chave de licença
    const licenseKey = 'LIC-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    console.log("🟦 Criando licença:", licenseKey, "para:", customerEmail);

    try {
      // INSERE NA TABELA CORRETA "licenses"
      await pool.query(
        `INSERT INTO licenses (user_id, license_key, used, created_at)
         VALUES (NULL, $1, false, now())`,
        [licenseKey]
      );

      console.log("🟩 Licença criada no banco.");
    } catch (err) {
      console.error("❌ Erro salvando licença:", err);
    }

    // Enviar email (vindo do routes.js)
    try {
      const { sendLicenseEmail } = require('./routes');
      if (sendLicenseEmail) {
        sendLicenseEmail(customerEmail, licenseKey);
      }
    } catch (err) {
      console.log("❌ Erro enviando email:", err.message);
    }
  }

  res.json({ received: true });
});

// ===============================
// MIDDLEWARES PARA JSON (APÓS WEBHOOK)
// ===============================
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ===============================
// CRIAR SESSÃO DE CHECKOUT STRIPE
// ===============================
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe não configurado' });

  const { priceId, customerEmail } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      customer_email: customerEmail,
      success_url: `${FRONTEND_URL}/auth?success=true`,
      cancel_url: `${FRONTEND_URL}/auth?cancel=true`
    });

    res.json({ ok: true, url: session.url });

  } catch (err) {
    console.error("Erro Stripe:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// ROTEAMENTO PRINCIPAL
// ===============================
app.use('/api', routes);

// ===============================
// 404
// ===============================
app.use((req, res) => res.status(404).json({ error: "not found" }));

// ===============================
// START
// ===============================
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));
