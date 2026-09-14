const MEALS = [
  { key: 'breakfast', label: 'Завтрак' },
  { key: 'lunch', label: 'Обед' },
  { key: 'dinner', label: 'Ужин' },
  { key: 'snack', label: 'Перекус' },
];

let currentDate = todayStr();
let currentMeal = 'breakfast';
let settings = null;
let aiItems = [];
let activeTab = 'diary';
let weightPhotoFile = null;
let pickedProduct = null;
let chatHistory = [];
let chatPhotoFile = null;
let chatSending = false;

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(todayStr() + 'T00:00:00');
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === -1) return 'Вчера';
  if (diffDays === 1) return 'Завтра';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function round(n) {
  return Math.round((n || 0) * 10) / 10;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function loadSettings() {
  settings = await api('/api/settings');
  document.getElementById('kcalGoal').textContent = settings.goal_calories;
  document.getElementById('pGoal').textContent = settings.goal_protein;
  document.getElementById('fGoal').textContent = settings.goal_fat;
  document.getElementById('cGoal').textContent = settings.goal_carbs;
}

async function loadDay() {
  document.getElementById('dateLabel').textContent = fmtDateLabel(currentDate);
  const entries = await api(`/api/entries?date=${currentDate}`);
  renderMeals(entries);
  renderSummary(entries);
}

function renderSummary(entries) {
  const totals = entries.reduce(
    (acc, e) => {
      acc.kcal += e.calories;
      acc.p += e.protein;
      acc.f += e.fat;
      acc.c += e.carbs;
      return acc;
    },
    { kcal: 0, p: 0, f: 0, c: 0 }
  );
  document.getElementById('kcalEaten').textContent = round(totals.kcal);
  document.getElementById('pEaten').textContent = round(totals.p);
  document.getElementById('fEaten').textContent = round(totals.f);
  document.getElementById('cEaten').textContent = round(totals.c);
  const goal = Number(settings.goal_calories) || 1;
  const pct = Math.min(100, (totals.kcal / goal) * 100);
  document.getElementById('kcalBar').style.width = pct + '%';

  const left = goal - totals.kcal;
  const leftEl = document.getElementById('kcalLeft');
  leftEl.classList.toggle('over', left < 0);
  leftEl.textContent = left >= 0
    ? `Осталось ${round(left)} ккал`
    : `Превышено на ${round(-left)} ккал`;
}

function renderMeals(entries) {
  const container = document.getElementById('meals');
  container.innerHTML = '';
  for (const meal of MEALS) {
    const mealEntries = entries.filter((e) => e.meal === meal.key);
    const kcal = mealEntries.reduce((s, e) => s + e.calories, 0);

    const section = document.createElement('div');
    section.className = 'meal-section';

    const title = document.createElement('div');
    title.className = 'meal-title';
    title.innerHTML = `<span>${meal.label} <span class="meal-kcal">${kcal ? round(kcal) + ' ккал' : ''}</span></span>`;
    const addBtn = document.createElement('button');
    addBtn.className = 'meal-add';
    addBtn.textContent = '+';
    addBtn.onclick = () => openAddSheet(meal.key, meal.label);
    title.appendChild(addBtn);
    section.appendChild(title);

    if (mealEntries.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Ничего не добавлено';
      section.appendChild(hint);
    } else {
      for (const e of mealEntries) {
        section.appendChild(renderEntry(e));
      }
    }
    container.appendChild(section);
  }
}

function renderEntry(e) {
  const row = document.createElement('div');
  row.className = 'entry';
  const sub = [e.grams ? `${round(e.grams)} г` : null, `Б${round(e.protein)} Ж${round(e.fat)} У${round(e.carbs)}`]
    .filter(Boolean)
    .join(' · ');
  row.innerHTML = `
    <div class="entry-name">${escapeHtml(e.name)}<div class="entry-sub">${sub}</div></div>
    <div class="entry-kcal">${round(e.calories)}</div>
    <button class="entry-del">✕</button>
  `;
  row.querySelector('.entry-del').onclick = async () => {
    await api(`/api/entries/${e.id}`, { method: 'DELETE' });
    loadDay();
  };
  return row;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function openAddSheet(mealKey, mealLabel) {
  currentMeal = mealKey;
  document.getElementById('addMealLabel').textContent = mealLabel;
  clearAddForm();
  document.getElementById('addOverlay').classList.add('open');
}

function clearAddForm() {
  for (const id of ['fName', 'fGrams', 'fKcal', 'fProtein', 'fFat', 'fCarbs']) {
    document.getElementById(id).value = '';
  }
  aiItems = [];
  document.getElementById('aiResults').hidden = true;
  document.getElementById('aiResults').innerHTML = '';
  document.getElementById('aiStatus').hidden = true;
  clearProductPick();
}

function clearProductPick() {
  pickedProduct = null;
  document.getElementById('productPick').value = '';
  document.getElementById('productPickResults').hidden = true;
  document.getElementById('productPickResults').innerHTML = '';
  document.getElementById('productPicked').hidden = true;
  document.getElementById('productPicked').innerHTML = '';
}

async function searchProductsForPick(q) {
  const resultsEl = document.getElementById('productPickResults');
  if (!q) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    return;
  }
  const products = await api(`/api/products?q=${encodeURIComponent(q)}`);
  resultsEl.innerHTML = '';
  if (products.length === 0) {
    resultsEl.hidden = true;
    return;
  }
  resultsEl.hidden = false;
  for (const p of products) {
    const el = document.createElement('div');
    el.className = 'ai-item';
    el.innerHTML = `
      <div class="ai-item-info">
        <div class="ai-item-name">${escapeHtml(p.name)}</div>
        <div class="ai-item-sub">${round(p.calories)} ккал · Б${round(p.protein)} Ж${round(p.fat)} У${round(p.carbs)} на 100г</div>
      </div>
      <button class="ai-item-add">Выбрать</button>
    `;
    el.querySelector('.ai-item-add').onclick = () => pickProduct(p);
    resultsEl.appendChild(el);
  }
}

function pickProduct(product) {
  pickedProduct = product;
  document.getElementById('productPick').value = '';
  document.getElementById('productPickResults').hidden = true;
  document.getElementById('productPickResults').innerHTML = '';

  const block = document.getElementById('productPicked');
  block.hidden = false;
  block.innerHTML = `
    <div class="product-picked-info">
      <div class="product-picked-name">${escapeHtml(product.name)}</div>
      <div>${round(product.calories)} ккал на 100г</div>
    </div>
    <input class="field" id="productGrams" type="number" inputmode="decimal" placeholder="Граммы" value="100" />
    <button class="product-picked-clear" id="productPickedClear">✕</button>
  `;
  document.getElementById('productPickedClear').onclick = clearProductPick;
  document.getElementById('productGrams').oninput = (e) => applyProductGrams(e.target.value);
  applyProductGrams(100);
}

function applyProductGrams(grams) {
  if (!pickedProduct) return;
  const g = Number(grams) || 0;
  const factor = g / 100;
  document.getElementById('fName').value = pickedProduct.name;
  document.getElementById('fGrams').value = g;
  document.getElementById('fKcal').value = round(pickedProduct.calories * factor);
  document.getElementById('fProtein').value = round(pickedProduct.protein * factor);
  document.getElementById('fFat').value = round(pickedProduct.fat * factor);
  document.getElementById('fCarbs').value = round(pickedProduct.carbs * factor);
}

async function saveManualEntry() {
  const name = document.getElementById('fName').value.trim();
  if (!name) {
    document.getElementById('fName').focus();
    return;
  }
  await api('/api/entries', {
    method: 'POST',
    body: JSON.stringify({
      date: currentDate,
      meal: currentMeal,
      name,
      grams: document.getElementById('fGrams').value || null,
      calories: document.getElementById('fKcal').value || 0,
      protein: document.getElementById('fProtein').value || 0,
      fat: document.getElementById('fFat').value || 0,
      carbs: document.getElementById('fCarbs').value || 0,
    }),
  });
  document.getElementById('addOverlay').classList.remove('open');
  loadDay();
}

async function handlePhoto(file) {
  const statusEl = document.getElementById('aiStatus');
  statusEl.hidden = false;
  statusEl.textContent = 'Распознаю фото…';
  const resultsEl = document.getElementById('aiResults');
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';

  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch('/api/ai/analyze', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка распознавания');
    aiItems = data.items;
    if (aiItems.length === 0) {
      statusEl.textContent = 'Ничего не распознано';
      return;
    }
    statusEl.hidden = true;
    renderAiResults();
  } catch (err) {
    statusEl.textContent = err.message.includes('API-ключ')
      ? 'Не задан API-ключ ИИ — добавьте его в .env на сервере'
      : 'Не удалось распознать: ' + err.message;
  }
}

function renderAiResults() {
  const resultsEl = document.getElementById('aiResults');
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  aiItems.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'ai-item';
    const sub = [item.grams ? `${round(item.grams)} г` : null, `${round(item.calories)} ккал`, `Б${round(item.protein)} Ж${round(item.fat)} У${round(item.carbs)}`]
      .filter(Boolean)
      .join(' · ');
    el.innerHTML = `
      <div class="ai-item-info">
        <div class="ai-item-name">${escapeHtml(item.name)}</div>
        <div class="ai-item-sub">${sub}</div>
      </div>
      <button class="ai-item-add">Добавить</button>
    `;
    el.querySelector('.ai-item-add').onclick = async () => {
      await api('/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          date: currentDate,
          meal: currentMeal,
          name: item.name,
          grams: item.grams,
          calories: item.calories,
          protein: item.protein,
          fat: item.fat,
          carbs: item.carbs,
        }),
      });
      el.remove();
      loadDay();
    };
    resultsEl.appendChild(el);
  });
}

async function loadRecent(q) {
  const rows = await api(`/api/recent?q=${encodeURIComponent(q || '')}`);
  const list = document.getElementById('recentList');
  list.innerHTML = rows.map((r) => `<option value="${escapeHtml(r.name)}"></option>`).join('');
}

const PROVIDER_LABELS = {
  openai: 'OpenAI (GPT-4o)',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
  anthropic: 'Anthropic Claude',
};
const PROVIDER_ENV_VAR = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grok: 'GROK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function openSettingsSheet() {
  document.getElementById('sGoalKcal').value = settings.goal_calories;
  document.getElementById('sGoalProtein').value = settings.goal_protein;
  document.getElementById('sGoalFat').value = settings.goal_fat;
  document.getElementById('sGoalCarbs').value = settings.goal_carbs;
  const providerLabel = PROVIDER_LABELS[settings.ai_provider] || settings.ai_provider;
  const envVar = PROVIDER_ENV_VAR[settings.ai_provider] || 'AI_API_KEY';
  document.getElementById('aiProviderInfo').textContent = settings.ai_configured
    ? `Провайдер: ${providerLabel} (ключ задан через ${envVar} в .env)`
    : `Провайдер: ${providerLabel}. Ключ не найден — задайте ${envVar} в .env и перезапустите сервер. Сменить провайдера можно переменной AI_PROVIDER.`;
  document.getElementById('settingsOverlay').classList.add('open');
}

async function saveSettings() {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      goal_calories: document.getElementById('sGoalKcal').value || 2000,
      goal_protein: document.getElementById('sGoalProtein').value || 0,
      goal_fat: document.getElementById('sGoalFat').value || 0,
      goal_carbs: document.getElementById('sGoalCarbs').value || 0,
    }),
  });
  document.getElementById('settingsOverlay').classList.remove('open');
  await loadSettings();
  loadDay();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('diaryView').hidden = tab !== 'diary';
  document.getElementById('weightView').hidden = tab !== 'weight';
  document.getElementById('productsView').hidden = tab !== 'products';
  document.getElementById('chatView').hidden = tab !== 'chat';
  document.querySelector('.topbar').hidden = tab !== 'diary';
  document.querySelector('.summary').hidden = tab !== 'diary';
  document.getElementById('tabDiary').classList.toggle('active', tab === 'diary');
  document.getElementById('tabWeight').classList.toggle('active', tab === 'weight');
  document.getElementById('tabProducts').classList.toggle('active', tab === 'products');
  document.getElementById('tabChat').classList.toggle('active', tab === 'chat');
  document.getElementById('chatInputBar').hidden = tab !== 'chat';
  document.getElementById('fabAdd').hidden = tab === 'chat';
  if (tab === 'weight') loadWeight();
  if (tab === 'products') loadProducts();
  if (tab === 'chat') initChat();
}

function guessMealByTime() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function initChat() {
  if (chatHistory.length > 0) return;
  document.getElementById('chatMeal').value = guessMealByTime();
  renderChat();
}

function renderChat() {
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  if (chatHistory.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'chat-status';
    hint.textContent = 'Напишите или пришлите фото того, что съели — я разберу на продукты и добавлю в дневник.';
    container.appendChild(hint);
    return;
  }
  for (const msg of chatHistory) {
    container.appendChild(renderChatMessage(msg));
  }
  container.scrollTop = container.scrollHeight;
}

function renderChatMessage(msg) {
  const row = document.createElement('div');
  row.className = `chat-msg ${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (msg.photoUrl) {
    const img = document.createElement('img');
    img.className = 'chat-bubble-photo';
    img.src = msg.photoUrl;
    bubble.appendChild(img);
  }
  if (msg.text) {
    const textEl = document.createElement('div');
    textEl.textContent = msg.text;
    bubble.appendChild(textEl);
  }
  if (msg.pending) {
    const statusEl = document.createElement('div');
    statusEl.className = 'chat-status';
    statusEl.textContent = 'Разбираю…';
    bubble.appendChild(statusEl);
  }
  if (msg.error) {
    const errEl = document.createElement('div');
    errEl.className = 'chat-status';
    errEl.textContent = msg.error;
    bubble.appendChild(errEl);
  }
  if (msg.items && msg.items.length > 0) {
    const itemsEl = document.createElement('div');
    itemsEl.className = 'chat-items';
    msg.items.forEach((item, i) => itemsEl.appendChild(renderChatItem(msg, item, i)));
    bubble.appendChild(itemsEl);
    if (msg.items.filter((it) => !it.added).length > 1) {
      const addAllBtn = document.createElement('button');
      addAllBtn.className = 'chat-add-all';
      addAllBtn.textContent = 'Добавить всё';
      addAllBtn.onclick = async () => {
        for (const item of msg.items) {
          if (!item.added) await addChatItem(msg, item);
        }
        renderChat();
      };
      bubble.appendChild(addAllBtn);
    }
  }

  row.appendChild(bubble);
  return row;
}

function renderChatItem(msg, item, i) {
  const el = document.createElement('div');
  el.className = 'ai-item';
  const sub = [item.grams ? `${round(item.grams)} г` : null, `${round(item.calories)} ккал`, `Б${round(item.protein)} Ж${round(item.fat)} У${round(item.carbs)}`]
    .filter(Boolean)
    .join(' · ');
  el.innerHTML = `
    <div class="ai-item-info">
      <div class="ai-item-name">${escapeHtml(item.name)}</div>
      <div class="ai-item-sub">${sub}</div>
    </div>
    <button class="ai-item-add">${item.added ? 'Добавлено' : 'Добавить'}</button>
  `;
  const btn = el.querySelector('.ai-item-add');
  if (item.added) {
    btn.disabled = true;
  } else {
    btn.onclick = async () => {
      await addChatItem(msg, item);
      renderChat();
    };
  }
  return el;
}

async function addChatItem(msg, item) {
  await api('/api/entries', {
    method: 'POST',
    body: JSON.stringify({
      date: currentDate,
      meal: document.getElementById('chatMeal').value,
      name: item.name,
      grams: item.grams,
      calories: item.calories,
      protein: item.protein,
      fat: item.fat,
      carbs: item.carbs,
    }),
  });
  item.added = true;
  if (activeTab === 'diary') loadDay();
}

function chatMsgSummary(m) {
  if (m.role === 'user') return m.text || (m.photoUrl ? '[фото]' : '');
  const parts = [];
  if (m.items && m.items.length) {
    parts.push(`items: ${m.items.map((it) => `${it.name} (${it.grams ?? '?'} г, ${it.calories} ккал)`).join(', ')}`);
  }
  if (m.text) parts.push(`question: ${m.text}`);
  return parts.join('; ') || '(нет данных)';
}

async function sendChatMessage() {
  if (chatSending) return;
  const textEl = document.getElementById('chatText');
  const text = textEl.value.trim();
  const photoFile = chatPhotoFile;
  if (!text && !photoFile) return;

  const userMsg = { role: 'user', text, photoUrl: photoFile ? URL.createObjectURL(photoFile) : null };
  chatHistory.push(userMsg);
  const assistantMsg = { role: 'assistant', pending: true };
  chatHistory.push(assistantMsg);
  textEl.value = '';
  clearChatPhoto();
  chatSending = true;
  renderChat();

  try {
    const form = new FormData();
    const apiHistory = chatHistory
      .filter((m) => !m.pending)
      .slice(0, -1)
      .map((m) => ({ role: m.role, text: chatMsgSummary(m) }));
    apiHistory.push({ role: 'user', text: text || '[фото]' });
    form.append('history', JSON.stringify(apiHistory));
    if (photoFile) form.append('image', photoFile);
    const res = await fetch('/api/ai/chat', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    assistantMsg.pending = false;
    assistantMsg.items = data.items || [];
    assistantMsg.text = data.question || (assistantMsg.items.length ? '' : 'Не удалось распознать продукты');
  } catch (err) {
    assistantMsg.pending = false;
    assistantMsg.error = err.message.includes('API-ключ')
      ? 'Не задан API-ключ ИИ — добавьте его в .env на сервере'
      : 'Не удалось обработать: ' + err.message;
  } finally {
    chatSending = false;
    renderChat();
  }
}

function clearChatPhoto() {
  chatPhotoFile = null;
  const thumb = document.getElementById('chatPhotoThumb');
  thumb.hidden = true;
  thumb.src = '';
}

async function loadProducts(q) {
  const products = await api(`/api/products?q=${encodeURIComponent(q || '')}`);
  const container = document.getElementById('productsList');
  container.innerHTML = '';
  if (products.length === 0) {
    container.innerHTML = '<div class="empty-hint">Продуктов пока нет</div>';
    return;
  }
  for (const p of products) {
    const row = document.createElement('div');
    row.className = 'product-row';
    row.innerHTML = `
      <div class="product-row-info">
        <div class="product-row-name">${escapeHtml(p.name)}</div>
        <div class="product-row-sub">${round(p.calories)} ккал · Б${round(p.protein)} Ж${round(p.fat)} У${round(p.carbs)} на 100г</div>
      </div>
      <button class="entry-del">✕</button>
    `;
    row.querySelector('.entry-del').onclick = async () => {
      await api(`/api/products/${p.id}`, { method: 'DELETE' });
      loadProducts(document.getElementById('productsSearch').value);
    };
    container.appendChild(row);
  }
}

function openProductSheet() {
  document.getElementById('pName').value = '';
  document.getElementById('pKcal').value = '';
  document.getElementById('pProtein').value = '';
  document.getElementById('pFat').value = '';
  document.getElementById('pCarbs').value = '';
  document.getElementById('productAiStatus').hidden = true;
  document.getElementById('productOverlay').classList.add('open');
}

async function saveProductEntry() {
  const name = document.getElementById('pName').value.trim();
  if (!name) {
    document.getElementById('pName').focus();
    return;
  }
  await api('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      name,
      calories: document.getElementById('pKcal').value || 0,
      protein: document.getElementById('pProtein').value || 0,
      fat: document.getElementById('pFat').value || 0,
      carbs: document.getElementById('pCarbs').value || 0,
    }),
  });
  document.getElementById('productOverlay').classList.remove('open');
  loadProducts(document.getElementById('productsSearch').value);
}

async function handleProductPhoto(file) {
  const statusEl = document.getElementById('productAiStatus');
  statusEl.hidden = false;
  statusEl.textContent = 'Распознаю упаковку…';
  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch('/api/products/analyze', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка распознавания');
    document.getElementById('pName').value = data.name;
    document.getElementById('pKcal').value = round(data.calories);
    document.getElementById('pProtein').value = round(data.protein);
    document.getElementById('pFat').value = round(data.fat);
    document.getElementById('pCarbs').value = round(data.carbs);
    statusEl.hidden = true;
  } catch (err) {
    statusEl.textContent = err.message.includes('API-ключ')
      ? 'Не задан API-ключ ИИ — добавьте его в .env на сервере'
      : 'Не удалось распознать: ' + err.message;
  }
}

async function loadWeight() {
  const rows = await api('/api/weight');
  renderWeightSummary(rows);
  renderWeightChart(rows);
  renderWeightPhotos(rows);
  renderWeightList(rows);
}

function renderWeightSummary(rows) {
  const currentEl = document.getElementById('weightCurrent');
  const deltaEl = document.getElementById('weightDelta');
  if (rows.length === 0) {
    currentEl.textContent = '—';
    deltaEl.textContent = 'Добавьте первый замер';
    deltaEl.className = 'weight-delta';
    return;
  }
  const last = rows[rows.length - 1];
  currentEl.textContent = round(last.weight);
  if (rows.length === 1) {
    deltaEl.textContent = last.date;
    deltaEl.className = 'weight-delta';
    return;
  }
  const first = rows[0];
  const diff = round(last.weight - first.weight);
  deltaEl.className = 'weight-delta ' + (diff < 0 ? 'down' : diff > 0 ? 'up' : '');
  const sign = diff > 0 ? '+' : '';
  deltaEl.textContent = `${sign}${diff} кг с ${first.date}`;
}

function renderWeightChart(rows) {
  const svg = document.getElementById('weightChart');
  svg.innerHTML = '';
  if (rows.length < 2) return;

  const W = 320, H = 120, PAD = 10;
  const weights = rows.map((r) => r.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;

  const points = rows.map((r, i) => {
    const x = PAD + (i / (rows.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((r.weight - min) / range) * (H - PAD * 2);
    return [x, y];
  });

  const ns = 'http://www.w3.org/2000/svg';
  for (const frac of [0, 0.5, 1]) {
    const y = PAD + frac * (H - PAD * 2);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('class', 'grid');
    line.setAttribute('x1', PAD);
    line.setAttribute('x2', W - PAD);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    svg.appendChild(line);
  }

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', 'line');
  path.setAttribute('d', points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' '));
  svg.appendChild(path);

  for (const [x, y] of points) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 2.5);
    svg.appendChild(dot);
  }
}

function renderWeightPhotos(rows) {
  const container = document.getElementById('weightPhotos');
  container.innerHTML = '';
  const withPhotos = rows.filter((r) => r.photo).slice().reverse();
  if (withPhotos.length === 0) return;
  for (const r of withPhotos) {
    const img = document.createElement('img');
    img.className = 'weight-photo-thumb';
    img.src = r.photo;
    img.title = `${r.date} · ${round(r.weight)} кг`;
    img.onclick = () => openLightbox(r.photo);
    container.appendChild(img);
  }
}

function renderWeightList(rows) {
  const container = document.getElementById('weightList');
  container.innerHTML = '';
  const reversed = rows.slice().reverse();
  reversed.forEach((r, i) => {
    const prev = reversed[i + 1];
    const row = document.createElement('div');
    row.className = 'weight-entry';
    const diff = prev ? round(r.weight - prev.weight) : null;
    const diffText = diff == null ? '' : diff === 0 ? '±0' : (diff > 0 ? '+' : '') + diff;
    row.innerHTML = `
      ${r.photo ? `<img class="weight-entry-photo" src="${r.photo}" />` : '<div class="weight-entry-photo-empty"></div>'}
      <div class="weight-entry-date">${r.date}<div class="entry-sub">${diffText}</div></div>
      <div class="weight-entry-value">${round(r.weight)} кг</div>
      <button class="entry-del">✕</button>
    `;
    if (r.photo) row.querySelector('.weight-entry-photo').onclick = () => openLightbox(r.photo);
    row.querySelector('.entry-del').onclick = async () => {
      await api(`/api/weight/${r.id}`, { method: 'DELETE' });
      loadWeight();
    };
    container.appendChild(row);
  });
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxOverlay').classList.add('open');
}

function openWeightSheet() {
  document.getElementById('wDate').value = todayStr();
  document.getElementById('wWeight').value = '';
  weightPhotoFile = null;
  const preview = document.getElementById('wPhotoPreview');
  preview.hidden = true;
  preview.src = '';
  document.getElementById('weightOverlay').classList.add('open');
}

async function saveWeightEntry() {
  const date = document.getElementById('wDate').value;
  const weight = document.getElementById('wWeight').value;
  if (!date || !weight) return;
  const form = new FormData();
  form.append('date', date);
  form.append('weight', weight);
  if (weightPhotoFile) form.append('photo', weightPhotoFile);
  await fetch('/api/weight', { method: 'POST', body: form });
  document.getElementById('weightOverlay').classList.remove('open');
  loadWeight();
}

document.getElementById('prevDay').onclick = () => {
  currentDate = addDays(currentDate, -1);
  loadDay();
};
document.getElementById('nextDay').onclick = () => {
  currentDate = addDays(currentDate, 1);
  loadDay();
};
document.getElementById('fabAdd').onclick = () => {
  if (activeTab === 'weight') openWeightSheet();
  else if (activeTab === 'products') openProductSheet();
  else openAddSheet(currentMeal, MEALS.find((m) => m.key === currentMeal).label);
};
document.getElementById('tabDiary').onclick = () => switchTab('diary');
document.getElementById('tabWeight').onclick = () => switchTab('weight');
document.getElementById('tabProducts').onclick = () => switchTab('products');
document.getElementById('tabChat').onclick = () => switchTab('chat');

document.getElementById('chatSend').onclick = sendChatMessage;
document.getElementById('chatText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});
document.getElementById('chatPhotoBtn').onclick = () => document.getElementById('chatPhotoInput').click();
document.getElementById('chatPhotoInput').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  chatPhotoFile = file;
  const thumb = document.getElementById('chatPhotoThumb');
  thumb.src = URL.createObjectURL(file);
  thumb.hidden = false;
};

document.getElementById('productsSearch').addEventListener('input', (e) => loadProducts(e.target.value));
document.getElementById('closeProduct').onclick = () => document.getElementById('productOverlay').classList.remove('open');
document.getElementById('productOverlay').onclick = (e) => {
  if (e.target.id === 'productOverlay') e.currentTarget.classList.remove('open');
};
document.getElementById('saveProduct').onclick = saveProductEntry;
document.getElementById('productPhotoBtn').onclick = () => document.getElementById('productPhotoInput').click();
document.getElementById('productPhotoInput').onchange = (e) => {
  const file = e.target.files[0];
  if (file) handleProductPhoto(file);
  e.target.value = '';
};

document.getElementById('productPick').addEventListener('input', (e) => searchProductsForPick(e.target.value));

document.getElementById('closeWeight').onclick = () => document.getElementById('weightOverlay').classList.remove('open');
document.getElementById('weightOverlay').onclick = (e) => {
  if (e.target.id === 'weightOverlay') e.currentTarget.classList.remove('open');
};
document.getElementById('saveWeight').onclick = saveWeightEntry;
document.getElementById('wPhotoBtn').onclick = () => document.getElementById('wPhotoInput').click();
document.getElementById('wPhotoInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  weightPhotoFile = file;
  const preview = document.getElementById('wPhotoPreview');
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
};

document.getElementById('lightboxOverlay').onclick = () => document.getElementById('lightboxOverlay').classList.remove('open');
document.getElementById('closeAdd').onclick = () => document.getElementById('addOverlay').classList.remove('open');
document.getElementById('addOverlay').onclick = (e) => {
  if (e.target.id === 'addOverlay') e.currentTarget.classList.remove('open');
};
document.getElementById('saveEntry').onclick = saveManualEntry;
document.getElementById('fName').addEventListener('input', (e) => loadRecent(e.target.value));

document.getElementById('photoBtn').onclick = () => document.getElementById('photoInput').click();
document.getElementById('photoInput').onchange = (e) => {
  const file = e.target.files[0];
  if (file) handlePhoto(file);
  e.target.value = '';
};

document.getElementById('openSettings').onclick = openSettingsSheet;
document.getElementById('closeSettings').onclick = () => document.getElementById('settingsOverlay').classList.remove('open');
document.getElementById('settingsOverlay').onclick = (e) => {
  if (e.target.id === 'settingsOverlay') e.currentTarget.classList.remove('open');
};
document.getElementById('saveSettings').onclick = saveSettings;

(async function init() {
  await loadSettings();
  await loadDay();
})();
