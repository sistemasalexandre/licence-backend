// server/db.js
// PostgreSQL connection using pg Pool
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL not set in env');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // For Supabase use SSL: set DB_SSL=true in environment
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

module.exports = { pool };
