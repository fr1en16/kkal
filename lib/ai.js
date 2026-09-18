const FOOD_PROMPT = `Ты помощник для трекера питания. Проанализируй изображение — это может быть тарелка с едой, упаковка продукта или этикетка с пищевой ценностью.
Верни ТОЛЬКО валидный JSON без markdown-разметки и пояснений, строго такого вида:
{"items":[{"name":"название на русском","grams":число или null,"calories":число,"protein":число,"fat":число,"carbs":число}]}
Если на фото этикетка — бери значения из таблицы состава (на указанную порцию или на 100г, если порция не указана — grams=100). Если это готовое блюдо — оцени вес порции и БЖУ по внешнему виду. Если на фото несколько разных продуктов — верни несколько элементов массива items. Числа — граммы белков/жиров/углеводов и ккал на всю порцию.`;

const PRODUCT_PROMPT = `Ты помощник для базы продуктов трекера питания. На фото — упаковка продукта (лицевая сторона с названием и/или этикетка с таблицей пищевой ценности).
Определи название продукта и его пищевую ценность в пересчёте НА 100 ГРАММ (если на этикетке указано на порцию — пересчитай на 100г по указанному весу порции).
Верни ТОЛЬКО валидный JSON без markdown-разметки и пояснений, строго такого вида:
{"name":"название на русском","calories":число,"protein":число,"fat":число,"carbs":число}
Все числа — на 100 грамм продукта.`;

const INTENT_PROMPT = `Ты — умный AI-помощник трекера питания kkal. Твоя задача — классифицировать сообщение пользователя (текст, фото или результат распознавания речи) в один из интентов и извлечь строго структурированные данные.

ТЕКУЩИЙ КОНТЕКСТ:
- Дата экрана (по умолчанию для записи): {{DATE}}
- Сегодняшняя дата: {{TODAY}}
- Текущий приём пищи по умолчанию: {{MEAL}}
- Текущие настройки дневных целей: {{SETTINGS}}

ТИПЫ НАМЕРЕНИЙ (INTENT):
1. "log_meal":
   - Пользователь съел еду, выпил напиток или приложил фото тарелки.
   - Поля: meal_type (breakfast/lunch/dinner/snack), items: [{ name, grams, calories, protein, fat, carbs, estimated }].
   - Если приложено фото блюда: оцени порцию и состав, установи estimated: true для элементов, в reply_text укажи оценку (например "≈310 ккал, по фото").
   - ВАЖНО: Если пользователь текстом пишет блюдо без количества/веса (например "съел суп", "поел макароны") и это не фото: НЕ придумывай граммы сам! Установи intent="unclear", confidence=0.4, items=[], clarification_question="Сколько примерно грамм или какая была порция супа?"
   - Если на фото этикетка/упаковка с таблицей КБЖУ на 100г: установи is_product_label=true, product_data={ name, calories, protein, fat, carbs }, reply_text="Распознал продукт... Добавляю в базу продуктов".
2. "log_weight":
   - Пользователь записал вес ("взвесился, 96.4", "вес 96.4 кг", или фото весов).
   - Поля: weight (число в кг), date (по умолчанию {{DATE}}).
   - Для фото весов needs_confirmation ВСЕГДА true (дисплей весов легко распознать неверно).
3. "log_steps":
   - Пользователь записал шаги ("5000 шагов", "прошёл 6к шагов").
   - Поля: steps (целое число шагов), date (по умолчанию {{DATE}}).
4. "set_goal":
   - Пользователь меняет дневную цель ("хочу норму 2200 ккал", "поставь белки 130", "цель 10000 шагов").
   - Поля: goal_change: { field: "goal_calories"|"goal_protein"|"goal_fat"|"goal_carbs"|"goal_steps", value: число, label: "строка описания" }.
   - Для set_goal needs_confirmation ВСЕГДА true!
5. "edit_last":
   - Быстрая поправка сразу после предыдущей записи в диалоге ("на самом деле не 2 яйца а 3", "не тост а два тоста").
   - Поля: items с исправленными значениями.
6. "undo":
   - Отмена последней записи ("отмени", "удали это", "убери последнюю запись").
   - Поля: reply_text="Отменяю последнюю запись".
7. "query":
   - Вопрос пользователя ("сколько я съел сегодня", "какая норма").
   - Поля: reply_text с ответом.
8. "unclear":
   - Не удалось понять intent или не хватает данных для надежной записи.
   - Поля: clarification_question (вежливый уточняющий вопрос).

ПОРОГИ УВЕРЕННОСТИ (confidence):
- 0.85 - 1.0: высокая уверенность.
- 0.5 - 0.84: средняя уверенность (needs_confirmation=true).
- < 0.5: низкая уверенность (intent="unclear", запись не создаётся, задаётся clarification_question).

ПРАВИЛА CONFIRMATION:
- set_goal: ВСЕГДА needs_confirmation=true.
- date !== today для log_weight/log_steps: ВСЕГДА needs_confirmation=true.
- Фото дисплея весов: ВСЕГДА needs_confirmation=true.
- Для log_meal сегодняшним числом с confidence >= 0.85: needs_confirmation=false.

Верни ТОЛЬКО валидный JSON строго следующего вида без пояснений:
{
  "intent": "log_meal" | "log_weight" | "log_steps" | "set_goal" | "edit_last" | "undo" | "query" | "unclear",
  "confidence": 0.95,
  "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
  "date": "{{DATE}}",
  "items": [
    { "name": "Название", "grams": 120, "calories": 210, "protein": 14, "fat": 16, "carbs": 2, "estimated": false }
  ],
  "weight": null,
  "steps": null,
  "goal_change": null,
  "needs_confirmation": false,
  "reply_text": "Краткий ответ ассистента",
  "clarification_question": null,
  "is_product_label": false,
  "product_data": null
}`;

function extractJson(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON found in AI response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeImages({ images, base64, mime }) {
  if (Array.isArray(images) && images.length > 0) {
    return images.filter((img) => img && img.base64);
  }
  if (base64) {
    return [{ base64, mime: mime || 'image/jpeg' }];
  }
  return [];
}

async function callOpenAI({ apiKey, model, images, base64, mime, prompt }) {
  const imgList = normalizeImages({ images, base64, mime });
  const content = [{ type: 'text', text: prompt }];
  for (const img of imgList) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
      max_tokens: 1000,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.choices[0].message.content);
}

async function callGrok({ apiKey, model, images, base64, mime, prompt }) {
  const imgList = normalizeImages({ images, base64, mime });
  const content = [{ type: 'text', text: prompt }];
  for (const img of imgList) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
  }
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'grok-2-vision-1212',
      messages: [{ role: 'user', content }],
      max_tokens: 1000,
    }),
  });
  if (!res.ok) throw new Error(`Grok: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.choices[0].message.content);
}

async function callGemini({ apiKey, model, images, base64, mime, prompt }) {
  const m = model || 'gemini-3.6-flash';
  const imgList = normalizeImages({ images, base64, mime });
  const parts = [{ text: prompt }];
  for (const img of imgList) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.candidates[0].content.parts[0].text);
}

async function callAnthropic({ apiKey, model, images, base64, mime, prompt }) {
  const imgList = normalizeImages({ images, base64, mime });
  const content = [];
  for (const img of imgList) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
  }
  content.push({ type: 'text', text: prompt });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.content[0].text);
}

const PROVIDERS = {
  openai: callOpenAI,
  grok: callGrok,
  gemini: callGemini,
  anthropic: callAnthropic,
};

function isRetryableError(err) {
  return /: (429|500|502|503|504)\b/.test(err.message) || /UNAVAILABLE|overloaded/i.test(err.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callProvider({ provider, apiKey, model, images, base64, mime, prompt }) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Неизвестный провайдер: ${provider}`);
  if (!apiKey) throw new Error('Не задан API-ключ в настройках');

  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn({ apiKey, model, images, base64, mime, prompt });
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryableError(err)) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function analyzeImage({ provider, apiKey, model, base64, mime }) {
  const result = await callProvider({ provider, apiKey, model, base64, mime, prompt: FOOD_PROMPT });
  if (!Array.isArray(result.items)) throw new Error('Некорректный формат ответа ИИ');
  return result.items.map((it) => ({
    name: String(it.name || 'Продукт'),
    grams: it.grams != null ? Number(it.grams) : null,
    calories: Number(it.calories) || 0,
    protein: Number(it.protein) || 0,
    fat: Number(it.fat) || 0,
    carbs: Number(it.carbs) || 0,
  }));
}

async function analyzeProductLabel({ provider, apiKey, model, base64, mime }) {
  const result = await callProvider({ provider, apiKey, model, base64, mime, prompt: PRODUCT_PROMPT });
  return {
    name: String(result.name || 'Продукт'),
    calories: Number(result.calories) || 0,
    protein: Number(result.protein) || 0,
    fat: Number(result.fat) || 0,
    carbs: Number(result.carbs) || 0,
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    name: String(it.name || 'Блюдо'),
    grams: it.grams != null && !isNaN(Number(it.grams)) ? Math.round(Number(it.grams) * 10) / 10 : null,
    calories: Math.round(Number(it.calories) || 0),
    protein: Math.round((Number(it.protein) || 0) * 10) / 10,
    fat: Math.round((Number(it.fat) || 0) * 10) / 10,
    carbs: Math.round((Number(it.carbs) || 0) * 10) / 10,
    estimated: Boolean(it.estimated),
  }));
}

function formatChatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const lines = history.map((m) =>
    m.role === 'assistant' ? `Ассистент: ${m.text || ''}` : `Пользователь: ${m.text || ''}`
  );
  return `История диалога:\n${lines.join('\n')}\n\n`;
}

async function chatParseFood({ provider, apiKey, model, history, text, images, base64, mime, date, today, currentMeal, currentSettings }) {
  const imgList = normalizeImages({ images, base64, mime });
  const targetDate = date || today || new Date().toISOString().slice(0, 10);
  const curToday = today || new Date().toISOString().slice(0, 10);
  const defMeal = currentMeal || 'breakfast';
  const settingsStr = JSON.stringify(currentSettings || {});

  let chatHistory = Array.isArray(history) ? [...history] : [];
  if (text && (!chatHistory.length || chatHistory[chatHistory.length - 1].text !== text)) {
    chatHistory.push({ role: 'user', text });
  } else if (!text && imgList.length > 0 && (!chatHistory.length || chatHistory[chatHistory.length - 1].role !== 'user')) {
    chatHistory.push({ role: 'user', text: imgList.length > 1 ? `[${imgList.length} фото]` : '[фото]' });
  }

  let promptTemplate = INTENT_PROMPT
    .replace(/\{\{DATE\}\}/g, targetDate)
    .replace(/\{\{TODAY\}\}/g, curToday)
    .replace(/\{\{MEAL\}\}/g, defMeal)
    .replace(/\{\{SETTINGS\}\}/g, settingsStr);

  const prompt = `${promptTemplate}\n\n${formatChatHistory(chatHistory)}Обрабатывай последнее сообщение пользователя из истории выше${imgList.length > 0 ? ` (к нему приложено ${imgList.length} фото)` : ''}.`;

  const raw = await callProvider({ provider, apiKey, model, images: imgList, prompt });

  let intent = String(raw.intent || 'unclear');
  const validIntents = ['log_meal', 'log_weight', 'log_steps', 'set_goal', 'edit_last', 'undo', 'query', 'unclear'];
  if (!validIntents.includes(intent)) intent = 'unclear';

  let confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.88;
  if (confidence > 1) confidence = 1;
  if (confidence < 0) confidence = 0;

  const mealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(raw.meal_type)
    ? raw.meal_type
    : defMeal;

  let items = normalizeItems(raw.items);
  let weight = raw.weight != null && !isNaN(Number(raw.weight)) ? Math.round(Number(raw.weight) * 10) / 10 : null;
  let steps = raw.steps != null && !isNaN(Number(raw.steps)) ? Math.max(0, Math.round(Number(raw.steps))) : null;
  let goalChange = raw.goal_change && typeof raw.goal_change === 'object' ? raw.goal_change : null;
  let clarification = raw.clarification_question ? String(raw.clarification_question).trim() : null;
  let replyText = raw.reply_text ? String(raw.reply_text).trim() : '';
  const isProductLabel = Boolean(raw.is_product_label);
  const productData = raw.product_data && typeof raw.product_data === 'object' ? {
    name: String(raw.product_data.name || 'Новый продукт'),
    calories: Math.round(Number(raw.product_data.calories) || 0),
    protein: Math.round((Number(raw.product_data.protein) || 0) * 10) / 10,
    fat: Math.round((Number(raw.product_data.fat) || 0) * 10) / 10,
    carbs: Math.round((Number(raw.product_data.carbs) || 0) * 10) / 10,
  } : null;

  // Threshold logic
  if (confidence < 0.5) {
    intent = 'unclear';
    items = [];
    if (!clarification) {
      clarification = 'Не удалось точно разобрать сообщение. Уточните, пожалуйста, что именно вы хотите записать?';
    }
  }

  // Required field checks for intents
  if (intent === 'log_meal' && items.length === 0 && !isProductLabel) {
    intent = 'unclear';
    if (!clarification) {
      clarification = 'Уточните, пожалуйста, какое блюдо и какую порцию (в граммах) вы съели?';
    }
  } else if (intent === 'log_weight' && weight == null) {
    intent = 'unclear';
    if (!clarification) {
      clarification = 'Какой вес в килограммах вы хотите записать? (например: «вес 84.5»)';
    }
  } else if (intent === 'log_steps' && steps == null) {
    intent = 'unclear';
    if (!clarification) {
      clarification = 'Сколько шагов вы хотите записать? (например: «7500 шагов»)';
    }
  } else if (intent === 'set_goal' && !goalChange) {
    intent = 'unclear';
    if (!clarification) {
      clarification = 'Какую именно дневную цель изменить? (например: «хочу норму 2200 ккал» или «белки 130»)';
    }
  }

  // Confirmation policy per spec 4.2, 4.3, 4.4:
  // - set_goal: ALWAYS needs confirmation
  // - past-date records (date !== today): ALWAYS needs confirmation
  // - scale display photos: ALWAYS needs confirmation
  // - confidence between 0.5 and 0.85: needs confirmation
  // - confidence >= 0.85 on today for meal/weight/steps: NO confirmation
  let needsConfirmation = Boolean(raw.needs_confirmation);
  const isPastDate = targetDate !== curToday;

  if (intent === 'set_goal') {
    needsConfirmation = true;
  } else if (isPastDate && (intent === 'log_weight' || intent === 'log_steps')) {
    needsConfirmation = true;
  } else if (intent === 'log_weight' && imgList.length > 0) {
    // Scales photo
    needsConfirmation = true;
  } else if (confidence >= 0.5 && confidence < 0.85) {
    needsConfirmation = true;
  } else if (confidence >= 0.85 && !isPastDate && (intent === 'log_meal' || intent === 'log_weight' || intent === 'log_steps')) {
    needsConfirmation = false;
  }

  return {
    intent,
    confidence,
    meal_type: mealType,
    date: targetDate,
    items,
    weight,
    steps,
    goal_change: goalChange,
    needs_confirmation: needsConfirmation,
    reply_text: replyText,
    clarification_question: clarification,
    is_product_label: isProductLabel,
    product_data: productData,
  };
}

module.exports = { analyzeImage, analyzeProductLabel, chatParseFood, PROVIDERS: Object.keys(PROVIDERS) };
