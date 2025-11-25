// server/routes.js
// Roteador opcional — você pode remover este arquivo se quiser, mas aqui vai a versão 100% compatível, corrigida e simplificada.

const express = require('express');
const router = express.Router();

const bcrypt = require('bcryptjs'); // ✔ O CERTO! (antes estava 'bcrypt')
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const Stripe = require('stripe');

// Variáveis carregadas do index.js (injetadas)
let supabase = null;
let stripe = null;

function init(deps) {
  supabase = deps.supabase;
  stripe = deps.stripe;
}

/* ========================================================================
   Função para gerar códigos de licença
======================================================================== */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

/* ========================================================================
   REGISTER
======================================================================== */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const { data: exists } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .limit(1);

    if (exists && exists.length)
      return res.status(400).json({ error: 'Usuário já existe.' });

    const hash = await bcrypt.hash(password, 10);

    const payload = { email, password_hash: hash };
    if (name) payload.name = name;

    const { error } = await supabase.from('users').insert([payload]);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('REGISTER error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================================
   LOGIN
======================================================================== */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });

    const check = await bcrypt.compare(password, user.password_hash);
    if (!check) return res.status(401).json({ error: 'Senha incorreta.' });

    const { data: lic } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .limit(1);

    res.json({
      ok: true,
      hasLicense: lic && lic.length > 0,
      user: { email }
    });
  } catch (err) {
    console.error('LOGIN error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================================
   ATIVAR LICENÇA
======================================================================== */
router.post('/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: 'E-mail e código obrigatórios.' });

    const { data: lic } = await supabase
      .from('licenses')
      .select('*')
      .eq('code', code)
      .limit(1);

    const license = lic && lic[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada.' });

    if (license.status !== 'available' && license.status !== 'reserved')
      return res.status(400).json({ error: 'Licença já utilizada.' });

    const licenseKey = license.license_key ?? license.code;

    const { data: exists } = await supabase
      .from('user_licenses')
      .select('*')
      .eq('user_email', email)
      .eq('license_key', licenseKey)
      .limit(1);

    if (!exists || !exists.length) {
      const { error } = await supabase
        .from('user_licenses')
        .insert([{ user_email: email, license_key: licenseKey }]);
      if (error) throw error;
    }

    await supabase
      .from('licenses')
      .update({
        status: 'used',
        used_by: email,
        used_at: new Date().toISOString()
      })
      .eq('code', code);

    res.json({ ok: true });
  } catch (err) {
    console.error('ACTIVATE-LICENSE error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================================
   EXPORTS
======================================================================== */
module.exports = { router, init };
