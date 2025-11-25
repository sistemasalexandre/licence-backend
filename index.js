
// server_index.js
// Ready-to-paste index file that mounts server/routes.js (if present), inits Supabase and Stripe,
// has robust logging and uses process.env.PORT. Copy this to your project root as server/index.js
// or replace your existing file with this content.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const path = require('path');

const app = express();

// Logging and parsing
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Validate essential environment vars
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in env — process will exit');
  process.exit(1);
}

// Init Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Init Stripe if available
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) {
  console.log('Stripe not configured (STRIPE_SECRET_KEY missing). Checkout/webhook will be disabled.');
}

// Simple request logger for debugging
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// Try to load modular routes if present
let routesLoaded = false;
try {
  const routesModule = require('./server/routes');
  if (routesModule && typeof routesModule.init === 'function') {
    routesModule.init({ supabase, stripe });
    app.use('/', routesModule.router);
    routesLoaded = true;
    console.log('Loaded server/routes.js and mounted router at /');
  } else if (routesModule && routesModule.router) {
    app.use('/', routesModule.router);
    routesLoaded = true;
    console.log('Loaded server/routes.js (router found) and mounted at /');
  } else {
    console.log('server/routes.js loaded but no router/init exported — falling back to inline routes');
  }
} catch (err) {
  console.warn('No server/routes.js found or require error (this is OK if you use inline routes).', err.message);
}

// Fallback inline routes (only used if modular routes not present)
// Keep these minimal to avoid duplication if you do use server/routes.js
if (!routesLoaded) {
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.post('/api/register', async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

      const { data: exists, error: errExists } = await supabase.from('users').select('id').eq('email', email).limit(1);
      if (errExists) throw errExists;
      if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe' });

      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(password, 10);
      const { data, error } = await supabase.from('users').insert([{ email, password_hash: hash, name }]).select();
      if (error) throw error;

      res.json({ ok: true, user: { id: data[0].id, email: data[0].email } });
    } catch (err) {
      console.error('REGISTER error:', err);
      res.status(500).json({ error: err.message || 'erro' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

      const { data, error } = await supabase.from('users').select('*').eq('email', email).limit(1);
      if (error) throw error;
      const user = data && data[0];
      if (!user) return res.status(400).json({ error: 'Usuário não encontrado' });

      const bcrypt = require('bcryptjs');
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

      const { data: ul, error: errUl } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
      if (errUl) throw errUl;
      const hasLicense = ul && ul.length > 0;

      res.json({ ok: true, user: { id: user.id, email: user.email }, hasLicense: !!hasLicense });
    } catch (err) {
      console.error('LOGIN error:', err);
      res.status(500).json({ error: err.message || 'erro' });
    }
  });

  app.post('/api/activate-license', async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ error: 'email e code necessários' });

      const { data: licData, error: errLic } = await supabase.from('licenses').select('*').eq('code', code).limit(1);
      if (errLic) throw errLic;
      const license = licData && licData[0];
      if (!license) return res.status(400).json({ error: 'Licença não encontrada' });

      if (license.status && license.status !== 'available' && license.status !== 'unused') {
        return res.status(400).json({ error: 'Licença não disponível' });
      }

      const { data: insertCheck } = await supabase.from('user_licenses').select('id').eq('user_email', email).eq('license_key', license.license_key ?? license.code).limit(1);
      if (!(insertCheck && insertCheck.length)) {
        const { error: errInsert } = await supabase.from('user_licenses').insert([{
          user_email: email,
          license_key: license.license_key ?? license.code,
          activated_at: new Date().toISOString()
        }]);
        if (errInsert) throw errInsert;
      }

      const { error: errUpd } = await supabase.from('licenses').update({ status: 'used', used_by: email, used_at: new Date().toISOString() }).eq('code', code);
      if (errUpd) throw errUpd;

      res.json({ ok: true, message: 'Licença ativada' });
    } catch (err) {
      console.error('ACTIVATE error:', err);
      res.status(500).json({ error: err.message || 'erro' });
    }
  });
}

// Health root
app.get('/', (req, res) => res.send('Licence backend OK'));

// Start server (Render provides PORT via env)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
