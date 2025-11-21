// server/db.js — Conexão com PostgreSQL no Render (SSL habilitado)

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERRO: DATABASE_URL não está definida nas variáveis do Render!');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false, // obrigatório para Render/Supabase/Heroku
  },
});

pool.on('connect', () => {
  console.log('[DATABASE] Conectado ao PostgreSQL com sucesso!');
});

pool.on('error', (err) => {
  console.error('⚠️ ERRO NO BANCO:', err);
});

module.exports = pool;
