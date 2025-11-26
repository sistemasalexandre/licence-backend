// server/index.js
// Backend principal: inicializa Supabase, Stripe, carrega routes e inicia servidor.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const path = require('path');

const app = express();

// ----------------- ENV / CONFIGURAÇÕES -----------------
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const FRONTEND_URL = process.env.FRONTEND_URL || ALLOWED_ORIGIN;

// validação mínima
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('FATAL: SUPABASE_URL ou SUPABASE_SERVICE_ROLE não configurados nas env vars.');
  console.error('Defina SUPABASE_URL (ex: https://<projeto>.supabase.co) e SUPABASE_SERVICE_ROLE (service_role key).');
  process.exit(1);
}

// ----------------- MIDDLEWARES GLOBAIS -----------------
app.use(express.json()); // JSON parser
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// log básico (útil nos logs do Render)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ----------------- CLIENT SUPABASE -----------------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
console.log('Supabase client created:', !!supabase);

// ----------------- STRIPE (opcional) -----------------
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('Stripe inicializado.');
} else {
  console.log('Stripe não configurado (STRIPE_SECRET_KEY ausente). Webhook e pagamentos desativados.');
}

// ----------------- ROUTES (import + init) -----------------
/*
  routes.js exporta { router, init }
  init({ supabase, stripe }) injeta dependências.
*/
let routesModule;
try {
  routesModule = require('./routes');
} catch (e) {
  console.error('Erro ao carregar ./routes:', e);
  process.exit(1);
}

// aceitarmos os dois formatos: require('./routes').init OR global.init set (routes.js já faz)
const router = routesModule.router || routesModule.default?.router || null;
const initFn = routesModule.init || routesModule.default?.init || global.init || null;

if (!router) {
  console.error('FATAL: routes.router não encontrado — verifique server/routes.js');
  process.exit(1);
}

if (!initFn || typeof initFn !== 'function') {
  console.warn('AVISO: init() não encontrado em routes. Continuando sem injeção (algumas features podem não funcionar).');
} else {
  try {
    initFn({ supabase, stripe });
    console.log('init() executado em routes com supabase e stripe.');
  } catch (err) {
    console.error('Erro executando init() do routes:', err);
    // não damos exit imediato, para permitir inspeção nos logs
  }
}

// usa o router exportado (todas as rotas /api/* e /webhook etc)
app.use(router);

// rota raiz simples (útil para health checks)
app.get('/', (req, res) => {
  res.send('Licence backend OK');
});

// health-check (duplicado com routes, mas seguro manter)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ----------------- START SERVER -----------------
app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
  console.log(`Allowed origin: ${ALLOWED_ORIGIN} | Frontend URL: ${FRONTEND_URL}`);
});
