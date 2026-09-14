try { process.loadEnvFile(); } catch { /* no .env file, rely on real env vars */ }

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { put, del } = require('@vercel/blob');
const db = require('../lib/db');
const { analyzeImage, analyzeProductLabel, chatParseFood, PROVIDERS } = require('../lib/ai');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadWeightPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

app.use(express.json());

const DEFAULT_SETTINGS = {
  goal_calories: '2000',
  goal_protein: '120',
  goal_fat: '65',
  goal_carbs: '250',
};

const AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
const AI_MODEL = process.env.AI_MODEL || '';
const AI_API_KEYS = {
  openai: process.env.OPENAI_API_KEY || '',
  gemini: process.env.GEMINI_API_KEY || '',
  grok: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
  anthropic: process.env.ANTHROPIC_API_KEY || '',
};

function asyncHandler(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
}

async function getSettings() {
  const { rows } = await db.query('SELECT key, value FROM kkal.settings');
  const map = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

app.get('/api/settings', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json({
    ...settings,
    ai_provider: AI_PROVIDER,
    ai_configured: Boolean(AI_API_KEYS[AI_PROVIDER]),
  });
}));

app.put('/api/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const entries = Object.entries(body).filter(([key]) => key in DEFAULT_SETTINGS);
  for (const [key, value] of entries) {
    await db.query(
      `INSERT INTO kkal.settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, String(value)]
    );
  }
  res.json({ ok: true });
}));

app.get('/api/providers', (req, res) => res.json(PROVIDERS));

app.get('/api/entries', asyncHandler(async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const { rows } = await db.query('SELECT * FROM kkal.entries WHERE date = $1 ORDER BY id ASC', [date]);
  res.json(rows);
}));

app.post('/api/entries', asyncHandler(async (req, res) => {
  const { date, meal, name, grams, calories, protein, fat, carbs } = req.body || {};
  if (!date || !meal || !name) return res.status(400).json({ error: 'date, meal, name required' });
  const { rows } = await db.query(
    `INSERT INTO kkal.entries (date, meal, name, grams, calories, protein, fat, carbs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      date,
      meal,
      name,
      grams != null ? Number(grams) : null,
      Number(calories) || 0,
      Number(protein) || 0,
      Number(fat) || 0,
      Number(carbs) || 0,
    ]
  );
  res.json(rows[0]);
}));

app.put('/api/entries/:id', asyncHandler(async (req, res) => {
  const { name, grams, calories, protein, fat, carbs, meal } = req.body || {};
  const { rows: existingRows } = await db.query('SELECT * FROM kkal.entries WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { rows } = await db.query(
    `UPDATE kkal.entries SET name=$1, grams=$2, calories=$3, protein=$4, fat=$5, carbs=$6, meal=$7 WHERE id=$8 RETURNING *`,
    [
      name ?? existing.name,
      grams != null ? Number(grams) : existing.grams,
      calories != null ? Number(calories) : existing.calories,
      protein != null ? Number(protein) : existing.protein,
      fat != null ? Number(fat) : existing.fat,
      carbs != null ? Number(carbs) : existing.carbs,
      meal ?? existing.meal,
      req.params.id,
    ]
  );
  res.json(rows[0]);
}));

app.delete('/api/entries/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM kkal.entries WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/recent', asyncHandler(async (req, res) => {
  const q = `%${(req.query.q || '').toString()}%`;
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (name) id, name, grams, calories, protein, fat, carbs
       FROM kkal.entries WHERE name ILIKE $1
       ORDER BY name, id DESC
     ) t ORDER BY id DESC LIMIT 8`,
    [q]
  );
  res.json(rows);
}));

app.post('/api/ai/analyze', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image required' });
  const items = await analyzeImage({
    provider: AI_PROVIDER,
    apiKey: AI_API_KEYS[AI_PROVIDER],
    model: AI_MODEL,
    base64: req.file.buffer.toString('base64'),
    mime: req.file.mimetype,
  });
  res.json({ items });
}));

app.post('/api/ai/chat', upload.single('image'), asyncHandler(async (req, res) => {
  let history = [];
  try { history = JSON.parse(req.body.history || '[]'); } catch { history = []; }
  const result = await chatParseFood({
    provider: AI_PROVIDER,
    apiKey: AI_API_KEYS[AI_PROVIDER],
    model: AI_MODEL,
    history,
    base64: req.file ? req.file.buffer.toString('base64') : null,
    mime: req.file ? req.file.mimetype : null,
  });
  res.json(result);
}));

app.get('/api/products', asyncHandler(async (req, res) => {
  const q = `%${(req.query.q || '').toString()}%`;
  const { rows } = await db.query(
    'SELECT * FROM kkal.products WHERE name ILIKE $1 ORDER BY name ASC LIMIT 50',
    [q]
  );
  res.json(rows);
}));

app.post('/api/products', asyncHandler(async (req, res) => {
  const { name, calories, protein, fat, carbs } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await db.query(
    `INSERT INTO kkal.products (name, calories, protein, fat, carbs)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, Number(calories) || 0, Number(protein) || 0, Number(fat) || 0, Number(carbs) || 0]
  );
  res.json(rows[0]);
}));

app.delete('/api/products/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM kkal.products WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/products/analyze', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image required' });
  const product = await analyzeProductLabel({
    provider: AI_PROVIDER,
    apiKey: AI_API_KEYS[AI_PROVIDER],
    model: AI_MODEL,
    base64: req.file.buffer.toString('base64'),
    mime: req.file.mimetype,
  });
  res.json(product);
}));

app.get('/api/weight', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM kkal.weight_logs ORDER BY date ASC, id ASC');
  res.json(rows);
}));

async function storePhoto(file) {
  const ext = path.extname(file.originalname || '').slice(0, 8) || '.jpg';
  const filename = `weight/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const blob = await put(filename, file.buffer, {
    access: 'public',
    contentType: file.mimetype,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

app.post('/api/weight', uploadWeightPhoto.single('photo'), asyncHandler(async (req, res) => {
  const { date, weight } = req.body || {};
  if (!date || !weight) return res.status(400).json({ error: 'date and weight required' });
  const photo = req.file ? await storePhoto(req.file) : null;
  const { rows } = await db.query(
    'INSERT INTO kkal.weight_logs (date, weight, photo) VALUES ($1, $2, $3) RETURNING *',
    [date, Number(weight), photo]
  );
  res.json(rows[0]);
}));

app.delete('/api/weight/:id', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM kkal.weight_logs WHERE id = $1', [req.params.id]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.photo && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(row.photo, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
  }
  await db.query('DELETE FROM kkal.weight_logs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = app;
