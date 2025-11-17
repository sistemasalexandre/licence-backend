// create-tables.js
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_licenses (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(64) UNIQUE NOT NULL,
        email TEXT NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT timezone('utc', now())
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT timezone('utc', now())
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_licenses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        license_key VARCHAR(64) NOT NULL,
        activated_at TIMESTAMP DEFAULT timezone('utc', now())
      );
    `);
    console.log('Tabelas criadas/confirmadas: pending_licenses, users, user_licenses');
    await client.end();
    process.exit(0);
  } catch (e) {
    console.error('Erro criando tabelas:', e.message || e);
    process.exit(1);
  }
})();
