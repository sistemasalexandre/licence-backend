// server/routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

// helper
function createJwt(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

// Register - server-side only
router.post('/register', async (req, res) => {
  try {
    const { email, password, licenseCode } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
    if (password.length < 8) return res.status(400).json({ error: 'weak_password' });

    const client = await pool.connect();
    try {
      const exists = await client.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (exists.rows.length) return res.status(409).json({ error: 'email_exists' });

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const ins = await client.query('INSERT INTO users (email, password_hash, created_at) VALUES ($1,$2,now()) RETURNING id,email', [email.toLowerCase(), hash]);
      const user = ins.rows[0];

      if (licenseCode) {
        const licQ = await client.query('SELECT id,status FROM licenses WHERE code=$1 OR license_key=$1 LIMIT 1', [licenseCode]);
        if (licQ.rows.length) {
          const lic = licQ.rows[0];
          if (lic.status === 'available' || lic.status === 'sold') {
            await client.query('BEGIN');
            await client.query('UPDATE licenses SET user_id=$1,status=$2,sold_at=now() WHERE id=$3', [user.id, 'redeemed', lic.id]);
            try {
              await client.query('INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now()) ON CONFLICT DO NOTHING', [user.id, lic.id]);
            } catch(e) {}
            await client.query('COMMIT');
          }
        }
      }

      const token = createJwt(user);
      return res.json({ ok: true, token });
    } finally {
      client.release();
    }
  } catch(e) {
    console.error('register error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Login - server-only
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const client = await pool.connect();
    try {
      const q = await client.query('SELECT id,email,password_hash FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (!q.rows.length) return res.status(404).json({ error: 'user_not_found' });
      const user = q.rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      const token = createJwt(user);
      return res.json({ ok: true, token });
    } finally {
      client.release();
    }
  } catch(e) {
    console.error('login error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Redeem - server-side activation for existing or new users
router.post('/redeem', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'missing_fields' });

    const client = await pool.connect();
    try {
      const licQ = await client.query('SELECT id,status,user_id FROM licenses WHERE code=$1 OR license_key=$1 LIMIT 1', [code]);
      if (!licQ.rows.length) return res.status(404).json({ error: 'license_not_found' });
      const lic = licQ.rows[0];
      if (lic.user_id && (lic.status === 'redeemed' || lic.status === 'used')) {
        return res.status(400).json({ error: 'license_already_redeemed' });
      }

      // find or create user
      let userQ = await client.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      let userId;
      if (userQ.rows.length) {
        userId = userQ.rows[0].id;
      } else {
        const ins = await client.query('INSERT INTO users (email, created_at) VALUES ($1, now()) RETURNING id', [email.toLowerCase()]);
        userId = ins.rows[0].id;
      }

      await client.query('BEGIN');
      await client.query('UPDATE licenses SET user_id=$1,status=$2,sold_at=now() WHERE id=$3', [userId, 'redeemed', lic.id]);
      try {
        await client.query('INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now()) ON CONFLICT DO NOTHING', [userId, lic.id]);
      } catch(e) {}
      await client.query('COMMIT');

      return res.json({ ok: true, message: 'license_redeemed' });
    } finally {
      client.release();
    }
  } catch(e) {
    console.error('redeem error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Claim-license - for already registered users to claim a purchased license
// Expects { email, code } and will attach license to that user's account if available
router.post('/claim-license', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'missing_fields' });

    const client = await pool.connect();
    try {
      // ensure user exists
      const u = await client.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (!u.rows.length) return res.status(404).json({ error: 'user_not_found' });
      const userId = u.rows[0].id;

      // find license
      const licQ = await client.query('SELECT id,status,user_id FROM licenses WHERE code=$1 OR license_key=$1 LIMIT 1', [code]);
      if (!licQ.rows.length) return res.status(404).json({ error: 'license_not_found' });
      const lic = licQ.rows[0];

      if (lic.user_id && lic.user_id !== null) {
        return res.status(400).json({ error: 'license_already_taken' });
      }

      // associate
      await client.query('BEGIN');
      await client.query('UPDATE licenses SET user_id=$1,status=$2,sold_at=now() WHERE id=$3', [userId, 'redeemed', lic.id]);
      try {
        await client.query('INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now()) ON CONFLICT DO NOTHING', [userId, lic.id]);
      } catch(e) {}
      await client.query('COMMIT');

      return res.json({ ok: true, message: 'license_claimed' });
    } finally {
      client.release();
    }
  } catch(e) {
    console.error('claim-license error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Stripe webhook - raw body
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Stripe webhook secret not set');
    return res.status(500).send('Missing webhook secret');
  }
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, secret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.customer_email || null;
      const priceId = session.metadata?.priceId || null;
      const code = 'LIC-' + Math.random().toString(36).slice(2,9).toUpperCase();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO licenses (code, price_id, status, metadata, sold_at) VALUES ($1,$2,$3,$4,now())', [code, priceId, 'sold', JSON.stringify({session: session.id, email: customerEmail})]);
        if (customerEmail) {
          const u = await client.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [customerEmail.toLowerCase()]);
          if (u.rows.length) {
            const lic = await client.query('SELECT id FROM licenses WHERE code=$1 LIMIT 1', [code]);
            await client.query('INSERT INTO user_licenses (user_id, license_id, activated_at, created_at) VALUES ($1,$2,now(),now())', [u.rows[0].id, lic.rows[0].id]);
            await client.query('UPDATE licenses SET status=$1 WHERE id=$2', ['redeemed', lic.rows[0].id]);
          }
        }
        await client.query('COMMIT');
      } catch(e) {
        await client.query('ROLLBACK').catch(()=>{});
        console.error('Error processing webhook', e);
      } finally {
        client.release();
      }
    }
    res.json({ received: true });
  } catch(e) {
    console.error('stripe webhook error', e);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

module.exports = router;
