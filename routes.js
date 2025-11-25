// server/routes.js
// Versão atualizada — cole todo esse arquivo no seu projeto (substitui o anterior)

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
// Nota: supabase e stripe são injetados via init(deps)
let supabase = null;
let stripe = null;

/**
 * Inicializa dependências injetadas pelo index.js (ou por quem importar).
 * Ex: init({ supabase: supabaseClient, stripe: stripeClient })
 */
function init(deps = {}) {
  if (deps.supabase) supabase = deps.supabase;
  if (deps.stripe) stripe = deps.stripe;
}

/* ---------------------------
   Middlewares para o router
   --------------------------- */
// aceitar JSON normalmente para TODO o router (exceto webhook, que usa raw)
router.use(express.json());

/* ========================================================================
   Helpers
======================================================================== */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch(e) { return '{}'; }
}

/* ========================================================================
   ROUTES
   Todas na base /api/.... (assim bate com o que você vem testando)
======================================================================== */

/* -------------------------
   Register
------------------------- */
router.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    // checa se já existe
    const { data: exists, error: selErr } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .limit(1);

    if (selErr) {
      console.error('Supabase SELECT error (register):', selErr);
      throw selErr;
    }

    if (exists && exists.length)
      return res.status(400).json({ error: 'Usuário já existe.' });

    // hash da senha
    const hash = await bcrypt.hash(password, 10);

    const payload = { email, password_hash: hash, created_at: new Date().toISOString() };
    if (name) payload.name = name;

    const { error: insertErr } = await supabase.from('users').insert([payload]);
    if (insertErr) {
      console.error('Supabase INSERT error (register):', insertErr);
      throw insertErr;
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('REGISTER error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Login
------------------------- */
router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const { data, error: selErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (selErr) {
      console.error('Supabase SELECT error (login):', selErr);
      throw selErr;
    }

    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });

    const check = await bcrypt.compare(password, user.password_hash);
    if (!check) return res.status(401).json({ error: 'Senha incorreta.' });

    // busca licença vinculada (se houver)
    const { data: lic, error: licErr } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    if (licErr) {
      console.error('Supabase SELECT error (login -> user_licenses):', licErr);
      // não falha por completo; apenas avisa
    }

    return res.json({
      ok: true,
      hasLicense: Array.isArray(lic) && lic.length > 0,
      user: { email }
    });
  } catch (err) {
    console.error('LOGIN error:', err);
    return res.status(500).json({ error: err?.message || safeJson(err) });
  }
});

/* -------------------------
   Activate license (manual)
   Ex: cliente envia email + code e ativa
------------------------- */
router.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: 'E-mail e código obrigatórios.' });

    const { data: lic, error: licErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', code)
      .limit(1);

    if (licErr) {
      console.error('Supabase SELECT error (activate):', licErr);
      throw licErr;
    }

    const license = lic && lic[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada.' });

    if (license.status !== 'available' && license.status !== 'reserved')
      return res.status(400).json({ error: 'Licença já utilizada.' });

    const licenseKey = license.license_key ?? license.code;

    const { data: exists, error: exErr } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);

    if (exErr) {
      console.error('Supabase SELECT error (activate -> user_licenses):', exErr);
      throw exErr;
    }

    if (!exists || !exists.length) {
      const { error: insErr } = await supabase
        .from('user_licenses')
        .insert([{ user_email: email, license_key: licenseKey }]);
      if (insErr) throw insErr;
    }

    const { error: updErr } = await supabase
      .from('licenses')
      .update({
        status: 'used',
        used_by: email,
        used_at: new Date().toISOString()
      })
      .eq('code', code);

    if (updErr) throw updErr;

    return res.json({ ok: true });
  } catch (err) {
    console.error('ACTIVATE-LICEN
