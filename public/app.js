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
let chatPhotoFiles = [];
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

function formatNum(n) {
  return (Number(n) || 0).toLocaleString('ru-RU');
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

function getStorage(key) {
  try {
    const raw = localStorage.getItem('kkal_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStorage(key, val) {
  try {
    localStorage.setItem('kkal_' + key, JSON.stringify(val));
  } catch {}
}

function applySettings(data) {
  if (!data) return;
  settings = data;
  const kcalEl = document.getElementById('kcalGoal');
  const pEl = document.getElementById('pGoal');
  const fEl = document.getElementById('fGoal');
  const cEl = document.getElementById('cGoal');
  const stepsGoalEl = document.getElementById('diaryStepsGoal');

  if (kcalEl) kcalEl.textContent = settings.goal_calories || 2000;
  if (pEl) pEl.textContent = settings.goal_protein || 0;
  if (fEl) fEl.textContent = settings.goal_fat || 0;
  if (cEl) cEl.textContent = settings.goal_carbs || 0;
  if (stepsGoalEl) stepsGoalEl.textContent = formatNum(settings.goal_steps || 10000);
}

async function loadSettings() {
  const cached = getStorage('settings');
  if (cached) applySettings(cached);
  try {
    const fresh = await api('/api/settings');
    setStorage('settings', fresh);
    applySettings(fresh);
    return fresh;
  } catch (err) {
    console.error('Failed to load settings:', err);
    return cached;
  }
}

function applyDay(data) {
  if (!data) return;
  if (data.settings) applySettings(data.settings);
  renderMeals(data.entries || []);
  renderSummary(data.entries || []);
  renderDaySteps(data.steps || null);
}

async function loadDay() {
  document.getElementById('dateLabel').textContent = fmtDateLabel(currentDate);

  // 1. Instant render from local cache (0ms)
  const cacheKey = 'day_' + currentDate;
  const cached = getStorage(cacheKey);
  if (cached) {
    applyDay(cached);
  }

  // 2. Fetch fresh batch data in one roundtrip
  try {
    const data = await api(`/api/day?date=${currentDate}`);
    setStorage(cacheKey, data);
    if (data.settings) setStorage('settings', data.settings);
    applyDay(data);
  } catch (err) {
    console.error('Failed to load day data:', err);
    if (!cached) {
      try {
        const [entries, dayStep] = await Promise.all([
          api(`/api/entries?date=${currentDate}`),
          api(`/api/steps?date=${currentDate}`),
        ]);
        applyDay({ entries, steps: dayStep, settings });
      } catch (fallbackErr) {
        console.error('Fallback error:', fallbackErr);
      }
    }
  }
}

function renderDaySteps(dayStep) {
  const steps = dayStep ? dayStep.steps : 0;
  const goal = Number(settings && settings.goal_steps) || 10000;
  const pct = Math.min(100, Math.round((steps / goal) * 100));
  const countEl = document.getElementById('diaryStepsCount');
  const goalEl = document.getElementById('diaryStepsGoal');
  const barEl = document.getElementById('diaryStepsBar');
  const distEl = document.getElementById('diaryStepsDist');
  const kcalEl = document.getElementById('diaryStepsKcal');
  const pctEl = document.getElementById('diaryStepsPct');
  const editBtn = document.getElementById('diaryStepsEdit');

  if (countEl) countEl.textContent = formatNum(steps);
  if (goalEl) goalEl.textContent = formatNum(goal);
  if (barEl) barEl.style.width = pct + '%';
  const dist = dayStep && dayStep.distance_km != null ? dayStep.distance_km : Math.round(steps * 0.00075 * 10) / 10;
  const kcal = dayStep && dayStep.calories != null ? dayStep.calories : Math.round(steps * 0.04);
  if (distEl) distEl.textContent = Number(dist || 0).toFixed(1);
  if (kcalEl) kcalEl.textContent = round(kcal);
  if (pctEl) pctEl.textContent = pct + '%';
  if (editBtn) {
    editBtn.textContent = steps > 0 ? 'Изменить' : 'Записать';
    editBtn.onclick = () => openStepsSheet(currentDate, steps || '');
  }
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

let editingEntry = null;
let editEntryOriginalGrams = 0;
let editEntryOriginalKcal = 0;
let editEntryOriginalProtein = 0;
let editEntryOriginalFat = 0;
let editEntryOriginalCarbs = 0;

function renderEntry(e) {
  const row = document.createElement('div');
  row.className = 'entry entry-clickable';
  const sub = [e.grams ? `${round(e.grams)} г` : null, `Б${round(e.protein)} Ж${round(e.fat)} У${round(e.carbs)}`]
    .filter(Boolean)
    .join(' · ');
  row.innerHTML = `
    <div class="entry-name">${escapeHtml(e.name)}<div class="entry-sub">${sub}</div></div>
    <div class="entry-kcal">${round(e.calories)}</div>
    <div class="entry-actions">
      <button class="entry-action-btn entry-edit" title="Редактировать">✎</button>
      <button class="entry-action-btn entry-del" title="Удалить">✕</button>
    </div>
  `;
  row.onclick = (evt) => {
    if (evt.target.closest('.entry-del')) return;
    openEditEntrySheet(e);
  };
  row.querySelector('.entry-edit').onclick = (evt) => {
    evt.stopPropagation();
    openEditEntrySheet(e);
  };
  row.querySelector('.entry-del').onclick = async (evt) => {
    evt.stopPropagation();
    await api(`/api/entries/${e.id}`, { method: 'DELETE' });
    loadDay();
  };
  return row;
}

function openEditEntrySheet(entry) {
  editingEntry = entry;
  document.getElementById('editEntryMeal').value = entry.meal || currentMeal;
  document.getElementById('editEntryDate').value = entry.date || currentDate;
  document.getElementById('editEntryName').value = entry.name || '';
  document.getElementById('editEntryGrams').value = entry.grams != null ? entry.grams : '';
  document.getElementById('editEntryKcal').value = entry.calories != null ? round(entry.calories) : '';
  document.getElementById('editEntryProtein').value = entry.protein != null ? round(entry.protein) : '';
  document.getElementById('editEntryFat').value = entry.fat != null ? round(entry.fat) : '';
  document.getElementById('editEntryCarbs').value = entry.carbs != null ? round(entry.carbs) : '';

  editEntryOriginalGrams = Number(entry.grams) || 0;
  editEntryOriginalKcal = Number(entry.calories) || 0;
  editEntryOriginalProtein = Number(entry.protein) || 0;
  editEntryOriginalFat = Number(entry.fat) || 0;
  editEntryOriginalCarbs = Number(entry.carbs) || 0;

  document.getElementById('editEntryOverlay').classList.add('open');
}

function handleEditEntryGramsChange() {
  if (!editEntryOriginalGrams || editEntryOriginalGrams <= 0) return;
  const newGrams = Number(document.getElementById('editEntryGrams').value) || 0;
  if (newGrams <= 0) return;
  const ratio = newGrams / editEntryOriginalGrams;
  document.getElementById('editEntryKcal').value = round(editEntryOriginalKcal * ratio);
  document.getElementById('editEntryProtein').value = round(editEntryOriginalProtein * ratio);
  document.getElementById('editEntryFat').value = round(editEntryOriginalFat * ratio);
  document.getElementById('editEntryCarbs').value = round(editEntryOriginalCarbs * ratio);
}

async function saveEditEntry() {
  if (!editingEntry) return;
  const name = document.getElementById('editEntryName').value.trim();
  if (!name) {
    document.getElementById('editEntryName').focus();
    return;
  }
  const meal = document.getElementById('editEntryMeal').value;
  const date = document.getElementById('editEntryDate').value || currentDate;
  const grams = document.getElementById('editEntryGrams').value;
  const calories = document.getElementById('editEntryKcal').value;
  const protein = document.getElementById('editEntryProtein').value;
  const fat = document.getElementById('editEntryFat').value;
  const carbs = document.getElementById('editEntryCarbs').value;

  await api(`/api/entries/${editingEntry.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      date,
      meal,
      name,
      grams: grams !== '' ? Number(grams) : null,
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      fat: Number(fat) || 0,
      carbs: Number(carbs) || 0,
    }),
  });

  document.getElementById('editEntryOverlay').classList.remove('open');
  editingEntry = null;
  loadDay();
}

async function deleteCurrentEditEntry() {
  if (!editingEntry) return;
  await api(`/api/entries/${editingEntry.id}`, { method: 'DELETE' });
  document.getElementById('editEntryOverlay').classList.remove('open');
  editingEntry = null;
  loadDay();
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
  document.getElementById('sGoalSteps').value = settings.goal_steps || 10000;
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
      goal_steps: document.getElementById('sGoalSteps').value || 10000,
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
  activeTab = tab || 'diary';
  if (tab === 'steps') loadSteps();
  if (tab === 'weight') loadWeight();
  if (tab === 'products') loadProducts();
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

  const urls = msg.photoUrls || (msg.photoUrl ? [msg.photoUrl] : []);
  if (urls.length > 0) {
    const photosWrap = document.createElement('div');
    photosWrap.className = 'chat-bubble-photos';
    for (const url of urls) {
      const img = document.createElement('img');
      img.className = 'chat-bubble-photo';
      img.src = url;
      img.onclick = () => openLightbox(url);
      photosWrap.appendChild(img);
    }
    bubble.appendChild(photosWrap);
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
  loadDay();
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

function addChatPhotos(files) {
  if (!files || files.length === 0) return;
  const list = Array.from(files).filter((f) => f.type && f.type.startsWith('image/'));
  for (const f of list) {
    if (chatPhotoFiles.length >= 10) break;
    chatPhotoFiles.push(f);
  }
  renderChatPhotosPreview();
}

function removeChatPhoto(index) {
  chatPhotoFiles.splice(index, 1);
  renderChatPhotosPreview();
}

function clearChatPhotos() {
  chatPhotoFiles = [];
  renderChatPhotosPreview();
}

function renderChatPhotosPreview() {
  const container = document.getElementById('chatPhotosList');
  if (!container) return;
  container.innerHTML = '';
  if (chatPhotoFiles.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  chatPhotoFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'chat-photo-item';
    const url = URL.createObjectURL(file);
    item.innerHTML = `
      <img src="${url}" title="${escapeHtml(file.name)}" />
      <button class="chat-photo-remove" type="button" title="Удалить">✕</button>
    `;
    item.querySelector('img').onclick = () => openLightbox(url);
    item.querySelector('.chat-photo-remove').onclick = (e) => {
      e.stopPropagation();
      removeChatPhoto(idx);
    };
    container.appendChild(item);
  });
}

function setupChatDragAndDrop() {
  const dropZone = document.getElementById('aiDropZone');
  const dragOverlay = document.getElementById('dragOverlay');
  if (!dropZone) return;

  let dragCounter = 0;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  dropZone.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter++;
      dropZone.classList.add('dragover');
      if (dragOverlay) dragOverlay.hidden = false;
    }
  });

  dropZone.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropZone.classList.remove('dragover');
      if (dragOverlay) dragOverlay.hidden = true;
    }
  });

  dropZone.addEventListener('drop', (e) => {
    dragCounter = 0;
    dropZone.classList.remove('dragover');
    if (dragOverlay) dragOverlay.hidden = true;
    const files = e.dataTransfer ? e.dataTransfer.files : [];
    if (files && files.length > 0) {
      addChatPhotos(files);
    }
  });
}

async function sendChatMessage() {
  if (chatSending) return;
  const textEl = document.getElementById('chatText');
  const text = textEl.value.trim();
  const photos = [...chatPhotoFiles];
  if (!text && photos.length === 0) return;

  const photoUrls = photos.map((f) => URL.createObjectURL(f));
  const userMsg = {
    role: 'user',
    text,
    photoUrls,
    photoUrl: photoUrls[0] || null,
  };
  chatHistory.push(userMsg);
  const assistantMsg = { role: 'assistant', pending: true };
  chatHistory.push(assistantMsg);
  textEl.value = '';
  clearChatPhotos();
  chatSending = true;
  renderChat();

  const sendBtn = document.getElementById('chatSend');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span>Распознаю…</span>';
  }

  try {
    const form = new FormData();
    const apiHistory = chatHistory
      .filter((m) => !m.pending)
      .slice(0, -1)
      .map((m) => ({ role: m.role, text: chatMsgSummary(m) }));
    const userLabel = text || (photos.length > 1 ? `[${photos.length} фото]` : '[фото]');
    apiHistory.push({ role: 'user', text: userLabel });
    form.append('history', JSON.stringify(apiHistory));
    for (const p of photos) {
      form.append('images', p);
    }
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
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>Распознать</span><span class="send-arrow">➤</span>';
    }
    renderChat();
  }
}

let editingProduct = null;

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
    row.className = 'product-row product-clickable';
    row.innerHTML = `
      <div class="product-row-info">
        <div class="product-row-name">${escapeHtml(p.name)}</div>
        <div class="product-row-sub">${round(p.calories)} ккал · Б${round(p.protein)} Ж${round(p.fat)} У${round(p.carbs)} на 100г</div>
      </div>
      <div class="entry-actions">
        <button class="entry-action-btn entry-edit" title="Редактировать">✎</button>
        <button class="entry-action-btn entry-del" title="Удалить">✕</button>
      </div>
    `;
    row.onclick = (evt) => {
      if (evt.target.closest('.entry-del')) return;
      openEditProductSheet(p);
    };
    row.querySelector('.entry-edit').onclick = (evt) => {
      evt.stopPropagation();
      openEditProductSheet(p);
    };
    row.querySelector('.entry-del').onclick = async (evt) => {
      evt.stopPropagation();
      await api(`/api/products/${p.id}`, { method: 'DELETE' });
      loadProducts(document.getElementById('productsSearch').value);
    };
    container.appendChild(row);
  }
}

function openProductSheet() {
  editingProduct = null;
  document.getElementById('productSheetTitle').textContent = 'Новый продукт';
  document.getElementById('saveProduct').textContent = 'Сохранить продукт';
  document.getElementById('deleteProductBtn').hidden = true;
  document.getElementById('pName').value = '';
  document.getElementById('pKcal').value = '';
  document.getElementById('pProtein').value = '';
  document.getElementById('pFat').value = '';
  document.getElementById('pCarbs').value = '';
  document.getElementById('productAiStatus').hidden = true;
  document.getElementById('productOverlay').classList.add('open');
}

function openEditProductSheet(p) {
  editingProduct = p;
  document.getElementById('productSheetTitle').textContent = 'Редактировать продукт';
  document.getElementById('saveProduct').textContent = 'Сохранить изменения';
  document.getElementById('deleteProductBtn').hidden = false;
  document.getElementById('pName').value = p.name || '';
  document.getElementById('pKcal').value = p.calories != null ? round(p.calories) : '';
  document.getElementById('pProtein').value = p.protein != null ? round(p.protein) : '';
  document.getElementById('pFat').value = p.fat != null ? round(p.fat) : '';
  document.getElementById('pCarbs').value = p.carbs != null ? round(p.carbs) : '';
  document.getElementById('productAiStatus').hidden = true;
  document.getElementById('productOverlay').classList.add('open');
}

async function saveProductEntry() {
  const name = document.getElementById('pName').value.trim();
  if (!name) {
    document.getElementById('pName').focus();
    return;
  }
  const body = {
    name,
    calories: Number(document.getElementById('pKcal').value) || 0,
    protein: Number(document.getElementById('pProtein').value) || 0,
    fat: Number(document.getElementById('pFat').value) || 0,
    carbs: Number(document.getElementById('pCarbs').value) || 0,
  };

  if (editingProduct) {
    await api(`/api/products/${editingProduct.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  } else {
    await api('/api/products', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  document.getElementById('productOverlay').classList.remove('open');
  editingProduct = null;
  loadProducts(document.getElementById('productsSearch').value);
}

async function deleteProductEntry() {
  if (!editingProduct) return;
  await api(`/api/products/${editingProduct.id}`, { method: 'DELETE' });
  document.getElementById('productOverlay').classList.remove('open');
  editingProduct = null;
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

async function loadSteps() {
  const cached = getStorage('steps_list');
  if (cached) {
    renderStepsSummary(cached);
    renderStepsChart(cached);
    renderStepsList(cached);
  }
  try {
    const rows = await api('/api/steps');
    setStorage('steps_list', rows);
    renderStepsSummary(rows);
    renderStepsChart(rows);
    renderStepsList(rows);
  } catch (err) {
    console.error('Failed to load steps:', err);
  }
}

function renderStepsSummary(rows) {
  const goal = Number(settings && settings.goal_steps) || 10000;
  const todayEntry = rows.find((r) => r.date === todayStr());
  const currentSteps = todayEntry ? todayEntry.steps : (rows.length > 0 ? rows[rows.length - 1].steps : 0);
  const currentDist = todayEntry ? todayEntry.distance_km : (rows.length > 0 ? rows[rows.length - 1].distance_km : 0);
  const currentKcal = todayEntry ? todayEntry.calories : (rows.length > 0 ? rows[rows.length - 1].calories : 0);

  document.getElementById('stepsCurrent').textContent = formatNum(currentSteps);
  const statusEl = document.getElementById('stepsTargetStatus');
  const pct = Math.round((currentSteps / goal) * 100);
  if (pct >= 100) {
    statusEl.className = 'steps-target-status achieved';
    statusEl.textContent = `Цель ${formatNum(goal)} выполнена! (${pct}%)`;
  } else {
    statusEl.className = 'steps-target-status';
    statusEl.textContent = `Цель: ${formatNum(goal)} (${pct}%)`;
  }

  const totalKm = rows.reduce((s, r) => s + (r.distance_km || 0), 0);
  const totalKcal = rows.reduce((s, r) => s + (r.calories || 0), 0);
  const avgSteps = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.steps, 0) / rows.length) : 0;

  document.getElementById('stepsStatDist').textContent = (totalKm || currentDist || 0).toFixed(1);
  document.getElementById('stepsStatKcal').textContent = formatNum(Math.round(totalKcal || currentKcal || 0));
  document.getElementById('stepsStatAvg').textContent = formatNum(avgSteps || currentSteps);
}

function renderStepsChart(rows) {
  const svg = document.getElementById('stepsChart');
  svg.innerHTML = '';
  const goal = Number(settings && settings.goal_steps) || 10000;

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(toDateStr(d));
  }

  const stepMap = new Map();
  for (const r of rows) stepMap.set(r.date, r);

  const data = days.map((date) => {
    const entry = stepMap.get(date);
    return {
      date,
      steps: entry ? entry.steps : 0,
      id: entry ? entry.id : null,
    };
  });

  const maxSteps = Math.max(goal * 1.15, ...data.map((d) => d.steps));
  const W = 320, H = 120, PAD_TOP = 16, PAD_BTM = 18, PAD_X = 10;
  const chartH = H - PAD_TOP - PAD_BTM;
  const numBars = data.length;
  const slotW = (W - PAD_X * 2) / numBars;
  const barW = Math.max(6, slotW - 5);
  const ns = 'http://www.w3.org/2000/svg';

  // Goal line
  const goalY = PAD_TOP + chartH * (1 - goal / maxSteps);
  const goalLine = document.createElementNS(ns, 'line');
  goalLine.setAttribute('class', 'goal-line');
  goalLine.setAttribute('x1', PAD_X);
  goalLine.setAttribute('x2', W - PAD_X);
  goalLine.setAttribute('y1', goalY);
  goalLine.setAttribute('y2', goalY);
  svg.appendChild(goalLine);

  // Goal text label
  const goalText = document.createElementNS(ns, 'text');
  goalText.setAttribute('class', 'chart-label');
  goalText.setAttribute('x', W - PAD_X - 2);
  goalText.setAttribute('y', Math.max(10, goalY - 3));
  goalText.setAttribute('text-anchor', 'end');
  goalText.textContent = `Цель ${goal >= 1000 ? Math.round(goal / 1000) + 'k' : goal}`;
  svg.appendChild(goalText);

  // Draw bars
  data.forEach((d, i) => {
    const x = PAD_X + i * slotW + (slotW - barW) / 2;
    const barH = d.steps > 0 ? Math.max(3, (d.steps / maxSteps) * chartH) : 0;
    const y = PAD_TOP + chartH - barH;

    if (barH > 0) {
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', `bar ${d.steps >= goal ? 'goal-met' : 'below-goal'}`);
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', barH);
      rect.setAttribute('rx', 2.5);
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${d.date}: ${formatNum(d.steps)} шагов`;
      rect.appendChild(title);
      rect.onclick = () => {
        const item = stepMap.get(d.date);
        if (item) openEditStepsSheet(item);
        else openStepsSheet(d.date, '');
      };
      svg.appendChild(rect);
    }

    if (i % 2 === 1 || i === numBars - 1) {
      const dt = new Date(d.date + 'T00:00:00');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('class', 'chart-label');
      text.setAttribute('x', x + barW / 2);
      text.setAttribute('y', H - 4);
      text.textContent = dt.getDate();
      svg.appendChild(text);
    }
  });
}

let editingStep = null;

function renderStepsList(rows) {
  const container = document.getElementById('stepsList');
  container.innerHTML = '';
  const goal = Number(settings && settings.goal_steps) || 10000;
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty-hint">Записей шагов пока нет</div>';
    return;
  }
  const reversed = rows.slice().reverse();
  for (const r of reversed) {
    const row = document.createElement('div');
    row.className = 'steps-entry steps-clickable';
    const isAchieved = r.steps >= goal;
    const dist = (r.distance_km || Math.round(r.steps * 0.00075 * 10) / 10).toFixed(1);
    const kcal = round(r.calories || Math.round(r.steps * 0.04));

    row.innerHTML = `
      <div class="steps-entry-info">
        <div class="steps-entry-date">${fmtDateLabel(r.date)} <span class="entry-sub">(${r.date})</span></div>
        <div class="steps-entry-meta">${dist} км · ${kcal} ккал ${isAchieved ? '<span class="steps-entry-badge">✓ Цель выполнена</span>' : ''}</div>
      </div>
      <div class="steps-entry-value">${formatNum(r.steps)}</div>
      <div class="entry-actions">
        <button class="entry-action-btn entry-edit" title="Редактировать">✎</button>
        <button class="entry-action-btn entry-del" title="Удалить">✕</button>
      </div>
    `;

    row.onclick = (evt) => {
      if (evt.target.closest('.entry-del')) return;
      openEditStepsSheet(r);
    };
    row.querySelector('.entry-edit').onclick = (evt) => {
      evt.stopPropagation();
      openEditStepsSheet(r);
    };
    row.querySelector('.entry-del').onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/steps/${r.id}`, { method: 'DELETE' });
      loadSteps();
      if (r.date === currentDate) loadDay();
    };
    container.appendChild(row);
  }
}

function openStepsSheet(date, steps) {
  editingStep = null;
  document.getElementById('stepsSheetTitle').textContent = 'Запись шагов';
  document.getElementById('saveSteps').textContent = 'Сохранить шаги';
  document.getElementById('deleteStepsBtn').hidden = true;
  document.getElementById('stDate').value = date || currentDate || todayStr();
  document.getElementById('stSteps').value = steps != null ? steps : '';
  document.getElementById('stDist').value = '';
  document.getElementById('stKcal').value = '';
  updateStepsPreview();
  document.getElementById('stepsOverlay').classList.add('open');
  setTimeout(() => {
    const input = document.getElementById('stSteps');
    if (input) input.focus();
  }, 100);
}

function openEditStepsSheet(r) {
  editingStep = r;
  document.getElementById('stepsSheetTitle').textContent = 'Редактировать шаги';
  document.getElementById('saveSteps').textContent = 'Сохранить изменения';
  document.getElementById('deleteStepsBtn').hidden = false;
  document.getElementById('stDate').value = r.date;
  document.getElementById('stSteps').value = r.steps != null ? r.steps : '';
  document.getElementById('stDist').value = r.distance_km != null ? r.distance_km : '';
  document.getElementById('stKcal').value = r.calories != null ? round(r.calories) : '';
  updateStepsPreview();
  document.getElementById('stepsOverlay').classList.add('open');
  setTimeout(() => {
    const input = document.getElementById('stSteps');
    if (input) input.focus();
  }, 100);
}

function updateStepsPreview() {
  const count = Math.max(0, Math.round(Number(document.getElementById('stSteps').value) || 0));
  const autoDist = (count * 0.00075).toFixed(1);
  const autoKcal = Math.round(count * 0.04);
  const userDist = document.getElementById('stDist').value;
  const userKcal = document.getElementById('stKcal').value;
  const dist = userDist !== '' && !isNaN(Number(userDist)) ? Number(userDist).toFixed(1) : autoDist;
  const kcal = userKcal !== '' && !isNaN(Number(userKcal)) ? Math.round(Number(userKcal)) : autoKcal;
  const metaEl = document.getElementById('stPreviewMeta');
  if (metaEl) metaEl.textContent = `~${dist} км · ~${kcal} ккал`;
}

async function saveStepsEntry() {
  const date = document.getElementById('stDate').value;
  const rawSteps = document.getElementById('stSteps').value;
  if (!date || rawSteps === '') return;
  const steps = Math.max(0, Math.round(Number(rawSteps)) || 0);
  const distVal = document.getElementById('stDist').value;
  const kcalVal = document.getElementById('stKcal').value;
  const body = {
    date,
    steps,
    distance_km: distVal !== '' ? Number(distVal) : null,
    calories: kcalVal !== '' ? Number(kcalVal) : null,
  };

  if (editingStep) {
    await api(`/api/steps/${editingStep.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  } else {
    await api('/api/steps', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  document.getElementById('stepsOverlay').classList.remove('open');
  const targetDate = date;
  const prevDate = editingStep ? editingStep.date : null;
  editingStep = null;
  if (targetDate === currentDate || prevDate === currentDate) loadDay();
  loadSteps();
}

async function deleteStepEntry() {
  if (!editingStep) return;
  const date = editingStep.date;
  await api(`/api/steps/${editingStep.id}`, { method: 'DELETE' });
  document.getElementById('stepsOverlay').classList.remove('open');
  editingStep = null;
  if (date === currentDate) loadDay();
  loadSteps();
}

async function loadWeight() {
  const cached = getStorage('weight_list');
  if (cached) {
    renderWeightSummary(cached);
    renderWeightChart(cached);
    renderWeightPhotos(cached);
    renderWeightList(cached);
  }
  try {
    const rows = await api('/api/weight');
    setStorage('weight_list', rows);
    renderWeightSummary(rows);
    renderWeightChart(rows);
    renderWeightPhotos(rows);
    renderWeightList(rows);
  } catch (err) {
    console.error('Failed to load weight:', err);
  }
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

let editingWeight = null;
let removeExistingWeightPhoto = false;

function renderWeightList(rows) {
  const container = document.getElementById('weightList');
  container.innerHTML = '';
  const reversed = rows.slice().reverse();
  reversed.forEach((r, i) => {
    const prev = reversed[i + 1];
    const row = document.createElement('div');
    row.className = 'weight-entry weight-clickable';
    const diff = prev ? round(r.weight - prev.weight) : null;
    const diffText = diff == null ? '' : diff === 0 ? '±0' : (diff > 0 ? '+' : '') + diff;
    row.innerHTML = `
      ${r.photo ? `<img class="weight-entry-photo" src="${r.photo}" />` : '<div class="weight-entry-photo-empty"></div>'}
      <div class="weight-entry-date">${r.date}<div class="entry-sub">${diffText}</div></div>
      <div class="weight-entry-value">${round(r.weight)} кг</div>
      <div class="entry-actions">
        <button class="entry-action-btn entry-edit" title="Редактировать">✎</button>
        <button class="entry-action-btn entry-del" title="Удалить">✕</button>
      </div>
    `;
    if (r.photo) {
      row.querySelector('.weight-entry-photo').onclick = (evt) => {
        evt.stopPropagation();
        openLightbox(r.photo);
      };
    }
    row.onclick = (evt) => {
      if (evt.target.closest('.entry-del') || evt.target.closest('.weight-entry-photo')) return;
      openEditWeightSheet(r);
    };
    row.querySelector('.entry-edit').onclick = (evt) => {
      evt.stopPropagation();
      openEditWeightSheet(r);
    };
    row.querySelector('.entry-del').onclick = async (evt) => {
      evt.stopPropagation();
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
  editingWeight = null;
  removeExistingWeightPhoto = false;
  document.getElementById('weightSheetTitle').textContent = 'Замер веса';
  document.getElementById('saveWeight').textContent = 'Добавить';
  document.getElementById('deleteWeightBtn').hidden = true;
  document.getElementById('wDate').value = todayStr();
  document.getElementById('wWeight').value = '';
  weightPhotoFile = null;
  const wrap = document.getElementById('wPhotoWrap');
  wrap.hidden = true;
  document.getElementById('wPhotoPreview').src = '';
  document.getElementById('weightOverlay').classList.add('open');
}

function openEditWeightSheet(r) {
  editingWeight = r;
  removeExistingWeightPhoto = false;
  document.getElementById('weightSheetTitle').textContent = 'Редактировать замер';
  document.getElementById('saveWeight').textContent = 'Сохранить';
  document.getElementById('deleteWeightBtn').hidden = false;
  document.getElementById('wDate').value = r.date;
  document.getElementById('wWeight').value = round(r.weight);
  weightPhotoFile = null;
  const wrap = document.getElementById('wPhotoWrap');
  const preview = document.getElementById('wPhotoPreview');
  if (r.photo) {
    wrap.hidden = false;
    preview.src = r.photo;
  } else {
    wrap.hidden = true;
    preview.src = '';
  }
  document.getElementById('weightOverlay').classList.add('open');
}

async function saveWeightEntry() {
  const date = document.getElementById('wDate').value;
  const weight = document.getElementById('wWeight').value;
  if (!date || !weight) return;
  const form = new FormData();
  form.append('date', date);
  form.append('weight', weight);
  if (weightPhotoFile) {
    form.append('photo', weightPhotoFile);
  } else if (removeExistingWeightPhoto) {
    form.append('removePhoto', 'true');
  }

  if (editingWeight) {
    await fetch(`/api/weight/${editingWeight.id}`, { method: 'PUT', body: form });
  } else {
    await fetch('/api/weight', { method: 'POST', body: form });
  }
  document.getElementById('weightOverlay').classList.remove('open');
  editingWeight = null;
  loadWeight();
}

async function deleteWeightEntry() {
  if (!editingWeight) return;
  await api(`/api/weight/${editingWeight.id}`, { method: 'DELETE' });
  document.getElementById('weightOverlay').classList.remove('open');
  editingWeight = null;
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
  openAddSheet(currentMeal, MEALS.find((m) => m.key === currentMeal).label);
};

const todayBtn = document.getElementById('todayBtn');
if (todayBtn) {
  todayBtn.onclick = () => {
    currentDate = todayStr();
    loadDay();
  };
}

function openProductsSheet() {
  loadProducts();
  document.getElementById('productsOverlay').classList.add('open');
}

const openProductsBtn = document.getElementById('openProductsBtn');
if (openProductsBtn) {
  openProductsBtn.onclick = () => openProductsSheet();
}

const closeProductsSheet = document.getElementById('closeProductsSheet');
if (closeProductsSheet) {
  closeProductsSheet.onclick = () => document.getElementById('productsOverlay').classList.remove('open');
}

const btnAddNewProduct = document.getElementById('btnAddNewProduct');
if (btnAddNewProduct) {
  btnAddNewProduct.onclick = () => openProductSheet();
}

const openWeightBtn = document.getElementById('openWeightBtn');
if (openWeightBtn) {
  openWeightBtn.onclick = () => openWeightSheet();
}

const addMealQuickBtn = document.getElementById('addMealQuickBtn');
if (addMealQuickBtn) {
  addMealQuickBtn.onclick = () => openAddSheet(currentMeal, MEALS.find((m) => m.key === currentMeal).label);
}

document.getElementById('closeSteps').onclick = () => document.getElementById('stepsOverlay').classList.remove('open');
document.getElementById('stepsOverlay').onclick = (e) => {
  if (e.target.id === 'stepsOverlay') e.currentTarget.classList.remove('open');
};
document.getElementById('saveSteps').onclick = saveStepsEntry;
document.getElementById('stSteps').addEventListener('input', updateStepsPreview);
document.querySelectorAll('.quick-step-btn').forEach((btn) => {
  btn.onclick = () => {
    const add = Number(btn.getAttribute('data-add')) || 0;
    const cur = Number(document.getElementById('stSteps').value) || 0;
    document.getElementById('stSteps').value = cur + add;
    updateStepsPreview();
  };
});

document.getElementById('chatSend').onclick = sendChatMessage;
document.getElementById('chatText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
document.getElementById('chatPhotoBtn').onclick = () => document.getElementById('chatPhotoInput').click();
document.getElementById('chatPhotoInput').onchange = (e) => {
  if (e.target.files && e.target.files.length > 0) {
    addChatPhotos(e.target.files);
  }
  e.target.value = '';
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

document.getElementById('closeEditEntry').onclick = () => document.getElementById('editEntryOverlay').classList.remove('open');
document.getElementById('editEntryOverlay').onclick = (e) => {
  if (e.target.id === 'editEntryOverlay') e.currentTarget.classList.remove('open');
};
document.getElementById('saveEditEntry').onclick = saveEditEntry;
document.getElementById('deleteEditEntry').onclick = deleteCurrentEditEntry;
document.getElementById('editEntryGrams').addEventListener('input', handleEditEntryGramsChange);

document.getElementById('deleteProductBtn').onclick = deleteProductEntry;
document.getElementById('deleteStepsBtn').onclick = deleteStepEntry;
document.getElementById('deleteWeightBtn').onclick = deleteWeightEntry;

document.getElementById('stDist').addEventListener('input', updateStepsPreview);
document.getElementById('stKcal').addEventListener('input', updateStepsPreview);

const wPhotoRemoveBtn = document.getElementById('wPhotoRemove');
if (wPhotoRemoveBtn) {
  wPhotoRemoveBtn.onclick = () => {
    weightPhotoFile = null;
    removeExistingWeightPhoto = true;
    document.getElementById('wPhotoWrap').hidden = true;
    document.getElementById('wPhotoPreview').src = '';
  };
}

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

(function init() {
  const cachedSettings = getStorage('settings');
  if (cachedSettings) applySettings(cachedSettings);

  const cachedDay = getStorage('day_' + currentDate);
  if (cachedDay) applyDay(cachedDay);

  loadDay();
  loadSteps();
  loadWeight();
  initChat();
  setupChatDragAndDrop();
})();
