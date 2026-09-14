const FOOD_PROMPT = `Ты помощник для трекера питания. Проанализируй изображение — это может быть тарелка с едой, упаковка продукта или этикетка с пищевой ценностью.
Верни ТОЛЬКО валидный JSON без markdown-разметки и пояснений, строго такого вида:
{"items":[{"name":"название на русском","grams":число или null,"calories":число,"protein":число,"fat":число,"carbs":число}]}
Если на фото этикетка — бери значения из таблицы состава (на указанную порцию или на 100г, если порция не указана — grams=100). Если это готовое блюдо — оцени вес порции и БЖУ по внешнему виду. Если на фото несколько разных продуктов — верни несколько элементов массива items. Числа — граммы белков/жиров/углеводов и ккал на всю порцию.`;

const PRODUCT_PROMPT = `Ты помощник для базы продуктов трекера питания. На фото — упаковка продукта (лицевая сторона с названием и/или этикетка с таблицей пищевой ценности).
Определи название продукта и его пищевую ценность в пересчёте НА 100 ГРАММ (если на этикетке указано на порцию — пересчитай на 100г по указанному весу порции).
Верни ТОЛЬКО валидный JSON без markdown-разметки и пояснений, строго такого вида:
{"name":"название на русском","calories":число,"protein":число,"fat":число,"carbs":число}
Все числа — на 100 грамм продукта.`;

const CHAT_PROMPT = `Ты — помощник трекера питания внутри чата. Пользователь описывает текстом (и иногда фото) всё, что съел за один приём пищи — как в переписке с человеком, часто списком в несколько строк.
Разбей сообщение на отдельные продукты/блюда. Для каждого оцени граммы (если не указаны — оцени по описанию) и посчитай ккал/белки/жиры/углеводы на всю порцию, используя обычные справочные значения пищевой ценности.
Учитывай всю историю диалога ниже — предыдущие сообщения пользователя и твои прошлые вопросы/ответы дают контекст для текущего сообщения.
Если по какому-то конкретному пункту не хватает данных для надёжной оценки (неизвестный/нестандартный продукт без калорийности, неясное количество и т.п.) — не выдумывай цифры для него: не включай этот пункт в items и задай ровно один короткий уточняющий вопрос по нему. Остальные, понятные пункты всё равно верни в items.
Если всё понятно — верни все пункты в items, а question сделай null.
ВАЖНО: если текущее (последнее) сообщение пользователя — это ответ на твой предыдущий уточняющий вопрос, а не новый список еды, верни в items ТОЛЬКО уточнённый пункт (например, только запеканку) — не повторяй пункты, которые ты уже перечислял в items в предыдущих своих ответах этого диалога.
Верни ТОЛЬКО валидный JSON без markdown-разметки и пояснений, строго такого вида:
{"items":[{"name":"название на русском","grams":число или null,"calories":число,"protein":число,"fat":число,"carbs":число}],"question":"текст уточняющего вопроса или null"}`;

function extractJson(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON found in AI response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callOpenAI({ apiKey, model, base64, mime, prompt }) {
  const content = [{ type: 'text', text: prompt }];
  if (base64) content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
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

async function callGrok({ apiKey, model, base64, mime, prompt }) {
  const content = [{ type: 'text', text: prompt }];
  if (base64) content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
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

async function callGemini({ apiKey, model, base64, mime, prompt }) {
  const m = model || 'gemini-3.6-flash';
  const parts = [{ text: prompt }];
  if (base64) parts.push({ inline_data: { mime_type: mime, data: base64 } });
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

async function callAnthropic({ apiKey, model, base64, mime, prompt }) {
  const content = [];
  if (base64) content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } });
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

async function callProvider({ provider, apiKey, model, base64, mime, prompt }) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Неизвестный провайдер: ${provider}`);
  if (!apiKey) throw new Error('Не задан API-ключ в настройках');
  return fn({ apiKey, model, base64, mime, prompt });
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
    name: String(it.name || 'Продукт'),
    grams: it.grams != null ? Number(it.grams) : null,
    calories: Number(it.calories) || 0,
    protein: Number(it.protein) || 0,
    fat: Number(it.fat) || 0,
    carbs: Number(it.carbs) || 0,
  }));
}

function formatChatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const lines = history.map((m) =>
    m.role === 'assistant' ? `Ассистент: ${m.text}` : `Пользователь: ${m.text}`
  );
  return `История диалога:\n${lines.join('\n')}\n\n`;
}

async function chatParseFood({ provider, apiKey, model, history, base64, mime }) {
  const prompt = `${CHAT_PROMPT}\n\n${formatChatHistory(history)}Обрабатывай последнее сообщение пользователя из истории выше (к нему может быть приложено фото).`;
  const result = await callProvider({ provider, apiKey, model, base64, mime, prompt });
  return {
    items: normalizeItems(result.items),
    question: result.question ? String(result.question) : null,
  };
}

module.exports = { analyzeImage, analyzeProductLabel, chatParseFood, PROVIDERS: Object.keys(PROVIDERS) };
