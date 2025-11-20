// server/routes.js (VERSÃO TOTALMENTE CORRIGIDA PARA USAR A TABELA "licenses")

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

    // insere licença sem usuário (user_id = null)
    await pool.query(
      `INSERT INTO licenses (user_id, license_key, used, created_at)
       VALUES (NULL, $1, false, now())`,
      [licenseKey]
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
    // PROCURA LICENÇA DISPONÍVEL (user_id IS NULL = ainda não usada)
    const licRes = await pool.query(
      `SELECT * FROM licenses WHERE license_key = $1 AND user_id IS NULL LIMIT 1`,
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

    // ATRIBUIR A LICENÇA AO USUÁRIO
    await pool.query(
      `UPDATE licenses
       SET user_id = $1, used = true
       WHERE license_key = $2`,
      [userId, licenseKey]
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

    // Busca licença atribuída ao usuário
    const licRes = await pool.query(
      `SELECT license_key FROM licenses WHERE user_id = $1 LIMIT 1`,
      [user.id]
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
      `SELECT * FROM licenses WHERE license_key = $1`,
      [license]
    );

    if (!licRes.rows.length)
      return res.json({ valid: false });

    const lic = licRes.rows[0];

    if (email && lic.user_id) {
      const user = await pool.query(`SELECT email FROM users WHERE id = $1`, [
        lic.user_id
      ]);

      if (user.rows.length && user.rows[0].email !== email)
        return res.json({ valid: false });
    }

    return res.json({ valid: true });

  } catch (err) {
    console.error("verify-license error", err);
    return res.status(500).json({ error: "erro servidor" });
  }
});

module.exports = router;
