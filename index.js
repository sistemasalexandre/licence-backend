

## server/index.js

```js
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

/* Health check */
app.get('/', (req, res) => res.send('Licence backend OK'));

/* Register */
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data: exists, error: errExists } = await supabase.from('users').select('id').eq('email', email).limit(1);
    if (errExists) throw errExists;
    if (exists && exists.length) return res.status(400).json({ error: 'Usuário já existe' });

    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([{ email, password_hash: hash, name }]).select();
    if (error) throw error;

    res.json({ ok: true, user: { id: data[0].id, email: data[0].email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

/* Login */
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

    const { data: ul, error: errUl } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
    if (errUl) throw errUl;
    const hasLicense = ul && ul.length > 0;

    res.json({ ok: true, user: { id: user.id, email: user.email }, hasLicense: !!hasLicense });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

/* Activate license by code (uses `code` column) */
app.post('/api/activate-license', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email e code necessários' });

    const { data: licData, error: errLic } = await supabase.from('licenses').select('*').eq('code', code).limit(1);
    if (errLic) throw errLic;
    const license = licData && licData[0];
    if (!license) return res.status(400).json({ error: 'Licença não encontrada' });
    if (license.status && license.status !== 'available' && license.status !== 'unused') {
      return res.status(400).json({ error: 'Licença não disponível' });
    }

    // insert association (avoid duplicate associations)
    const { data: insertCheck } = await supabase.from('user_licenses').select('id').eq('user_email', email).eq('license_key', license.license_key ?? license.code).limit(1);
    if (insertCheck && insertCheck.length) {
      // already associated
    } else {
      const { error: errInsert } = await supabase.from('user_licenses').insert([{
        user_email: email,
        license_key: license.license_key ?? license.code,
        activated_at: new Date().toISOString()
      }]);
      if (errInsert) throw errInsert;
    }

    const { error: errUpd } = await supabase.from('licenses').update({ status: 'used', used_by: email, used_at: new Date().toISOString() }).eq('code', code);
    if (errUpd) throw errUpd;

    res.json({ ok: true, message: 'Licença ativada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

/* Check license by email */
app.get('/api/has-license', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email é necessário' });
    const { data: ul } = await supabase.from('user_licenses').select('*').eq('user_email', email).limit(1);
    res.json({ ok: true, hasLicense: !!(ul && ul.length) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'erro' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));
```

---

## auth.html (página simples com register / login / ativar)

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Auth - Licences</title>
  <style>
    body{font-family:Inter,Arial,Helvetica,sans-serif;padding:20px;background:#f7f7f7}
    .card{background:#fff;padding:18px;border-radius:8px;max-width:420px;margin:12px auto;box-shadow:0 6px 18px rgba(0,0,0,0.06)}
    input{width:100%;padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:6px}
    button{padding:10px 14px;border:0;background:#2563eb;color:#fff;border-radius:6px;cursor:pointer}
    .muted{color:#666;font-size:13px}
  </style>
</head>
<body>
  <div class="card">
    <h3>Registrar</h3>
    <input id="reg_email" placeholder="email" />
    <input id="reg_name" placeholder="nome (opcional)" />
    <input id="reg_pass" placeholder="senha" type="password" />
    <button onclick="register()">Cadastrar</button>
    <p class="muted">Já cadastrado? use o formulário de login abaixo.</p>
  </div>

  <div class="card">
    <h3>Login</h3>
    <input id="login_email" placeholder="email" />
    <input id="login_pass" placeholder="senha" type="password" />
    <button onclick="login()">Entrar</button>
  </div>

  <div class="card">
    <h3>Ativar Licença</h3>
    <input id="act_email" placeholder="seu email (mesmo do cadastro)" />
    <input id="act_code" placeholder="código da licença (ex: ABC-123-TEST)" />
    <button onclick="activate()">Ativar</button>
  </div>

  <script>
    const BASE = window.location.origin; // assume backend no mesmo host; se for outro domínio, substitua

    async function register(){
      const email = document.getElementById('reg_email').value.trim();
      const password = document.getElementById('reg_pass').value;
      const name = document.getElementById('reg_name').value;
      const r = await fetch(BASE + '/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password, name }) });
      const j = await r.json();
      if (!j.ok) alert(j.error || 'erro'); else alert('Cadastro ok, faça login');
    }

    async function login(){
      const email = document.getElementById('login_email').value.trim();
      const password = document.getElementById('login_pass').value;
      const r = await fetch(BASE + '/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
      const j = await r.json();
      if (!j.ok){ alert(j.error || 'erro'); return; }
      // se tem licença => index.html, senão demo.html
      if (j.hasLicense) window.location.href = '/index.html'; else window.location.href = '/demo.html';
    }

    async function activate(){
      const email = document.getElementById('act_email').value.trim();
      const code = document.getElementById('act_code').value.trim();
      const r = await fetch(BASE + '/api/activate-license', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, code }) });
      const j = await r.json();
      if (!j.ok) alert(j.error || 'erro ao ativar'); else alert('Licença ativada. Faça login para acessar o app.');
    }
  </script>
</body>
</html>
```

---

### Observações finais rápidas

* Se o backend estiver em outro domínio (Render), substitua `BASE` em `auth.html` por `https://SEU-BACKEND-DOMAIN`.
* Certifique-se que no Render as ENV estão corretas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `ALLOWED_ORIGIN`.
* Depois de colar, envia aqui um teste (por exemplo: curl para /api/register) que eu valido.

Boa — colei os arquivos aqui para você copiar. Se quiser que eu gere também o `package.json` final ou um `.env.example` pronto para colar, eu gero agora.
