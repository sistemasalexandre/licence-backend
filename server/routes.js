// server/routes.js
const express = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { z } = require('zod');
const bcrypt = require('bcrypt');
const sgMail = require('@sendgrid/mail');

const router = express.Router();
const SALT_ROUNDS = 10;

// configure SendGrid if provided
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// helper: send email (if configured)
async function sendLicenseEmail(toEmail, licenseKey) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('SendGrid não configurado — pulando envio de email', toEmail, licenseKey);
    return;
  }
  const msg = {
    to: toEmail,
    from: process.env.EMAIL_FROM || 'no-reply@vidacomgrana.com.br', // must be verified sender in SendGrid
    subject: 'Sua licença VidaComGrana',
    text: `Obrigado pela compra! Sua licença: ${licenseKey}\nUse-a ao criar seu login: ${process.env.ALLOWED_ORIGIN || ''}`,
    html: `<p>Obrigado pela compra!</p><p>Sua licença: <b>${licenseKey}</b></p><p>Use-a ao criar seu login: <a href="${process.env.ALLOWED_ORIGIN || '#'}">${process.env.ALLOWED_ORIGIN || ''}</a></p>`
  };
  try {
    await sgMail.send(msg);
    console.log('Email enviado para', toEmail);
  } catch (err) {
    console.error('Erro enviando email:', err);
  }
}

// ========== Test endpoint (create license manually) ==========
router.post('/test-create-license', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email obrigatório' });
  try {
    const licenseKey = crypto.randomBytes(16).toString('hex'); // 32 hex chars
    await pool.query(
      'INSERT INTO pending_licenses (license_key, email, used, created_at) VALUES ($1, $2, false, now())',
      [licenseKey, email]
    );
    // optionally send email
    await sendLicenseEmail(email, licenseKey);
    res.json({ licenseKey, email });
  } catch (err) {
    console.error('test-create-license error', err);
    res.status(500).json({ error: 'erro ao criar licença' });
  }
});

// ========== Register (user provides email + password + license) ==========
router.post('/register', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    // license keys may vary in format (hex 32 chars, or prefixed like LIC-...), keep mínima restrição
    licenseKey: z.string().min(8)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const { email, password, licenseKey } = parsed.data;

  try {
    // check pending license exists and belongs to email and not used
    const licRes = await pool.query(
      'SELECT * FROM pending_licenses WHERE license_key = $1 LIMIT 1',
      [licenseKey]
    );
    if (!licRes.rows.length) return res.status(400).json({ error: 'Licença inválida' });
    const lic = licRes.rows[0];
    if (lic.used) return res.status(400).json({ error: 'Licença já usada' });

    // compare emails case-insensitive if stored
    const licEmail = lic.email ? lic.email.toLowerCase() : null;
    if (licEmail && licEmail !== email.toLowerCase()) {
      return res.status(400).json({ error: 'Licença não pertence a este email' });
    }

    // create user (fail if email exists)
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const userInsert = await pool.query(
      'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, now()) RETURNING id',
      [email, hashed]
    );
    const userId = userInsert.rows[0].id;

    // mark license used and associate to user
    await pool.query('UPDATE pending_licenses SET used = true, used_at = now() WHERE license_key = $1', [licenseKey]);
    await pool.query('INSERT INTO user_licenses (user_id, license_key, activated_at) VALUES ($1, $2, now())', [userId, licenseKey]);

    return res.json({ ok: true, message: 'Conta criada e licença ativada' });
  } catch (err) {
    if (err && err.code === '23505') { // unique_violation
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    console.error('register error', err);
    return res.status(500).json({ error: 'erro no servidor' });
  }
});

// ========== Login ==========
router.post('/login', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const { email, password } = parsed.data;

  try {
    const userRes = await pool.query('SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1', [email]);
    if (!userRes.rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Credenciais inválidas' });

    // check user's license
    const licRes = await pool.query(
      'SELECT license_key, activated_at FROM user_licenses WHERE user_id = $1 ORDER BY activated_at DESC LIMIT 1',
      [user.id]
    );
    const license = licRes.rows[0] || null;
    return res.json({ ok: true, userId: user.id, license: license || null });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'erro servidor' });
  }
});

// ========== Validate license (optional) ==========
router.post('/validate-license', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    licenseKey: z.string().min(8)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const { email, licenseKey } = parsed.data;

  try {
    // check user_licenses or pending_licenses
    const usedRes = await pool.query(
      'SELECT ul.* FROM user_licenses ul JOIN users u ON u.id = ul.user_id WHERE ul.license_key = $1 AND u.email = $2 LIMIT 1',
      [licenseKey, email]
    );
    if (usedRes.rows.length) return res.json({ valid: true, type: 'activated' });

    const pendingRes = await pool.query(
      'SELECT * FROM pending_licenses WHERE license_key = $1 AND email = $2 AND used = false LIMIT 1',
      [licenseKey, email]
    );
    if (pendingRes.rows.length) return res.json({ valid: true, type: 'pending' });

    return res.json({ valid: false });
  } catch (err) {
    console.error('validate-license error', err);
    res.status(500).json({ error: 'erro servidor' });
  }
});

// NOTE: Stripe webhook is handled in server/index.js (with express.raw).
// Export router with all other application routes.
module.exports = router;
