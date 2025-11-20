// server/routes.js (VERSÃO CORRIGIDA E SIMPLIFICADA)
const express = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { z } = require('zod');
const bcrypt = require('bcrypt');
const sgMail = require('@sendgrid/mail');

const router = express.Router();

// ===============================
// CONFIG EMAIL (SENDGRID)
// ===============================
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendLicenseEmail(toEmail, licenseKey) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log("SendGrid não configurado, pulando envio de email");
    return;
  }

  const msg = {
    to: toEmail,
    from: process.env.EMAIL_FROM,
    subject: "Sua licença VidaComGrana",
    html: `
      <p>Obrigado pela compra!</p>
      <p>Sua licença é:</p>
      <p><b>${licenseKey}</b></p>
      <p>Use-a na página de ativação / registro do app.</p>
    `
  };

  try {
    await sgMail.send(msg);
    console.log("Email enviado para", toEmail);
  } catch (err) {
    console.error("Erro no envio do email:", err);
  }
}

// ===============================
// TESTE: GERAR LICENÇA MANUAL
// ===============================
router.post('/test-create-license', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email obrigatório" });

  try {
    const licenseKey = crypto.randomBytes(16).toString("hex");

    await pool.query(
      `INSERT INTO pending_licenses (stripe_session_id, customer, customer_email, price_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', now())`,
      [
        "manual_" + Date.now(),
        email,
        email,
        "manual_price"
      ]
    );

    await sendLicenseEmail(email, licenseKey);

    res.json({ ok: true, licenseKey });
  } catch (err) {
    console.error("test-create-license error:", err);
    res.status(500).json({ error: "erro ao criar licença" });
  }
});

// ===============================
// REGISTER (criar usuário + ativar licença)
// ===============================
router.post('/register', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    licenseKey: z.string().min(8)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

  const { email, password, licenseKey } = parsed.data;

  try {
    // PROCURA LICENÇA NO BANCO (user_licenses)
    const licRes = await pool.query(
      `SELECT * FROM user_licenses WHERE license_key = $1 AND user_email IS NULL LIMIT 1`,
      [licenseKey]
    );

    if (!licRes.rows.length)
      return res.status(400).json({ error: "Licença inválida ou já usada" });

    // CRIAR USUÁRIO
    const hashed = await bcrypt.hash(password, 10);

    const userInsert = await pool.query(
      `INSERT INTO users (email, password_hash, name, created_at)
       VALUES ($1, $2, '', now())
       RETURNING id`,
      [email, hashed]
    );

    const userId = userInsert.rows[0].id;

    // MARCAR LICENÇA COMO USADA
    await pool.query(
      `UPDATE user_licenses
       SET user_email = $1
       WHERE license_key = $2`,
      [email, licenseKey]
    );

    res.json({ ok: true, message: "Usuário criado e licença ativada" });

  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ error: "erro no servidor" });
  }
});

// ===============================
// LOGIN
// ===============================
router.post('/login', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.errors });

  const { email, password } = parsed.data;

  try {
    const userRes = await pool.query(
      `SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (!userRes.rows.length)
      return res.status(401).json({ error: "Credenciais inválidas" });

    const user = userRes.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });

    //Busca licença
    const licRes = await pool.query(
      `SELECT license_key FROM user_licenses WHERE user_email = $1 LIMIT 1`,
      [email]
    );

    res.json({
      ok: true,
      userId: user.id,
      license: licRes.rows[0] || null
    });

  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "erro servidor" });
  }
});

// ===============================
// VERIFICAR LICENÇA (frontend usa)
// ===============================
router.post('/verify-license', async (req, res) => {
  const { license, email } = req.body;

  if (!license)
    return res.status(400).json({ valid: false, error: "licença vazia" });

  try {
    const licRes = await pool.query(
      `SELECT * FROM user_licenses
       WHERE license_key = $1`,
      [license]
    );

    if (!licRes.rows.length)
      return res.json({ valid: false });

    const row = licRes.rows[0];

    if (row.user_email && email && row.user_email !== email)
      return res.json({ valid: false });

    return res.json({ valid: true });

  } catch (err) {
    console.error("verify-license error", err);
    return res.status(500).json({ error: "erro servidor" });
  }
});

module.exports = router;
