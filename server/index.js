// server/index.js  (cole todo este arquivo, substitui o atual)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// inicializa Stripe se tiver chave
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// importar o router modular (se você colocou server/routes.js)
let routesModule;
try {
  routesModule = require('./server/routes');
} catch (e) {
  console.warn('Não foi possível carregar ./server/routes (ok se não existir):', e.message);
}

if (routesModule && typeof routesModule.init === 'function') {
  // injeta dependências (supabase, stripe)
  routesModule.init({ supabase, stripe });
  // monta o router exportado
  app.use('/', routesModule.router || (routesModule && routesModule.default && routesModule.default.router) || ((req,res)=>res.status(404).send('routes not found')));
} else {
  // fallback: mantém rotas inline simples (compatibilidade)
  console.log('routes.js não fornecido ou sem init -> usando rotas internas de fallback');
  // exemplo health
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  // (você pode adicionar aqui as rotas inline se quiser)
}

// Health root
app.get('/', (req, res) => res.send('Licence backend OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
