// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// cadastrar usuário (rota /api/register)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

    // checar se já existe
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1);

    if (existing && existing.length) return res.status(400).json({ error: 'Usuário já existe' });

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password_hash: hashed, created_at: new Date().toISOString() }])
      .select();

    if (error) throw error;
    res.json({ ok: true, user: data[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

// login simples (rota /api/login)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

    // aqui você pode gerar um JWT próprio ou retornar ok e user id
    res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ativar licença: associa license.key ao email (rota /api/activate-license)
app.post('/api/activate-license', async (req, res) => {
  try {
    const { email, key } = req.body;
    if (!email || !key) return res.status(400).json({ error: 'email e key são necessários' });

    // checar licença válida
    const { data: licData } = await supabase
      .from('licenses')
      .select('*')
      .eq('key', key)
      .limit(1);

    const license = licData && licData[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada' });
    if (license.status !== 'available' && license.status !== 'unused') return res.status(400).json({ error: 'Licença não disponível' });

    // associar
    const { error } = await supabase
      .from('user_licenses')
      .insert([{ user_email: email, license_key: key, activated_at: new Date().toISOString() }]);

    if (error) throw error;

    // atualizar status da license
    await supabase
      .from('licenses')
      .update({ status: 'used', used_by: email, used_at: new Date().toISOString() })
      .eq('key', key);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server rodando porta ${PORT}`));
