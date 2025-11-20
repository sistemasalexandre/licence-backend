// server/index.js
// Arquivo completo. Cole inteiro no seu projeto.

const express = require('express');
const cors = require('cors');

const routes = require('./routes'); // nosso arquivo de rotas

const app = express();

// ----------------- Variáveis de ambiente -----------------
const PORT = process.env.PORT || 10000;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || null;

// ----------------- Stripe (opcional) -----------------
let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
    console.log('[INIT] Stripe inicializado.');
  } catch (err) {
    console.error('[INIT] Falha ao inicializar Stripe:', err.message);
    stripe = null;
  }
} else {
  console.warn('[INIT] STRIPE_SECRET_KEY não definida. Rotas de pagamento podem não funcionar.');
}

// Disponibiliza no app (se precisar em routes.js)
app.locals.stripe = stripe;
app.locals.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;

// ----------------- Middlewares -----------------
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

// Mantém o corpo bruto apenas para o webhook do Stripe
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl.startsWith('/api/stripe-webhook')) {
      req.rawBody = buf; // usado para verificar a assinatura do Stripe
    }
  }
}));

// ----------------- Rotas principais -----------------

// Rotas da API (comprar licença, webhook, validar licença, etc.)
app.use('/api', routes);

// Rota simples para teste rápido
app.get('/', (req, res) => {
  res.send('Backend de licenças Vida Com Grana está rodando 🚀');
});

// Healthcheck para o Render
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// Rota opcional para depuração de ambiente (não mostra segredos)
app.get('/debug/env', (req, res) => {
  res.json({
    ALLOWED_ORIGIN,
    FRONTEND_URL,
    has_STRIPE_SECRET_KEY: !!STRIPE_SECRET_KEY,
    has_STRIPE_WEBHOOK_SECRET: !!STRIPE_WEBHOOK_SECRET,
    has_SUPABASE_URL: !!SUPABASE_URL,
    has_SUPABASE_SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE,
    has_SENDGRID_API_KEY: !!process.env.SENDGRID_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM || null
  });
});

// ----------------- Tratamento de erros -----------------
app.use((err, req, res, next) => {
  console.error('[ERROR] Erro não tratado:', err);

  // Se for erro vindo de alguma integração (SendGrid, Stripe etc.)
  if (err.response && err.response.body) {
    console.error('[ERROR] Detalhes do provider:', err.response.body);
  }

  res.status(500).json({
    ok: false,
    message: 'Erro interno no servidor. Verifique os logs no Render.',
  });
});

// ----------------- Start do servidor -----------------
app.listen(PORT, () => {
  console.log('==========================================');
  console.log(`Backend de licenças rodando na porta ${PORT}`);
  console.log(`ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}`);
  console.log(`FRONTEND_URL:  ${FRONTEND_URL}`);
  console.log(`Stripe ativo?: ${stripe ? 'SIM' : 'NÃO'}`);
  console.log(`Webhook secret definido?: ${!!STRIPE_WEBHOOK_SECRET}`);
  console.log(`SendGrid key definida?: ${!!process.env.SENDGRID_API_KEY}`);
  console.log('==========================================');
});
