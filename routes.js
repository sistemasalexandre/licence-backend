// server/routes.js
// API routes: /register, /login, /redeem, /stripe-webhook
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || ''); // set STRIPE_SECRET_KEY env
// Config
const JWT_SECRET = process.env.JWT_SECRET || 'troque_isto_em_producao';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

// helper to create JWT
function createJwt(user) {
  const payload = { userId: user.id, email: user.email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// --------------- Register ---------------
router.post('/register', async (req, res) => {
  try {
    const { email, password, licenseCode } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'password_too_short' });

    const client = await pool.connect();
    try {
      const exists = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email.toLowerCase()]);
      if (exists.rows.length) return res.status(409).json({ error: 'email_exists' });

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const insert = await client.query(
        'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, now()) RETURNING id, email',
        [email.toLowerCase(), hash]
      );
      const user = insert.rows[0];

      // If licenseCode provided, try to associate
      if (licenseCode) {
        const licQ = await client.query(
          `SELECT id, code, license_key, status FROM licenses WHERE code = $1 OR license_key = $1 LIMIT 1`,
          [licenseCode]
        );
        if (licQ.rows.length) {
          const lic = licQ.rows[0];
          if (lic.status === 'available' || lic.status === 'sold') {
            await client.query('BEGIN');
            await client.query(`UPDATE licenses SET user_id=$1, status='redeemed', sold_at=now() WHERE id=$2`, [user.id, lic.id]);
            try {
              await client.query(`INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now()) ON CONFLICT DO NOTHING`, [user.id, lic.id]);
            } catch (e) { /* ignore if table missing */ }
            await client.query('COMMIT');
          }
        }
      }

      const token = createJwt(user);
      return res.json({ ok: true, token });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
});

// --------------- Login ---------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

    const client = await pool.connect();
    try {
      const q = await client.query('SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1', [email.toLowerCase()]);
      if (!q.rows.length) return res.status(404).json({ error: 'user_not_found' });
      const user = q.rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      const token = createJwt(user);
      return res.json({ ok: true, token });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
});

// --------------- Redeem (ativar licença) ---------------
router.post('/redeem', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'email_and_code_required' });

    const client = await pool.connect();
    try {
      // Try license lookup by common column names
      let licQ = await client.query(`SELECT id, code, license_key, status, user_id FROM licenses WHERE license_key = $1 LIMIT 1`, [code]);
      if (!licQ.rows.length) {
        licQ = await client.query(`SELECT id, code, license_key, status, user_id FROM licenses WHERE code = $1 LIMIT 1`, [code]);
      }
      if (!licQ.rows.length) return res.status(404).json({ error: 'license_not_found' });

      const lic = licQ.rows[0];
      if (lic.user_id && (lic.status === 'redeemed' || lic.status === 'used')) {
        return res.status(400).json({ error: 'license_already_redeemed' });
      }

      // find or create user
      let userRes = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email.toLowerCase()]);
      let userId;
      if (userRes.rows.length) {
        userId = userRes.rows[0].id;
      } else {
        const ins = await client.query('INSERT INTO users (email, created_at) VALUES ($1, now()) RETURNING id', [email.toLowerCase()]);
        userId = ins.rows[0].id;
      }

      // associate and update status inside transaction
      await client.query('BEGIN');
      await client.query('UPDATE licenses SET user_id=$1, status=$2, sold_at=now() WHERE id=$3', [userId, 'redeemed', lic.id]);
      try {
        await client.query('INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now()) ON CONFLICT DO NOTHING', [userId, lic.id]);
      } catch (e) {
        console.warn('user_licenses insert skipped:', e.message || e);
      }
      await client.query('COMMIT');

      return res.json({ ok: true, message: 'Licença ativada', license: lic.code || lic.license_key });
    } catch (e) {
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('redeem error', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
});

// --------------- Stripe webhook ---------------
// This route expects the raw body (see server/index.js which skips JSON parsing for this path)
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Stripe webhook secret not configured');
    return res.status(500).send('Webhook secret not configured');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.customer_email || (session.customer && session.customer.email);
      const priceId = session.metadata?.priceId || (session.display_items && session.display_items[0]?.price?.id);

      // create a license code and insert into DB
      const code = 'LIC-' + Math.random().toString(36).slice(2,9).toUpperCase();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO licenses (code, price_id, status, metadata, sold_at) VALUES ($1,$2,'sold',$3, now())`,
          [code, priceId || null, JSON.stringify({ stripe_session: session.id, customer_email: customerEmail })]
        );
        // if user exists, associate
        if (customerEmail) {
          const u = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [customerEmail.toLowerCase()]);
          if (u.rows.length) {
            const lic = await client.query('SELECT id FROM licenses WHERE code = $1 LIMIT 1', [code]);
            await client.query('INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now())', [u.rows[0].id, lic.rows[0].id]);
            await client.query('UPDATE licenses SET status = $1 WHERE id = $2', ['redeemed', lic.rows[0].id]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(()=>{});
        console.error('Error processing checkout session:', e);
      } finally {
        client.release();
      }
    }
    // respond to Stripe
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook processing error', e);
    res.status(500).send();
  }
});

module.exports = router;
