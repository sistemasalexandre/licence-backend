// server/db.js — VERSÃO FINAL E OTIMIZADA PARA RENDER

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERRO: Variável DATABASE_URL não definida.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Testa conexão automaticamente ao iniciar
pool.connect()
  .then(() => console.log('🟩 Conectado ao PostgreSQL com sucesso!'))
  .catch(err => {
    console.error('❌ ERRO ao conectar no PostgreSQL:', err.message);
    process.exit(1);
  });

module.exports = pool;
