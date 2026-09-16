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
  goal_steps: '10000',
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

async function getSettings(targetDate) {
  const { rows } = await db.query('SELECT key, value FROM kkal.settings');
  const map = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;

  if (targetDate) {
    const histRes = await db.query(
      `SELECT key, value FROM kkal.goal_history
       WHERE date <= $1
       ORDER BY date DESC, id DESC`,
      [targetDate]
    );
    const seen = new Set();
    for (const r of histRes.rows) {
      if (!seen.has(r.key)) {
        seen.add(r.key);
        map[r.key] = r.value;
      }
    }
  }
  return map;
}

async function saveGoalSetting(key, value, date = new Date().toISOString().slice(0, 10)) {
  await db.query(
    `INSERT INTO kkal.settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
  await db.query(
    `INSERT INTO kkal.goal_history (date, key, value) VALUES ($1, $2, $3)`,
    [date, key, String(value)]
  );
}

app.get('/api/settings', asyncHandler(async (req, res) => {
  const date = req.query.date;
  const settings = await getSettings(date);
  res.json({
    ...settings,
    ai_provider: AI_PROVIDER,
    ai_configured: Boolean(AI_API_KEYS[AI_PROVIDER]),
  });
}));

app.put('/api/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const date = body.date || new Date().toISOString().slice(0, 10);
  const entries = Object.entries(body).filter(([key]) => key in DEFAULT_SETTINGS);
  for (const [key, value] of entries) {
    await saveGoalSetting(key, value, date);
  }
  res.json({ ok: true });
}));

app.get('/api/providers', (req, res) => res.json(PROVIDERS));

app.get('/api/day', asyncHandler(async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const [settings, entriesRes, stepsRes, weightRes] = await Promise.all([
    getSettings(date),
    db.query('SELECT * FROM kkal.entries WHERE date = $1 ORDER BY id ASC', [date]),
    db.query('SELECT * FROM kkal.step_logs WHERE date = $1', [date]),
    db.query('SELECT * FROM kkal.weight_logs WHERE date = $1 ORDER BY id DESC LIMIT 1', [date]),
  ]);

  res.json({
    settings: {
      ...settings,
      ai_provider: AI_PROVIDER,
      ai_configured: Boolean(AI_API_KEYS[AI_PROVIDER]),
    },
    entries: entriesRes.rows,
    steps: stepsRes.rows[0] || null,
    weight: weightRes.rows[0] || null,
  });
}));

app.get('/api/entries', asyncHandler(async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const { rows } = await db.query('SELECT * FROM kkal.entries WHERE date = $1 ORDER BY id ASC', [date]);
  res.json(rows);
}));

app.post('/api/entries', asyncHandler(async (req, res) => {
  const { date, meal, name, grams, calories, protein, fat, carbs, source, estimated, product_id } = req.body || {};
  if (!date || !meal || !name) return res.status(400).json({ error: 'date, meal, name required' });
  const { rows } = await db.query(
    `INSERT INTO kkal.entries (date, meal, name, grams, calories, protein, fat, carbs, source, estimated, product_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      date,
      meal,
      name,
      grams != null ? Number(grams) : null,
      Number(calories) || 0,
      Number(protein) || 0,
      Number(fat) || 0,
      Number(carbs) || 0,
      source || 'chat_text',
      Boolean(estimated),
      product_id || null,
    ]
  );
  res.json(rows[0]);
}));

app.put('/api/entries/:id', asyncHandler(async (req, res) => {
  const { name, grams, calories, protein, fat, carbs, meal, date, source } = req.body || {};
  const { rows: existingRows } = await db.query('SELECT * FROM kkal.entries WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { rows } = await db.query(
    `UPDATE kkal.entries
     SET name=$1, grams=$2, calories=$3, protein=$4, fat=$5, carbs=$6, meal=$7, date=$8, source=$9
     WHERE id=$10 RETURNING *`,
    [
      name ?? existing.name,
      grams != null ? Number(grams) : existing.grams,
      calories != null ? Number(calories) : existing.calories,
      protein != null ? Number(protein) : existing.protein,
      fat != null ? Number(fat) : existing.fat,
      carbs != null ? Number(carbs) : existing.carbs,
      meal ?? existing.meal,
      date ?? existing.date,
      source || 'manual_edit',
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

app.post('/api/ai/chat', upload.any(), asyncHandler(async (req, res) => {
  let history = [];
  try { history = JSON.parse(req.body.history || '[]'); } catch { history = []; }
  const files = req.files || (req.file ? [req.file] : []);
  const images = files.map((f) => ({
    base64: f.buffer.toString('base64'),
    mime: f.mimetype,
  }));
  const targetDate = req.body.date || new Date().toISOString().slice(0, 10);
  const curToday = new Date().toISOString().slice(0, 10);
  const currentMeal = req.body.meal || 'breakfast';
  const settings = await getSettings(targetDate);

  const result = await chatParseFood({
    provider: AI_PROVIDER,
    apiKey: AI_API_KEYS[AI_PROVIDER],
    model: AI_MODEL,
    history,
    images,
    date: targetDate,
    today: curToday,
    currentMeal,
    currentSettings: settings,
  });

  const lastUserText = req.body.text || (history.length > 0 ? history[history.length - 1].text : '');
  const source = images.length > 0 ? 'chat_photo' : (req.body.is_voice === 'true' ? 'chat_voice' : 'chat_text');

  let createdEntries = [];
  let createdWeight = null;
  let createdSteps = null;
  let createdProduct = null;
  let executedAction = false;

  if (result.intent === 'undo') {
    const lastRes = await db.query('SELECT id, name FROM kkal.entries WHERE date = $1 ORDER BY id DESC LIMIT 1', [targetDate]);
    if (lastRes.rows.length > 0) {
      await db.query('DELETE FROM kkal.entries WHERE id = $1', [lastRes.rows[0].id]);
      result.reply_text = `Удалил последнюю запись: «${lastRes.rows[0].name}».`;
      executedAction = true;
    } else {
      result.reply_text = 'Записей за этот день пока нет, нечего отменять.';
    }
  } else if (result.intent === 'edit_last') {
    if (result.items && result.items.length > 0) {
      const lastRes = await db.query('SELECT * FROM kkal.entries WHERE date = $1 ORDER BY id DESC LIMIT 1', [targetDate]);
      if (lastRes.rows.length > 0) {
        const item = result.items[0];
        const { rows } = await db.query(
          `UPDATE kkal.entries
           SET name=$1, grams=$2, calories=$3, protein=$4, fat=$5, carbs=$6, source=$7
           WHERE id=$8 RETURNING *`,
          [
            item.name,
            item.grams,
            item.calories,
            item.protein,
            item.fat,
            item.carbs,
            source,
            lastRes.rows[0].id,
          ]
        );
        createdEntries = rows;
        result.reply_text = `Исправил запись: «${item.name}» (${item.grams ? item.grams + ' г, ' : ''}${item.calories} ккал).`;
        executedAction = true;
      } else {
        result.reply_text = 'Не найдено предыдущей записи для исправления.';
      }
    }
  } else if (result.is_product_label && result.product_data) {
    const p = result.product_data;
    const { rows } = await db.query(
      `INSERT INTO kkal.products (name, calories, protein, fat, carbs)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [p.name, p.calories, p.protein, p.fat, p.carbs]
    );
    createdProduct = rows[0];
    result.reply_text = `Продукт «${p.name}» сохранён в базу продуктов (${p.calories} ккал, Б${p.protein} Ж${p.fat} У${p.carbs} на 100г).`;
    executedAction = true;
  } else if (!result.needs_confirmation && result.confidence >= 0.85) {
    if (result.intent === 'log_meal' && result.items && result.items.length > 0) {
      for (const item of result.items) {
        const { rows } = await db.query(
          `INSERT INTO kkal.entries (date, meal, name, grams, calories, protein, fat, carbs, source, estimated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            targetDate,
            result.meal_type || currentMeal,
            item.name,
            item.grams,
            item.calories,
            item.protein,
            item.fat,
            item.carbs,
            source,
            Boolean(item.estimated),
          ]
        );
        createdEntries.push(rows[0]);
      }
      executedAction = true;
      if (!result.reply_text) {
        const names = result.items.map((it) => it.name).join(', ');
        result.reply_text = `Записал в ${result.meal_type === 'breakfast' ? 'завтрак' : result.meal_type === 'lunch' ? 'обед' : result.meal_type === 'dinner' ? 'ужин' : 'перекус'}: ${names}`;
      }
    } else if (result.intent === 'log_weight' && result.weight != null) {
      const { rows } = await db.query(
        'INSERT INTO kkal.weight_logs (date, weight, source) VALUES ($1, $2, $3) RETURNING *',
        [targetDate, result.weight, source]
      );
      createdWeight = rows[0];
      executedAction = true;
      if (!result.reply_text) {
        result.reply_text = `Вес ${result.weight} кг записан.`;
      }
    } else if (result.intent === 'log_steps' && result.steps != null) {
      const numSteps = result.steps;
      const dist = Math.round(numSteps * 0.00075 * 100) / 100;
      const kcal = Math.round(numSteps * 0.04);
      const { rows } = await db.query(
        `INSERT INTO kkal.step_logs (date, steps, distance_km, calories, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (date) DO UPDATE
         SET steps = EXCLUDED.steps,
             distance_km = EXCLUDED.distance_km,
             calories = EXCLUDED.calories,
             source = EXCLUDED.source
         RETURNING *`,
        [targetDate, numSteps, dist, kcal, source]
      );
      createdSteps = rows[0];
      executedAction = true;
      if (!result.reply_text) {
        result.reply_text = `Записал ${result.steps.toLocaleString('ru-RU')} шагов (~${dist} км, ~${kcal} ккал).`;
      }
    }
  }

  // Save conversation into kkal.chat_messages
  const userText = lastUserText || (images.length > 0 ? (images.length > 1 ? `[${images.length} фото]` : '[фото]') : '');
  if (userText) {
    await db.query(
      'INSERT INTO kkal.chat_messages (date, role, text, meta) VALUES ($1, $2, $3, $4)',
      [targetDate, 'user', userText, JSON.stringify({ source })]
    ).catch(() => {});
  }

  const assistantMeta = {
    ...result,
    createdEntries,
    createdWeight,
    createdSteps,
    createdProduct,
    executedAction,
  };
  const assistantReply = result.clarification_question || result.reply_text || 'Готово!';
  await db.query(
    'INSERT INTO kkal.chat_messages (date, role, text, meta) VALUES ($1, $2, $3, $4)',
    [targetDate, 'assistant', assistantReply, JSON.stringify(assistantMeta)]
  ).catch(() => {});

  res.json({
    ...result,
    createdEntries,
    createdWeight,
    createdSteps,
    createdProduct,
    executedAction,
  });
}));

app.post('/api/ai/confirm', asyncHandler(async (req, res) => {
  const { action, date, payload } = req.body || {};
  const targetDate = date || new Date().toISOString().slice(0, 10);

  if (action === 'set_goal') {
    const { field, value } = payload || {};
    if (field && value != null) {
      await saveGoalSetting(field, value, targetDate);
      const settings = await getSettings(targetDate);
      const confirmText = `Дневная цель обновлена: ${field} = ${value}.`;
      await db.query(
        'INSERT INTO kkal.chat_messages (date, role, text, meta) VALUES ($1, $2, $3, $4)',
        [targetDate, 'assistant', confirmText, JSON.stringify({ action: 'set_goal_confirmed', field, value })]
      ).catch(() => {});
      return res.json({ ok: true, action, settings, reply_text: confirmText });
    }
  } else if (action === 'log_meal') {
    const items = payload.items || [];
    const meal = payload.meal_type || 'breakfast';
    const created = [];
    for (const item of items) {
      const { rows } = await db.query(
        `INSERT INTO kkal.entries (date, meal, name, grams, calories, protein, fat, carbs, source, estimated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [targetDate, meal, item.name, item.grams, item.calories, item.protein, item.fat, item.carbs, 'chat_text', Boolean(item.estimated)]
      );
      created.push(rows[0]);
    }
    const confirmText = `Запись подтверждена и сохранена на ${targetDate}.`;
    await db.query(
      'INSERT INTO kkal.chat_messages (date, role, text, meta) VALUES ($1, $2, $3, $4)',
      [targetDate, 'assistant', confirmText, JSON.stringify({ action: 'log_meal_confirmed', createdEntries: created })]
    ).catch(() => {});
    return res.json({ ok: true, action, createdEntries: created, reply_text: confirmText });
  } else if (action === 'log_weight') {
    const weight = Number(payload.weight);
    if (!isNaN(weight)) {
      const { rows } = await db.query(
        'INSERT INTO kkal.weight_logs (date, weight, source) VALUES ($1, $2, $3) RETURNING *',
        [targetDate, weight, 'chat_text']
      );
      const confirmText = `Вес ${weight} кг подтверждён и записан на ${targetDate}.`;
      await db.query(
        'INSERT INTO kkal.chat_messages (date, role, text, meta) VALUES ($1, $2, $3, $4)',
        [targetDate, 'assistant', confirmText, JSON.stringify({ action: 'log_weight_confirmed', createdWeight: rows[0] })]
      ).catch(() => {});
      return res.json({ ok: true, action, createdWeight: rows[0], reply_text: confirmText });
    }
  } else if (action === 'log_steps') {
    const steps = Math.max(0, Math.round(Number(payload.steps)) || 0);
    const dist = Math.round(steps * 0.00075 * 100) / 100;
    const kcal = Math.round(steps * 0.04);
    const { rows } = await db.query(
      `INSERT INTO kkal.step_logs (date, steps, distance_km, calories, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date) DO UPDATE
       SET steps = EXCLUDED.steps,
           distance_km = EXCLUDED.distance_km,
           calories = EXCLUDED.calories,
           source = EXCLUDED.source
       RETURNING *`,
      [targetDate, steps, dist, kcal, 'chat_text']
    );
    const confirmText = `${steps.toLocaleString('ru-RU')} шагов подтверждено и записано на ${targetDate}.`;
    await db.query(
      'INSERT INTO kkal.chat_messages (date, role, text, meta) VALUES ($1, $2, $3, $4)',
      [targetDate, 'assistant', confirmText, JSON.stringify({ action: 'log_steps_confirmed', createdSteps: rows[0] })]
    ).catch(() => {});
    return res.json({ ok: true, action, createdSteps: rows[0], reply_text: confirmText });
  }

  res.status(400).json({ error: 'invalid confirm action' });
}));

app.get('/api/chat-messages', asyncHandler(async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { rows } = await db.query(
    'SELECT id, date, role, text, meta, created_at FROM kkal.chat_messages WHERE date = $1 ORDER BY id ASC',
    [date]
  );
  res.json(rows);
}));

app.get('/api/history', asyncHandler(async (req, res) => {
  const [entriesSum, stepsRows, weightRows, defaultSettings, goalHistoryRows] = await Promise.all([
    db.query(`
      SELECT date,
             COUNT(*)::int as entry_count,
             COALESCE(SUM(calories), 0)::float as calories,
             COALESCE(SUM(protein), 0)::float as protein,
             COALESCE(SUM(fat), 0)::float as fat,
             COALESCE(SUM(carbs), 0)::float as carbs
      FROM kkal.entries
      GROUP BY date
    `),
    db.query('SELECT date, steps, distance_km, calories FROM kkal.step_logs'),
    db.query(`
      SELECT DISTINCT ON (date) date, weight
      FROM kkal.weight_logs
      ORDER BY date, id DESC
    `),
    getSettings(),
    db.query('SELECT date, key, value FROM kkal.goal_history ORDER BY date ASC, id ASC'),
  ]);

  const map = new Map();

  function getDayItem(d) {
    if (!map.has(d)) {
      map.set(d, {
        date: d,
        entry_count: 0,
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        steps: null,
        steps_dist: null,
        steps_kcal: null,
        weight: null,
        goal_calories: Number(defaultSettings.goal_calories) || 2000,
        goal_protein: Number(defaultSettings.goal_protein) || 120,
        goal_fat: Number(defaultSettings.goal_fat) || 65,
        goal_carbs: Number(defaultSettings.goal_carbs) || 250,
        goal_steps: Number(defaultSettings.goal_steps) || 10000,
      });
    }
    return map.get(d);
  }

  for (const r of entriesSum.rows) {
    const item = getDayItem(r.date);
    item.entry_count = r.entry_count;
    item.calories = Math.round(r.calories * 10) / 10;
    item.protein = Math.round(r.protein * 10) / 10;
    item.fat = Math.round(r.fat * 10) / 10;
    item.carbs = Math.round(r.carbs * 10) / 10;
  }

  for (const r of stepsRows.rows) {
    const item = getDayItem(r.date);
    item.steps = r.steps;
    item.steps_dist = r.distance_km;
    item.steps_kcal = r.calories;
  }

  for (const r of weightRows.rows) {
    const item = getDayItem(r.date);
    item.weight = r.weight;
  }

  const curToday = new Date().toISOString().slice(0, 10);
  getDayItem(curToday);

  const sortedHistory = goalHistoryRows.rows;
  const days = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));

  for (const d of days) {
    for (const h of sortedHistory) {
      if (h.date <= d.date) {
        if (h.key === 'goal_calories') d.goal_calories = Number(h.value) || d.goal_calories;
        if (h.key === 'goal_protein') d.goal_protein = Number(h.value) || d.goal_protein;
        if (h.key === 'goal_fat') d.goal_fat = Number(h.value) || d.goal_fat;
        if (h.key === 'goal_carbs') d.goal_carbs = Number(h.value) || d.goal_carbs;
        if (h.key === 'goal_steps') d.goal_steps = Number(h.value) || d.goal_steps;
      }
    }

    const hasAnyRecord = d.entry_count > 0 || d.steps != null || d.weight != null;
    if (!hasAnyRecord) {
      d.status = 'empty';
      d.delta = null;
    } else if (d.calories > d.goal_calories) {
      d.status = 'exceeded';
      d.delta = Math.round((d.calories - d.goal_calories) * 10) / 10;
    } else {
      d.status = 'in_goal';
      d.delta = Math.round((d.calories - d.goal_calories) * 10) / 10;
    }
  }

  res.json(days);
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

app.put('/api/products/:id', asyncHandler(async (req, res) => {
  const { name, calories, protein, fat, carbs } = req.body || {};
  const { rows: existingRows } = await db.query('SELECT * FROM kkal.products WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { rows } = await db.query(
    `UPDATE kkal.products
     SET name = $1, calories = $2, protein = $3, fat = $4, carbs = $5
     WHERE id = $6 RETURNING *`,
    [
      name ?? existing.name,
      calories != null ? Number(calories) : existing.calories,
      protein != null ? Number(protein) : existing.protein,
      fat != null ? Number(fat) : existing.fat,
      carbs != null ? Number(carbs) : existing.carbs,
      req.params.id,
    ]
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

app.put('/api/weight/:id', uploadWeightPhoto.single('photo'), asyncHandler(async (req, res) => {
  const { date, weight, removePhoto } = req.body || {};
  const { rows: existingRows } = await db.query('SELECT * FROM kkal.weight_logs WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  let photo = existing.photo;
  if (req.file) {
    if (existing.photo && process.env.BLOB_READ_WRITE_TOKEN) {
      await del(existing.photo, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
    }
    photo = await storePhoto(req.file);
  } else if (removePhoto === 'true' || removePhoto === true) {
    if (existing.photo && process.env.BLOB_READ_WRITE_TOKEN) {
      await del(existing.photo, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
    }
    photo = null;
  }

  const targetDate = date ?? existing.date;
  const targetWeight = weight != null ? Number(weight) : existing.weight;
  const { rows } = await db.query(
    'UPDATE kkal.weight_logs SET date = $1, weight = $2, photo = $3 WHERE id = $4 RETURNING *',
    [targetDate, targetWeight, photo, req.params.id]
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

app.get('/api/steps', asyncHandler(async (req, res) => {
  const date = req.query.date;
  if (date) {
    const { rows } = await db.query('SELECT * FROM kkal.step_logs WHERE date = $1', [date]);
    return res.json(rows[0] || null);
  }
  const { rows } = await db.query('SELECT * FROM kkal.step_logs ORDER BY date ASC, id ASC');
  res.json(rows);
}));

app.post('/api/steps', asyncHandler(async (req, res) => {
  const { date, steps, distance_km, calories } = req.body || {};
  if (!date || steps == null) return res.status(400).json({ error: 'date and steps required' });
  const numSteps = Math.max(0, Math.round(Number(steps)) || 0);
  const dist = distance_km != null ? Number(distance_km) : Math.round(numSteps * 0.00075 * 100) / 100;
  const kcal = calories != null ? Number(calories) : Math.round(numSteps * 0.04);
  const { rows } = await db.query(
    `INSERT INTO kkal.step_logs (date, steps, distance_km, calories)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (date) DO UPDATE
     SET steps = EXCLUDED.steps,
         distance_km = EXCLUDED.distance_km,
         calories = EXCLUDED.calories
     RETURNING *`,
    [date, numSteps, dist, kcal]
  );
  res.json(rows[0]);
}));

app.put('/api/steps/:id', asyncHandler(async (req, res) => {
  const { date, steps, distance_km, calories } = req.body || {};
  const { rows: existingRows } = await db.query('SELECT * FROM kkal.step_logs WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  const targetDate = date ?? existing.date;
  const numSteps = steps != null ? Math.max(0, Math.round(Number(steps)) || 0) : existing.steps;
  const dist = distance_km != null ? Number(distance_km) : Math.round(numSteps * 0.00075 * 100) / 100;
  const kcal = calories != null ? Number(calories) : Math.round(numSteps * 0.04);

  if (targetDate !== existing.date) {
    const conflictRes = await db.query('SELECT id FROM kkal.step_logs WHERE date = $1 AND id != $2', [targetDate, req.params.id]);
    if (conflictRes.rows.length > 0) {
      await db.query('DELETE FROM kkal.step_logs WHERE id = $1', [req.params.id]);
      const { rows } = await db.query(
        'UPDATE kkal.step_logs SET steps=$1, distance_km=$2, calories=$3 WHERE id=$4 RETURNING *',
        [numSteps, dist, kcal, conflictRes.rows[0].id]
      );
      return res.json(rows[0]);
    }
  }

  const { rows } = await db.query(
    `UPDATE kkal.step_logs
     SET date = $1, steps = $2, distance_km = $3, calories = $4
     WHERE id = $5 RETURNING *`,
    [targetDate, numSteps, dist, kcal, req.params.id]
  );
  res.json(rows[0]);
}));

app.delete('/api/steps/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM kkal.step_logs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = app;
