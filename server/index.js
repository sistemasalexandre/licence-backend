// server/index.js
// ARQUIVO COMPLETO — VERSÃO FINAL

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const { router, init } = require('./routes');

// -------------------------------------------------------------
// CONFIGURAÇÃO SUPABASE
// -------------------------------------------------------------
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
  console.error("❌ ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE não configurados!");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// -------------------------------------------------------------
// CONFIGURAÇÃO STRIPE
// -------------------------------------------------------------
let stripe = null;

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("⚠️ Aviso: STRIPE_SECRET_KEY não configurada. Checkout desabilitado.");
} else {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log("Stripe inicializado.");
}

// -------------------------------------------------------------
// INICIALIZA DEPENDÊNCIAS DO ROUTER
// -------------------------------------------------------------
init({ supabase, stripe });

// -------------------------------------------------------------
// EXPRESS APP
// -------------------------------------------------------------
const app = express();

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*",
  methods: "GET,POST,PUT,PATCH,DELETE",
  allowedHeaders: "Content-Type,Authorization,x-admin-key"
}));

// Body parser normal (para JSON)
app.use(express.json());

// Webhook Stripe usa raw() — definido dentro do routes.js
app.use("/webhook", bodyParser.raw({ type: 'application/json' }));

// Rotas da API
app.use(router);

// Rota raiz
app.get('/', (req, res) => {
  res.send("Backend de Licenças — Online ✔️");
});

// -------------------------------------------------------------
// INICIA SERVIDOR
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
});
