// Parte do server/index.js (cole dentro do seu arquivo existente, substituindo handlers correspondentes)
const express = require('express');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(require('cors')({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

/* Register (mantém o que já tem) */
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
    const { data: exists } = await supabase.from('users').select('id').eq('email', email).limit(1);
    if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe' });
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([{ email, password_hash: hash, name }]).select();
    if (error) throw error;
    res.json({ ok: true, user: { id: data[0].id, email: data[0].email } });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

/* Login (mantém o que já tem, verificando licença por code) */
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data } = await supabase.from('users').select('*').eq('email', email).limit(1);
    const user = data && data[0];
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

    // checar se existe associação em user_licenses (pelo email)
    const { data: ul } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
    const hasLicense = ul && ul.length > 0;
    res.json({ ok: true, user: { id: user.id, email: user.email }, hasLicense: !!hasLicense });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

/* Ativar licença por CODE (usa coluna 'code' como chave) */
app.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email e code necessários' });

    // 1) buscar license pela column "code"
    const { data: licData, error: errLic } = await supabase.from('licenses').select('*').eq('code', code).limit(1);
    if (errLic) throw errLic;
    const license = licData && licData[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada' });
    if (license.status && license.status !== 'available' && license.status !== 'unused') {
      return res.status(400).json({ error: 'Licença não disponível' });
    }

    // 2) criar associação em user_licenses
    const { error: errInsert } = await supabase.from('user_licenses').insert([{
      user_email: email,
      license_key: license.license_key ?? license.code -- || license.code
    }]);
    if (errInsert) throw errInsert;

    // 3) atualizar status da license para used + quem usou
    const { error: errUpd } = await supabase.from('licenses')
      .update({ status: 'used', used_by: email, used_at: new Date().toISOString() })
      .eq('code', code);

    if (errUpd) throw errUpd;
    res.json({ ok: true, message: 'Licença ativada' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

/* Endpoint opcional: checar licença por email (retorna hasLicense boolean) */
app.get('/api/has-license', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email é necessário' });
    const { data: ul } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
    res.json({ ok: true, hasLicense: !!(ul && ul.length) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});
