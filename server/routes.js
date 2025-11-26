// server/routes.js
// ARQUIVO COMPLETO — VERSÃO FINAL

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Supabase e Stripe entram aqui via init(deps)
let supabase = null;
let stripe = null;

/* -------------------------------------------------------------
   Inicialização das dependências externas
------------------------------------------------------------- */
function init(deps = {}) {
  if (deps.supabase) supabase = deps.supabase;
  if (deps.stripe) stripe = deps.stripe;
}

/* -------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
function genLicenseCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}

/* -------------------------------------------------------------
   Middleware JSON
------------------------------------------------------------- */
router.use(express.json());

/* =============================================================
   ROTA: Register
============================================================= */
router.post('/api/register', async (req, res) => {
  try
