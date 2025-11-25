// server/index.js
// BACKEND ÚNICO: registra usuário, faz login, ativa licença e expõe health-check

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const app = express();

// --------- MIDDLEWARES BÁSICOS ---------
app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
}));

// Log simples de requisições (aparece no Render Logs)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --------- SUPABASE ---------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE nas variáveis de ambiente.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// --------- STRIPE (OPCIONAL) ---------
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('Stripe inicializado.');
} else {
  console.log('Stripe não configurado (STRIPE_SECRET_KEY não definido).');
}

// =====================================================================
// HEALTH-CHECK
// =====================================================================
app.get('/api/health', (req, res) => {
  return res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('Licence backend OK');
});

// =====================================================================
// REGISTER - cria usuário na tabela "users"
// columns esperadas: id, email, password_hash, name (opcional), created_at
// =====================================================================
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha obrigatórios' });
    }

    // Verifica se já existe
    const { data: exists, error: errExists } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1);

    if (errExists) {
      console.error('Erro Supabase (exists):', errExists);
      throw errExists;
    }

    if (exists && exists.length) {
      return res.status(400).json({ error: 'Usuário já existe' });
    }

    const hash = await bcrypt.hash(password, 10);

    const payload = {
      email,
      password_hash: hash,
      name: name || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('users')
      .insert([payload])
      .select();

    if (error) {
      console.error('Erro Supabase (insert user):', error);
      throw error;
    }

    const user = data && data[0];

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('REGISTER error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// =====================================================================
// LOGIN - confere senha e indica se tem licença
// Tabelas:
//   users: email, password_hash
//   user_licenses: user_email, license_key
// =====================================================================
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha obrigatórios' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (error) {
      console.error('Erro Supabase (select user):', error);
      throw error;
    }

    const user = data && data[0];
    if (!user) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }

    const { data: ul, error: errUl } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (errUl) {
      console.error('Erro Supabase (select user_licenses):', errUl);
      throw errUl;
    }

    const hasLicense = ul && ul.length > 0;

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
      },
      hasLicense: !!hasLicense,
    });
  } catch (err) {
    console.error('LOGIN error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// =====================================================================
// ATIVAR LICENÇA (manual) - /api/activate-license
// Tabelas esperadas:
//   licenses: code, license_key, status, used_by, used_at
//   user_licenses: user_email, license_key, activated_at
// =====================================================================
app.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'email e code necessários' });
    }

    // Busca licença pelo código
    const { data: licData, error: errLic } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', code)
      .limit(1);

    if (errLic) {
      console.error('Erro Supabase (select license):', errLic);
      throw errLic;
    }

    const license = licData && licData[0];

    if (!license) {
      return res.status(400).json({ error: 'Licença não encontrada' });
    }

    // Confere status
    if (
      license.status &&
      license.status !== 'available' &&
      license.status !== 'unused'
    ) {
      return res.status(400).json({ error: 'Licença não disponível' });
    }

    const licenseKey = license.license_key || license.code;

    // Evita associar duplicado
    const { data: insertCheck, error: errCheck } = await supabase
      .from('user_licenses')
      .select('id')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);

    if (errCheck) {
      console.error('Erro Supabase (select user_licenses check):', errCheck);
      throw errCheck;
    }

    if (!insertCheck || !insertCheck.length) {
      const { error: errInsert } = await supabase
        .from('user_licenses')
        .insert([{
          user_email: email,
          license_key: licenseKey,
          activated_at: new Date().toISOString(),
        }]);
      if (errInsert) {
        console.error('Erro Supabase (insert user_licenses):', errInsert);
        throw errInsert;
      }
    }

    // Atualiza licença pra "used"
    const { error: errUpd } = await supabase
      .from('licenses')
      .update({
        status: 'used',
        used_by: email,
        used_at: new Date().toISOString(),
      })
      .eq('code', code);

    if (errUpd) {
      console.error('Erro Supabase (update license):', errUpd);
      throw errUpd;
    }

    return res.json({ ok: true, message: 'Licença ativada' });
  } catch (err) {
    console.error('ACTIVATE-LICENSE error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// =====================================================================
// OPCIONAL: verificar se e-mail já tem licença
// =====================================================================
app.get('/api/has-license', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email é necessário' });

    const { data: ul, error } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (error) {
      console.error('Erro Supabase (has-license):', error);
      throw error;
    }

    return res.json({ ok: true, hasLicense: !!(ul && ul.length) });
  } catch (err) {
    console.error('HAS-LICENSE error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// =====================================================================
// SERVIDOR
// =====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
});
