// server/index.js — Arquivo completo, pronto para uso

const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();

// --------------------- ENV CONFIG -----------------------
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;

console.log("===========================================");
console.log("Backend de licenças rodando na porta 10000");
console.log("ALLOWED_ORIGIN:", ALLOWED_ORIGIN);
console.log("FRONTEND_URL:", FRONTEND_URL);
console.log("Stripe ativo?:", STRIPE_SECRET_KEY ? "SIM" : "NÃO");
console.log("Webhook secret definido?:", STRIPE_WEBHOOK_SECRET ? "true" : "false");
console.log("SendGrid key definida?:", process.env.SENDGRID_API_KEY ? "true" : "false");
console.log("===========================================");

// ----------------- Inicializar Stripe -------------------
let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = require("stripe")(STRIPE_SECRET_KEY);
    console.log("[INIT] Stripe inicializado.");
  } catch (err) {
    console.error("Falha ao inicializar Stripe:", err);
  }
}
app.locals.stripe = stripe;
app.locals.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;

// ================= RAW BODY PARA WEBHOOK =================
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl.includes("/api/stripe-webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);

// ------------------------ CORS --------------------------
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    credentials: true,
  })
);

// ------------------------ ROTAS --------------------------
app.use('/api', routes);

// ------------------------ SERVIDOR ------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
});
