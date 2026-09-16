const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env (Supabase connection string).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
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

      CREATE TABLE IF NOT EXISTS kkal.step_logs (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        steps INTEGER NOT NULL DEFAULT 0,
        distance_km DOUBLE PRECISION,
        calories DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_step_date ON kkal.step_logs(date);

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

      ALTER TABLE kkal.entries ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat_text';
      ALTER TABLE kkal.entries ADD COLUMN IF NOT EXISTS estimated BOOLEAN DEFAULT false;
      ALTER TABLE kkal.entries ADD COLUMN IF NOT EXISTS product_id INTEGER;
      ALTER TABLE kkal.weight_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat_text';
      ALTER TABLE kkal.step_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat_text';

      CREATE TABLE IF NOT EXISTS kkal.goal_history (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_goal_history_date ON kkal.goal_history(date);

      CREATE TABLE IF NOT EXISTS kkal.chat_messages (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_date ON kkal.chat_messages(date);
    `).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (err && (err.code === '42P01' || err.code === '3F000')) {
      console.warn('Table or schema missing, running init()...');
      await init();
      return pool.query(text, params);
    }
    throw err;
  }
}

module.exports = { query, pool, init };
