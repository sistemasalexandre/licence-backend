<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Acesso — Controle Financeiro</title>
<style>
  :root{
    --bg:#0b1220; --card:#0f1724; --text:#e6eef8; --muted:#94a3b8;
    --accent:#246bff; --accent-2:#2bbbad; --glass: rgba(255,255,255,0.03);
    --radius:16px;
  }
  html,body{height:100%;margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:linear-gradient(135deg,#071028 0%, #071827 60%);color:var(--text)}
  .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:28px}
  .panel{width:440px;max-width:94%;background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));border-radius:var(--radius);box-shadow:0 18px 50px rgba(2,6,23,0.6);padding:22px;backdrop-filter: blur(6px);border:1px solid rgba(255,255,255,0.03)}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:10px;justify-content:center}
  .logo{width:56px;height:56px;border-radius:12px;background:linear-gradient(90deg,var(--accent),#1fb3ff);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:20px}
  h1{margin:0;font-size:20px;text-align:center}
  p.lead{margin:6px 0 18px;color:var(--muted);font-size:0.95rem}
  label{display:block;font-size:0.9rem;margin-top:10px;color:rgba(234,244,255,0.95)}
  input[type="text"], input[type="password"], input[type="email"]{width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);color:var(--text);outline:none}
  .row{display:flex;gap:8px;margin-top:12px}
  button.cta{width:100%;padding:11px;border-radius:12px;border:none;background:linear-gradient(90deg,var(--accent), #1fb3ff);color:#fff;font-weight:700;cursor:pointer;box-shadow:0 8px 18px rgba(36,107,255,0.12)}
  .ghost{background:transparent;border:1px solid rgba(255,255,255,0.06);color:var(--text)}
  .muted{color:var(--muted);font-size:0.9rem}
  .tabs{display:flex;gap:8px;margin-bottom:8px}
  .tab{flex:1;padding:8px;border-radius:8px;text-align:center;cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.03)}
  .tab.active{background:rgba(255,255,255,0.03);box-shadow:inset 0 -4px 16px rgba(0,0,0,0.2)}
  .small{font-size:0.85rem}
  .license-help{font-size:0.85rem;color:var(--muted);margin-top:6px}
  .error{color:#ffb3b3;margin-top:8px}
  footer{margin-top:14px;text-align:center;color:var(--muted);font-size:0.95rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="panel" role="main" aria-labelledby="title">
    <div class="brand">
      <div class="logo" aria-hidden="true">CF</div>
      <div>
        <h1 id="title">Acesso ao Controle Financeiro</h1>
      </div>
    </div>

    <div class="tabs" role="tablist">
      <div class="tab active" data-tab="login">Entrar</div>
      <div class="tab" data-tab="register">Criar Conta</div>
      <div class="tab" data-tab="redeem">Ativar Licença</div>
    </div>

    <!-- BOTÃO DE COMPRA -->
    <button id="buy-btn" data-price-id="price_1SUyMaRtlxX0MLkFRup9JN3Y" class="cta" style="margin-bottom:15px;width:100%">
      Comprar licença
    </button>

    <!-- LOGIN -->
    <div id="login" class="pane">
      <label for="login_user">Usuário (e-mail)</label>
      <input id="login_user" type="email" placeholder="seu@exemplo.com" autocomplete="username">
      <label for="login_pass">Senha</label>
      <input id="login_pass" type="password" placeholder="••••••••" autocomplete="current-password">
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="btnLogin" class="cta">Entrar</button>
        <button id="btnDemo" class="cta ghost" style="width:120px">Demo</button>
      </div>
      <div class="error" id="loginError" style="display:none"></div>
      <div class="muted small" style="margin-top:10px">Não tem conta? <a href="#" id="toRegister" style="color:inherit;text-decoration:underline">Crie uma</a></div>
    </div>

    <!-- REGISTER -->
    <div id="register" class="pane" style="display:none">
      <label for="reg_user">E-mail</label>
      <input id="reg_user" type="email" placeholder="seu@exemplo.com" autocomplete="email">
      <label for="reg_pass">Senha (mín 8 caracteres)</label>
      <input id="reg_pass" type="password" placeholder="Senh@123" autocomplete="new-password">
      <label for="reg_pass2">Repita a senha</label>
      <input id="reg_pass2" type="password" placeholder="Repita a senha">
      <label for="reg_license">Código de licença (opcional)</label>
      <input id="reg_license" type="text" placeholder="AAAAA-11111" autocomplete="off">
      <div class="license-help">Se você comprou, insira o código de ativação. Se ainda não comprou, deixe em branco e crie uma conta de avaliação (Demo).</div>

      <div class="row">
        <button id="btnRegister" class="cta">Criar conta</button>
        <button id="btnBackLogin" class="cta ghost" style="width:120px">Voltar</button>
      </div>
      <div class="error" id="regError" style="display:none"></div>
    </div>

    <!-- REDEEM -->
    <div id="redeem" class="pane" style="display:none">
      <label for="redeem_email">E-mail cadastrado</label>
      <input id="redeem_email" type="email" placeholder="seu@exemplo.com">
      <label for="redeem_code">Código de licença</label>
      <input id="redeem_code" type="text" placeholder="ABCDE-12345">
      <div class="row">
        <button id="btnRedeem" class="cta">Ativar</button>
        <button id="btnRedeemBack" class="cta ghost" style="width:120px">Voltar</button>
      </div>
      <div class="error" id="redeemError" style="display:none"></div>
    </div>

    <footer>Controle Financeiro: organize suas despesas, receitas e investimentos em um só lugar. Ative sua licença.</footer>
  </div>
</div>

<script>
/* ============================
   CONFIG — ajuste aqui se necessário
   ============================ */
const BACKEND_BASE = 'https://licence-backend-api.onrender.com'; // substitua se for outro domínio
/* ============================ */

/* ---------- DOM helpers ---------- */
function $(id){ return document.getElementById(id); }
const tabs = document.querySelectorAll('.tab');
const buyBtn = document.getElementById('buy-btn');

tabs.forEach(t=> t.addEventListener('click', ()=> {
  document.querySelectorAll('.tab').forEach(tt=>tt.classList.remove('active'));
  t.classList.add('active');
  const target = t.dataset.tab;
  document.querySelectorAll('.pane').forEach(p=> p.style.display = p.id === target ? '' : 'none');
  ['loginError','regError','redeemError'].forEach(x=>{ const el=$(x); if(el) el.style.display='none'; });

  // Hide buy button when in "Criar Conta" tab
  try{
    if(buyBtn){
      buyBtn.style.display = (target === 'register') ? 'none' : '';
    }
  }catch(e){}
}));

/* ---------- Local auth state (minimal) ----------
 We store only the logged-in email in localStorage so the app can keep session.
 The actual auth (users/password) is handled by the backend (DB).
----------------------------------------------- */
const AUTH_EMAIL_KEY = 'cf_logged_email';
function setLoggedEmail(email){ if(email) localStorage.setItem(AUTH_EMAIL_KEY, email); else localStorage.removeItem(AUTH_EMAIL_KEY); }
function getLoggedEmail(){ return localStorage.getItem(AUTH_EMAIL_KEY) || null; }

/* ---------- Small helpers ---------- */
function showErr(id, msg){ const el=$(id); if(!el) return; el.textContent = msg; el.style.display = 'block'; }
function hideErr(id){ const el=$(id); if(el) el.style.display='none'; }
function showMsg(msg){ try{ if(window.cf_toast){ window.cf_toast(msg); return; } }catch(e){} alert(msg); }

/* ---------- Register (Create account) ----------
 Flow:
 1) POST /api/register { email, password, name? }
  - on success, optionally activate license if user entered code (calls /api/activate-license)
  - then redirect:
    - if hasLicense true -> index.html
    - else -> demo page
----------------------------------------------- */
$('btnRegister').addEventListener('click', async ()=>{
  try{
    hideErr('regError');
    const email = $('reg_user').value.trim().toLowerCase();
    const pass = $('reg_pass').value;
    const pass2 = $('reg_pass2').value;
    const license = $('reg_license').value.trim();
    if(!email || !pass){ showErr('regError','Preencha e-mail e senha.'); return; }
    if(pass.length < 8){ showErr('regError','Use pelo menos 8 caracteres na senha.'); return; }
    if(pass !== pass2){ showErr('regError','Senhas não coincidem.'); return; }

    // 1) register
    const r1 = await fetch(BACKEND_BASE + '/api/register', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    if(!r1.ok){
      const t = await r1.text();
      showErr('regError', 'Erro ao cadastrar: ' + (t || r1.status));
      return;
    }
    const j1 = await r1.json();
    if(!j1.ok){ showErr('regError', j1.error || 'Erro ao cadastrar'); return; }

    // 2) if license was provided at registration, try to activate it
    let hasLicense = false;
    if(license){
      try{
        const r2 = await fetch(BACKEND_BASE + '/api/activate-license', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ email, code: license })
        });
        if(r2.ok){
          const j2 = await r2.json();
          if(j2.ok) hasLicense = true;
          else console.warn('activate-license returned not ok', j2);
        } else {
          console.warn('activate-license status', r2.status);
        }
      }catch(e){
        console.warn('activate-license failed', e);
      }
    }

    // 3) set logged email and redirect
    setLoggedEmail(email);
    showMsg('Conta criada com sucesso.');
    if(hasLicense) { window.location.href = '/index.html'; }
    else { window.location.href = '/demo.html'; }

  }catch(e){
    console.error(e);
    showErr('regError', 'Erro: ' + (e.message || e));
  }
});

/* ---------- Login ----------
 Flow:
 - POST /api/login { email, password }
 - response: { ok:true, user:{...}, hasLicense: boolean }
 - set logged email and redirect accordingly
----------------------------------------------- */
$('btnLogin').addEventListener('click', async ()=>{
  try{
    hideErr('loginError');
    const email = $('login_user').value.trim().toLowerCase();
    const pass = $('login_pass').value;
    if(!email||!pass){ showErr('loginError','Preencha usuário e senha.'); return; }

    const r = await fetch(BACKEND_BASE + '/api/login', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    if(!r.ok){
      const t = await r.text();
      showErr('loginError','Erro ao logar: ' + (t || r.status));
      return;
    }
    const j = await r.json();
    if(!j.ok){ showErr('loginError', j.error || 'Erro no login'); return; }

    setLoggedEmail(email);
    if(j.hasLicense) window.location.href = '/index.html';
    else window.location.href = '/demo.html';
  }catch(e){
    console.error(e);
    showErr('loginError', 'Erro: ' + (e.message || e));
  }
});

/* ---------- Redeem / Activate license (logged-in or not) ----------
 Flow:
 - POST /api/activate-license { email, code }
 - on success redirect to index.html
----------------------------------------------- */
$('btnRedeem').addEventListener('click', async ()=>{
  try{
    hideErr('redeemError');
    const email = $('redeem_email').value.trim().toLowerCase();
    const code = $('redeem_code').value.trim();
    if(!email || !code){ showErr('redeemError','Preencha e-mail e código.'); return; }

    const r = await fetch(BACKEND_BASE + '/api/activate-license', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ email, code })
    });
    if(!r.ok){
      const txt = await r.text();
      showErr('redeemError', 'Erro ao ativar: ' + (txt || r.status));
      return;
    }
    const j = await r.json();
    if(!j.ok){ showErr('redeemError', j.error || 'Erro ao ativar'); return; }

    // se o usuário estiver logado, atualizamos local storage (logged email)
    const logged = getLoggedEmail();
    if(logged && logged === email){
      // nothing else to do client-side: backend updated user_licenses
    } else {
      // set as logged (optional) so they can access index if desired
      setLoggedEmail(email);
    }

    showMsg('Licença ativada! Você já pode entrar no app completo.');
    window.location.href = '/index.html';
  }catch(e){
    console.error(e);
    showErr('redeemError','Erro: ' + (e.message || e));
  }
});

/* ---------- Demo shortcut ---------- */
$('btnDemo').addEventListener('click', ()=>{
  showMsg('Entrando na versão DEMO.');
  window.location.href = '/demo.html';
});

/* ---------- Navigation helpers ---------- */
$('toRegister').addEventListener('click', (e)=>{ e.preventDefault(); document.querySelector('.tab[data-tab="register"]').click(); });
$('btnBackLogin').addEventListener('click', ()=> document.querySelector('.tab[data-tab="login"]').click());
$('btnRedeemBack').addEventListener('click', ()=> document.querySelector('.tab[data-tab="login"]').click());

/* ---------- init: hide buy button if register is active ---------- */
(function(){
  try{
    const active = document.querySelector('.tab.active');
    if(active && active.dataset.tab === 'register' && buyBtn) buyBtn.style.display = 'none';
  }catch(e){}
})();
</script>

<!-- ============================
     SNIPPET: Stripe Checkout integrado ao backend
     - abre a sessão criada no backend (/api/create-checkout-session)
     - backend deve receber customerEmail para atrelamento posterior
     ============================ -->
<script>
(async () => {
  const buyBtn = document.getElementById('buy-btn');
  if (!buyBtn) return;

  async function createCheckoutSession(priceId, customerEmail) {
    try {
      const url = BACKEND_BASE + '/api/create-checkout-session';
      const body = { priceId, customerEmail };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error('Erro: ' + (t || resp.status));
      }
      const j = await resp.json();
      if (!j.url) throw new Error('Resposta inválida do servidor');
      window.location.href = j.url;
    } catch (err) {
      console.error('createCheckoutSession error', err);
      alert('Falha ao iniciar pagamento: ' + (err.message || err));
    }
  }

  buyBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const btn = ev.currentTarget;
    const priceId = btn.dataset.priceId || 'price_test_123';

    // prefer email já logado ou preenchido no formulário
    let customerEmail = getLoggedEmail();
    try{
      if(!customerEmail){
        const emailField = document.getElementById('login_user') || document.getElementById('reg_user');
        if(emailField && emailField.value) customerEmail = emailField.value.trim().toLowerCase();
      }
    }catch(e){}

    if(!customerEmail){
      customerEmail = prompt('Digite seu e-mail para receber a licença (recomendado)') || '';
      customerEmail = customerEmail.trim().toLowerCase();
    }

    btn.disabled = true;
    const previous = btn.textContent;
    btn.textContent = 'Aguarde...';

    await createCheckoutSession(priceId, customerEmail || undefined);

    btn.disabled = false;
    btn.textContent = previous;
  });
})();
</script>

</body>
</html>
