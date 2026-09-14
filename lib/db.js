const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env (Supabase connection string).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let initPromise = null;

function init() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE SCHEMA IF NOT EXISTS kkal;

      CREATE TABLE IF NOT EXISTS kkal.entries (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        meal TEXT NOT NULL,
        name TEXT NOT NULL,
        grams DOUBLE PRECISION,
        calories DOUBLE PRECISION NOT NULL DEFAULT 0,
        protein DOUBLE PRECISION NOT NULL DEFAULT 0,
        fat DOUBLE PRECISION NOT NULL DEFAULT 0,
        carbs DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_entries_date ON kkal.entries(date);

      CREATE TABLE IF NOT EXISTS kkal.settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS kkal.weight_logs (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        weight DOUBLE PRECISION NOT NULL,
        photo TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_weight_date ON kkal.weight_logs(date);

      CREATE TABLE IF NOT EXISTS kkal.products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        calories DOUBLE PRECISION NOT NULL DEFAULT 0,
        protein DOUBLE PRECISION NOT NULL DEFAULT 0,
        fat DOUBLE PRECISION NOT NULL DEFAULT 0,
        carbs DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_products_name ON kkal.products (lower(name));
    `);
  }
  return initPromise;
}

async function query(text, params) {
  await init();
  return pool.query(text, params);
}

module.exports = { query, pool };
