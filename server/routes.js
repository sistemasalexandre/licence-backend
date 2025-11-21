// server/routes.js — com rota de teste para webhooks + Stripe + licenças + SendGrid

const express = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { z } = require('zod');
const bcrypt = require('bcrypt');
const sgMail = require('@sendgrid/mail');

const router = express.Router();

// ----------------- SendGrid -----------------
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('[SENDGRID] API key configurada.');
} else {
  console.log('[SENDGRID] SENDGRID_API_KEY não definida. E-mails serão ignorados.');
}

async function sendLicenseEmail(toEmail, licenseKey) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[SENDGRID] Não configurado, pulando envio de email.');
    return;
  }
  if (!process.env.EMAIL_FROM) {
    console.log('[SENDGRID] EMAIL_FROM não definido. Não é possível enviar email.');
    return;
  }

  const msg = {
    to: toEmail,
    from: process.env.EMAIL_FROM,
    subject: 'Sua licença VidaComGrana',
    html: `<p>Obrigado pela compra!</p>
           <p>Sua licença é:</p>
           <p><b>${licenseKey}</b></p>
           <p>Use-a na página de ativação / registro do app.</p>`
  };

  try {
    await sgMail.send(msg);
    console.log('[SENDGRID] Email enviado para', toEmail);
  } catch (err) {
    console.error('[SENDGRID] Erro no envio do email:', err);
    if (err.response && err.response.body) console.error('[SENDGRID] Detalhes:', err.response.body);
  }
}

// ===================== ROTA DE TESTE (adicionar/remover quando quiser) =====================
router.post('/test-webhook', async (req, res) => {
  // loga headers e body para confirmar que chegou
  console.log('[TEST-WEBHOOK] Chegou requisição:', {
    headers: req.headers,
    body: req.body,
    time: new Date().toISOString()
  });
  res.json({ ok: true, msg: 'test webhook recebido' });
});
// ===========================================================================================

// ===================== STRIPE - criar sessão de checkout =====================
router.post('/create-checkout-session', async (req, res) => {
  const stripe = req.app.locals.stripe;
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';

  if (!stripe) {
    console.error('[STRIPE] Stripe não configurado.');
    return res.status(500).json({ error: 'Stripe não configurado no servidor' });
  }

  const { priceId, customerEmail } = req.body;
  if (!priceId || !customerEmail) return res.status(400).json({ error: 'priceId e customerEmail são obrigatórios' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      success_url: `${FRONTEND_URL}/auth?checkout=success`,
      cancel_url: `${FRONTEND_URL}/auth?checkout=cancel`,
      metadata: { customerEmail }
    });

    console.log('[STRIPE] Checkout session criada:', session.id);
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[STRIPE] Erro ao criar checkout session:', err);
    res.status(500).json({ error: 'erro ao criar sessão de checkout' });
  }
});

// ===================== STRIPE - webhook (válido) =====================
router.post('/stripe-webhook', async (req, res) => {
  const stripe = req.app.locals.stripe;
  const webhookSecret = req.app.locals.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    console.error('[STRIPE] Webhook sem configuração (stripe ou secret ausente).');
    return res.status(500).send('Webhook não configurado');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[STRIPE] Erro ao validar webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('[STRIPE] EVENTO:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email =
      (session.customer_details && session.customer_details.email) ||
      (session.metadata && session.metadata.customerEmail);

    console.log('[STRIPE] Criando licença para:', email);
    if (email) {
      try {
        const licenseKey = crypto.randomBytes(16).toString('hex');
        await pool.query(
          `INSERT INTO licenses (user_id, license_key, used, created_at) VALUES (NULL, $1, false, now())`,
          [licenseKey]
        );
        await sendLicenseEmail(email, licenseKey);
        console.log('[STRIPE] Licença salva e email enviado:', licenseKey);
      } catch (err) {
        console.error('[STRIPE] Erro ao gerar/salvar licença:', err);
      }
    } else {
      console.error('[STRIPE] checkout.session.completed sem email');
    }
  }

  res.json({ received: true });
});

// ===================== TEST - criar licença manual =====================
router.post('/test-create-license', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email obrigatório' });

  try {
    const licenseKey = crypto.randomBytes(16).toString('hex');
    await pool.query(
      `INSERT INTO licenses (user_id, license_key, used, created_at) VALUES (NULL, $1, false, now())`,
      [licenseKey]
    );
    await sendLicenseEmail(email, licenseKey);
    res.json({ ok: true, licenseKey });
  } catch (err) {
    console.error('test-create-license error:', err);
    res.status(500).json({ error: 'erro ao criar licença' });
  }
});

// ===================== REGISTER / LOGIN / VERIFY =====================
// (mesmo código que já tínhamos — mantido)
router.post('/register', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(6), licenseKey: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

  const { email, password, licenseKey } = parsed.data;
  try {
    const licRes = await pool.query(`SELECT * FROM licenses WHERE license_key = $1 AND user_id IS NULL LIMIT 1`, [licenseKey]);
    if (!licRes.rows.length) return res.status(400).json({ error: 'Licença inválida ou já usada' });

    const hashed = await bcrypt.hash(password, 10);
    const userInsert = await pool.query(
      `INSERT INTO users (email, password_hash, name, created_at) VALUES ($1, $2, '', now()) RETURNING id`,
      [email, hashed]
    );
    const userId = userInsert.rows[0].id;
    await pool.query(`UPDATE licenses SET user_id = $1, used = true WHERE license_key = $2`, [userId, licenseKey]);
    res.json({ ok: true, message: 'Usuário criado e licença ativada' });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'erro no servidor' });
  }
});

router.post('/login', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

  const { email, password } = parsed.data;
  try {
    const userRes = await pool.query(`SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (!userRes.rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });

    const user = userRes.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    const licRes = await pool.query(`SELECT license_key FROM licenses WHERE user_id = $1 LIMIT 1`, [user.id]);
    res.json({ ok: true, userId: user.id, license: licRes.rows[0] || null });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'erro servidor' });
  }
});

router.post('/verify-license', async (req, res) => {
  const { license, email } = req.body;
  if (!license) return res.status(400).json({ valid: false, error: 'licença vazia' });

  try {
    const licRes = await pool.query(`SELECT * FROM licenses WHERE license_key = $1`, [license]);
    if (!licRes.rows.length) return res.json({ valid: false });

    const lic = licRes.rows[0];
    if (email && lic.user_id) {
      const user = await pool.query(`SELECT email FROM users WHERE id = $1`, [lic.user_id]);
      if (user.rows.length && user.rows[0].email !== email) return res.json({ valid: false });
    }
    return res.json({ valid: true });
  } catch (err) {
    console.error('verify-license error', err);
    return res.status(500).json({ error: 'erro servidor' });
  }
});

// ---------------- Exporta router ----------------
module.exports = router;
