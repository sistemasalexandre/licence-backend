// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { router, init } = require('./routes'); // garante que routes.js exporte router e init
const app = express();

const PORT = process.env.PORT || 3000;

// Cors / origem
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const FRONTEND_URL = process.env.FRONTEND_URL || ALLOWED_ORIGIN || '*';

app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - bodyKeys=${req.body ? Object.keys(req.body).join(',') : ''}`);
  next();
});

// Supabase cliente (service role)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE nas variáveis de ambiente.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});
console.log('Supabase client criado:', !!supabase);

// Stripe (opcional)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('Stripe inicializado.');
} else {
  console.log('Stripe não configurado (STRIPE_SECRET_KEY não definido).');
}

// Inicia routes (injeta supabase e stripe)
try {
  init({ supabase, stripe });
  console.log('routes.init() chamado com supabase e stripe.');
} catch (e) {
  console.error('Erro chamando init() em routes:', e);
  // não aborta aqui para permitir logs
}

// Mount router
app.use(router);

// Global error handler (garante retorno de erro JSON)
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR HANDLER:', err);
  res.status(500).json({ error: err?.message || 'Erro interno' });
});

app.get('/', (req, res) => res.send('Licence backend OK'));

app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
  console.log(`Allowed origin: ${ALLOWED_ORIGIN} | Frontend URL: ${FRONTEND_URL}`);
});
