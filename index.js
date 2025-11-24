// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/* ---------- Register ---------- */
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data: exists, error: errExists } = await supabase.from('users').select('id').eq('email', email).limit(1);
    if (errExists) throw errExists;
    if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe' });

    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([{ email, password_hash: hash }]).select();
    if (error) throw error;
    res.json({ ok: true, user: { id: data[0].id, email: data[0].email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

/* ---------- Login ---------- */
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data, error } = await supabase.from('users').select('*').eq('email', email).limit(1);
    if (error) throw error;
    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

    // verificar licença associada
    const { data: ul, error: errUl } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
    if (errUl) throw errUl;
    const hasLicense = ul && ul.length > 0;

    // retorno simples; front decide redirecionamento
    res.json({ ok: true, user: { id: user.id, email: user.email }, hasLicense: !!hasLicense });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

/* ---------- Activate license ---------- */
app.post('/api/activate-license', async (req, res) => {
  try {
    const { email, key } = req.body;
    if (!email || !key) return res.status(400).json({ error: 'email e key necessários' });

    const { data: licData, error: errLic } = await supabase.from('licenses').select('*').eq('key', key).limit(1);
    if (errLic) throw errLic;
    const license = licData && licData[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada' });
    if (license.status && license.status !== 'available' && license.status !== 'unused') return res.status(400).json({ error: 'Licença não disponível' });

    // insere associação e atualiza status
    const { error: errInsert } = await supabase.from('user_licenses').insert([{ user_email: email, license_key: key }]);
    if (errInsert) throw errInsert;
    const { error: errUpd } = await supabase.from('licenses').update({ status: 'used', used_by: email, used_at: new Date().toISOString() }).eq('key', key);
    if (errUpd) throw errUpd;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

/* ---------- Health check ---------- */
app.get('/', (req, res) => res.send('Licence backend OK'));

/* ---------- Start ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));
