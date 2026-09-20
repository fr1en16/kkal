const MEALS = [
  { key: 'breakfast', label: 'Завтрак' },
  { key: 'lunch', label: 'Обед' },
  { key: 'dinner', label: 'Ужин' },
  { key: 'snack', label: 'Перекус' },
];

let currentDate = todayStr();
let currentView = 'day'; // 'day' | 'history'
let dayTab = 'chat'; // 'chat' | 'meals'
let historyTab = 'list'; // 'list' | 'calendar'
let calendarMonth = new Date();
let settings = null;
let dayData = null;
let historyData = [];
let chatPhotoFiles = [];
let chatSending = false;
let selectedMealContext = null;

// Direct editing state
let editingEntry = null;
let recalcOriginal = null;
let deleteConfirmTimer = null;

// Product editing state
let editingProduct = null;

// Speech recognition
let speechRecognition = null;
let isRecordingVoice = false;

// --------------------------------------------------------------------------
// Date & Formatting Utilities
// --------------------------------------------------------------------------

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

function fmtShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function fmtWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const s = d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtMonthYear(d) {
  const s = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round(n) {
  return Math.round((n || 0) * 10) / 10;
}

function formatNum(n) {
  return (Number(n) || 0).toLocaleString('ru-RU');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function guessMealByTime() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

// --------------------------------------------------------------------------
// API & Storage
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// View Management
// --------------------------------------------------------------------------

function setView(view) {
  currentView = view;
  const dayViewEl = document.getElementById('dayView');
  const historyViewEl = document.getElementById('historyView');
  const topbarDate = document.getElementById('topbarDate');
  const historyTitle = document.getElementById('historyTitle');
  const toggleBtn = document.getElementById('toggleHistoryBtn');

  if (view === 'history') {
    dayViewEl.hidden = true;
    historyViewEl.hidden = false;
    topbarDate.hidden = true;
    historyTitle.hidden = false;
    toggleBtn.innerHTML = '<i class="ph ph-house" aria-hidden="true"></i>';
    toggleBtn.title = 'Вернуться к сегодняшнему дню';
    loadHistory();
  } else {
    dayViewEl.hidden = false;
    historyViewEl.hidden = true;
    topbarDate.hidden = false;
    historyTitle.hidden = true;
    toggleBtn.innerHTML = '<i class="ph ph-calendar-blank" aria-hidden="true"></i>';
    toggleBtn.title = 'История по дням';
    updateInputPlaceholder();
    loadDay(currentDate);
  }
}

function setDayTab(tab) {
  dayTab = tab;
  const tabBtnChat = document.getElementById('tabBtnChat');
  const tabBtnMeals = document.getElementById('tabBtnMeals');
  const paneChat = document.getElementById('paneChat');
  const paneMeals = document.getElementById('paneMeals');

  if (tab === 'meals') {
    tabBtnChat.classList.remove('active');
    tabBtnMeals.classList.add('active');
    paneChat.classList.remove('active');
    paneMeals.classList.add('active');
  } else {
    tabBtnChat.classList.add('active');
    tabBtnMeals.classList.remove('active');
    paneChat.classList.add('active');
    paneMeals.classList.remove('active');
  }
}

function setHistoryTab(tab) {
  historyTab = tab;
  const listBtn = document.getElementById('histListTabBtn');
  const calBtn = document.getElementById('histCalTabBtn');
  const listPane = document.getElementById('historyListPane');
  const calPane = document.getElementById('historyCalPane');

  if (tab === 'calendar') {
    listBtn.classList.remove('active');
    calBtn.classList.add('active');
    listPane.classList.remove('active');
    calPane.classList.add('active');
    renderCalendar();
  } else {
    listBtn.classList.add('active');
    calBtn.classList.remove('active');
    listPane.classList.add('active');
    calPane.classList.remove('active');
    renderHistoryList();
  }
}

function updateInputPlaceholder() {
  const input = document.getElementById('chatText');
  const banner = document.getElementById('backlogBanner');
  if (currentDate === todayStr()) {
    if (input) input.placeholder = 'Напишите, что съели, вес, шаги…';
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
  } else {
    if (input) input.placeholder = `Добавить запись на ${fmtShortDate(currentDate)}…`;
    if (banner) {
      banner.hidden = false;
      banner.textContent = `📅 Запись за ${fmtDateLabel(currentDate)}`;
    }
  }
}

// --------------------------------------------------------------------------
// Day Data Loading & Rendering
// --------------------------------------------------------------------------

function applySettings(data) {
  if (!data) return;
  settings = data;
  const kcalEl = document.getElementById('kcalGoal');
  const pEl = document.getElementById('pGoal');
  const fEl = document.getElementById('fGoal');
  const cEl = document.getElementById('cGoal');

  if (kcalEl) kcalEl.textContent = settings.goal_calories || 2000;
  if (pEl) pEl.textContent = settings.goal_protein || 120;
  if (fEl) fEl.textContent = settings.goal_fat || 65;
  if (cEl) cEl.textContent = settings.goal_carbs || 250;

  const targetLabel = document.getElementById('dynamicsTargetLabel');
  if (targetLabel) targetLabel.textContent = `Цель: ${formatNum(settings.goal_calories || 2000)} ккал`;
}

async function loadSettings() {
  const cached = getStorage('settings');
  if (cached) applySettings(cached);
  try {
    const fresh = await api(`/api/settings?date=${currentDate}`);
    setStorage('settings', fresh);
    applySettings(fresh);
    return fresh;
  } catch (err) {
    console.error('Failed to load settings:', err);
    return cached;
  }
}

function renderSummary(entries) {
  const totals = entries.reduce(
    (acc, e) => {
      acc.kcal += Number(e.calories) || 0;
      acc.p += Number(e.protein) || 0;
      acc.f += Number(e.fat) || 0;
      acc.c += Number(e.carbs) || 0;
      return acc;
    },
    { kcal: 0, p: 0, f: 0, c: 0 }
  );
  document.getElementById('kcalEaten').textContent = round(totals.kcal);
  document.getElementById('pEaten').textContent = round(totals.p);
  document.getElementById('fEaten').textContent = round(totals.f);
  document.getElementById('cEaten').textContent = round(totals.c);

  const goal = Number(settings && settings.goal_calories) || 2000;
  const pct = Math.min(100, Math.round((totals.kcal / goal) * 100));
  const bar = document.getElementById('kcalBar');
  bar.style.width = pct + '%';
  bar.style.background = totals.kcal > goal ? '#ef4444' : 'var(--accent)';

  const kcalPercent = document.getElementById('kcalPercent');
  if (kcalPercent) kcalPercent.textContent = `${Math.round((totals.kcal / goal) * 100)}%`;

  const macroProgress = [
    ['p', totals.p, Number(settings && settings.goal_protein) || 120],
    ['f', totals.f, Number(settings && settings.goal_fat) || 65],
    ['c', totals.c, Number(settings && settings.goal_carbs) || 250],
  ];
  for (const [key, value, target] of macroProgress) {
    const percent = Math.round((value / target) * 100);
    const percentEl = document.getElementById(`${key}Percent`);
    const barEl = document.getElementById(`${key}Bar`);
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) barEl.style.width = `${Math.min(100, percent)}%`;
  }

  const left = goal - totals.kcal;
  const leftEl = document.getElementById('kcalLeft');
  leftEl.classList.toggle('over', left < 0);
  leftEl.textContent = left >= 0
    ? `Осталось ${round(left)} ккал`
    : `Превышено на ${round(-left)} ккал`;
}

function renderExtraMetrics(weightObj, stepsObj) {
  const row = document.getElementById('extraMetricsRow');
  const weightWrap = document.getElementById('extraWeightWrap');
  const weightVal = document.getElementById('extraWeightVal');
  const divider = document.getElementById('extraDivider');
  const stepsWrap = document.getElementById('extraStepsWrap');
  const stepsVal = document.getElementById('extraStepsVal');

  if (row) row.hidden = false;
  if (weightWrap) weightWrap.hidden = false;
  if (stepsWrap) stepsWrap.hidden = false;
  if (divider) divider.hidden = false;

  const hasWeight = weightObj && weightObj.weight != null;
  if (weightVal) {
    if (hasWeight) {
      weightVal.textContent = `${round(weightObj.weight)} кг`;
      weightVal.classList.remove('extra-val-muted');
    } else {
      weightVal.textContent = 'не указан';
      weightVal.classList.add('extra-val-muted');
    }
  }

  const hasSteps = stepsObj && stepsObj.steps != null && stepsObj.steps > 0;
  if (stepsVal) {
    if (hasSteps) {
      stepsVal.textContent = formatNum(stepsObj.steps);
      stepsVal.classList.remove('extra-val-muted');
    } else {
      stepsVal.textContent = '0';
      stepsVal.classList.add('extra-val-muted');
    }
  }
}

function renderMeals(entries) {
  const container = document.getElementById('mealsList');
  container.innerHTML = '';

  const badge = document.getElementById('mealsCountBadge');
  if (badge) badge.textContent = entries.length;

  for (const meal of MEALS) {
    const mealEntries = entries.filter((e) => e.meal === meal.key);
    const kcal = mealEntries.reduce((s, e) => s + (Number(e.calories) || 0), 0);

    const section = document.createElement('div');
    section.className = 'meal-section';

    const title = document.createElement('div');
    title.className = 'meal-title';
    title.innerHTML = `<span>${meal.label} <span class="meal-kcal">${kcal ? round(kcal) + ' ккал' : ''}</span></span>`;
    section.appendChild(title);

    if (mealEntries.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Ничего не записано';
      section.appendChild(hint);
    } else {
      for (const e of mealEntries) {
        section.appendChild(renderEntryRow(e));
      }
    }
    container.appendChild(section);
  }
}

function renderEntryRow(e) {
  const row = document.createElement('div');
  row.className = 'entry entry-clickable';
  const estMarker = e.estimated ? '<span title="Оценка по фото" style="color:var(--muted);font-weight:bold;">≈ </span>' : '';
  const sub = [e.grams ? `${round(e.grams)} г` : null, `Б${round(e.protein)} Ж${round(e.fat)} У${round(e.carbs)}`]
    .filter(Boolean)
    .join(' · ');

  row.innerHTML = `
    <div class="entry-name">
      ${escapeHtml(e.name)}
      <div class="entry-sub">${sub}</div>
    </div>
    <div class="entry-kcal">${estMarker}${round(e.calories)}</div>
    <div class="entry-actions">
      <button class="entry-action-btn entry-edit" type="button" title="Изменить">✎</button>
      <button class="entry-action-btn entry-del" type="button" title="Удалить">✕</button>
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

  const delBtn = row.querySelector('.entry-del');
  let delTimer = null;
  delBtn.onclick = async (evt) => {
    evt.stopPropagation();
    if (delBtn.dataset.confirming === 'true') {
      clearTimeout(delTimer);
      await api(`/api/entries/${e.id}`, { method: 'DELETE' });
      loadDay(currentDate);
    } else {
      delBtn.dataset.confirming = 'true';
      delBtn.textContent = 'Точно?';
      delBtn.classList.add('danger');
      delTimer = setTimeout(() => {
        delBtn.dataset.confirming = 'false';
        delBtn.textContent = '✕';
        delBtn.classList.remove('danger');
      }, 2500);
    }
  };

  return row;
}

function applyDayData(data) {
  dayData = data;
  if (data.settings) applySettings(data.settings);
  renderSummary(data.entries || []);
  renderExtraMetrics(data.weight || null, data.steps || null);
  renderMeals(data.entries || []);
}

async function loadDay(date) {
  currentDate = date || currentDate;
  document.getElementById('dateLabel').textContent = fmtDateLabel(currentDate);
  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) todayBtn.hidden = (currentDate === todayStr());
  updateInputPlaceholder();

  const cacheKey = 'day_' + currentDate;
  const cached = getStorage(cacheKey);
  if (cached) applyDayData(cached);

  try {
    const fresh = await api(`/api/day?date=${currentDate}`);
    setStorage(cacheKey, fresh);
    applyDayData(fresh);
  } catch (err) {
    console.error('Failed to load day data:', err);
  }

  loadChatMessages(currentDate);
}

// --------------------------------------------------------------------------
// Collapsible Dynamics Chart (14 days)
// --------------------------------------------------------------------------

function toggleDynamics() {
  const drawer = document.getElementById('dynamicsDrawer');
  const icon = document.getElementById('dynamicsExpandIcon');
  const isHidden = drawer.hidden;
  drawer.hidden = !isHidden;
  icon.classList.toggle('open', isHidden);

  if (isHidden) {
    renderDynamicsChart();
  }
}

async function renderDynamicsChart() {
  const svg = document.getElementById('dynamicsChart');
  svg.innerHTML = '';

  let hist = historyData;
  if (!hist || hist.length === 0) {
    try {
      hist = await api('/api/history');
      historyData = hist;
    } catch {
      hist = [];
    }
  }

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(toDateStr(d));
  }

  const histMap = new Map();
  for (const h of hist) histMap.set(h.date, h);

  const goal = Number(settings && settings.goal_calories) || 2000;
  const chartData = days.map((date) => {
    const item = histMap.get(date);
    return {
      date,
      calories: item ? item.calories : 0,
      goal: item ? item.goal_calories : goal,
    };
  });

  const maxKcal = Math.max(goal * 1.25, ...chartData.map((d) => d.calories));
  const W = 320, H = 80, PAD_TOP = 8, PAD_BTM = 16, PAD_X = 6;
  const chartH = H - PAD_TOP - PAD_BTM;
  const numBars = chartData.length;
  const slotW = (W - PAD_X * 2) / numBars;
  const barW = Math.max(8, slotW - 6);
  const ns = 'http://www.w3.org/2000/svg';

  // Goal line
  const goalY = PAD_TOP + chartH * (1 - goal / maxKcal);
  const goalLine = document.createElementNS(ns, 'line');
  goalLine.setAttribute('class', 'goal-line');
  goalLine.setAttribute('x1', PAD_X);
  goalLine.setAttribute('x2', W - PAD_X);
  goalLine.setAttribute('y1', goalY);
  goalLine.setAttribute('y2', goalY);
  goalLine.setAttribute('stroke', 'var(--muted)');
  goalLine.setAttribute('stroke-dasharray', '3 3');
  goalLine.setAttribute('stroke-opacity', '0.4');
  svg.appendChild(goalLine);

  chartData.forEach((d, i) => {
    const x = PAD_X + i * slotW + (slotW - barW) / 2;
    const barH = d.calories > 0 ? Math.max(4, (d.calories / maxKcal) * chartH) : 0;
    const y = PAD_TOP + chartH - barH;

    // Background track slot
    const bgSlot = document.createElementNS(ns, 'rect');
    bgSlot.setAttribute('fill', 'var(--border)');
    bgSlot.setAttribute('x', x);
    bgSlot.setAttribute('y', PAD_TOP);
    bgSlot.setAttribute('width', barW);
    bgSlot.setAttribute('height', chartH);
    bgSlot.setAttribute('rx', 3);
    bgSlot.setAttribute('opacity', '0.3');
    svg.appendChild(bgSlot);

    if (barH > 0) {
      const rect = document.createElementNS(ns, 'rect');
      const isExceeded = d.calories > d.goal;
      rect.setAttribute('fill', isExceeded ? '#ef4444' : 'var(--accent)');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', barH);
      rect.setAttribute('rx', 3);

      const title = document.createElementNS(ns, 'title');
      title.textContent = `${d.date}: ${round(d.calories)} ккал (цель ${d.goal})`;
      rect.appendChild(title);

      rect.style.cursor = 'pointer';
      rect.onclick = () => {
        currentDate = d.date;
        setView('day');
      };
      svg.appendChild(rect);
    }

    if (i % 2 === 1 || i === numBars - 1) {
      const dt = new Date(d.date + 'T00:00:00');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('class', 'chart-label');
      text.setAttribute('x', x + barW / 2);
      text.setAttribute('y', H - 2);
      text.setAttribute('font-size', '9');
      text.setAttribute('fill', 'var(--muted)');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = dt.getDate();
      svg.appendChild(text);
    }
  });
}

// --------------------------------------------------------------------------
// Chat & AI Assistant
// --------------------------------------------------------------------------

async function loadChatMessages(date) {
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  try {
    const msgs = await api(`/api/chat-messages?date=${date}`);
    if (msgs.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'chat-status';
      hint.classList.add('chat-empty-state');
      hint.innerHTML = '<strong>Что вы сегодня ели?</strong><span>Напишите сообщением или добавьте фото — запись сразу появится в журнале.</span>';
      container.appendChild(hint);
      return;
    }
    for (const msg of msgs) {
      container.appendChild(renderSavedChatMessage(msg));
    }
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Failed to load chat messages:', err);
  }
}

function renderSavedChatMessage(msg) {
  const row = document.createElement('div');
  row.className = `chat-msg ${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (msg.role === 'user') {
    bubble.textContent = msg.text || '';
    row.appendChild(bubble);
    return row;
  }

  // Assistant message
  const meta = typeof msg.meta === 'string' ? JSON.parse(msg.meta || '{}') : (msg.meta || {});
  
  if (msg.text) {
    const textEl = document.createElement('div');
    textEl.textContent = msg.text;
    bubble.appendChild(textEl);
  }

  // If receipt card was executed
  if (meta.createdEntries && meta.createdEntries.length > 0) {
    bubble.appendChild(renderReceiptCard(meta.createdEntries));
  } else if (meta.items && meta.items.length > 0 && !meta.needs_confirmation) {
    bubble.appendChild(renderReceiptCard(meta.items));
  }

  // If confirmation card
  if (meta.needs_confirmation) {
    bubble.appendChild(renderConfirmationCard(meta));
  }

  row.appendChild(bubble);
  return row;
}

function renderReceiptCard(items) {
  const card = document.createElement('div');
  card.className = 'receipt-card';

  const saved = items.some((item) => item.id);
  if (saved) {
    const savedStatus = document.createElement('div');
    savedStatus.className = 'receipt-saved-status';
    savedStatus.innerHTML = '<i class="ph-bold ph-check-circle" aria-hidden="true"></i><span>Добавлено в журнал</span>';
    card.appendChild(savedStatus);
  }

  for (const item of items) {
    const itemRow = document.createElement('div');
    itemRow.className = 'receipt-item-row';
    const est = item.estimated ? '≈ ' : '';
    const sub = [item.grams ? `${round(item.grams)} г` : null, `Б${round(item.protein)} Ж${round(item.fat)} У${round(item.carbs)}`]
      .filter(Boolean)
      .join(' · ');

    let badgeText = '';
    if (item.source === 'chat_photo' || item.estimated) {
      badgeText = 'По фото · оценка';
    } else if (item.source === 'chat_voice') {
      badgeText = 'Голосовой ввод';
    } else if (item.source === 'chat_text') {
      badgeText = 'Текстовый ввод';
    }

    itemRow.innerHTML = `
      <div class="receipt-item-info">
        ${badgeText ? `<div class="receipt-badge">${badgeText}</div>` : ''}
        <div class="receipt-item-name">${escapeHtml(item.name)}</div>
        <div class="receipt-item-sub">${sub}</div>
      </div>
      <div class="receipt-item-kcal">${est}${round(item.calories)} ккал</div>
    `;
    card.appendChild(itemRow);

    // Actions if item has id in DB
    if (item.id) {
      const actRow = document.createElement('div');
      actRow.className = 'receipt-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'card-action-btn';
      editBtn.type = 'button';
      editBtn.innerHTML = '<i class="ph ph-pencil-simple" aria-hidden="true"></i> Исправить';
      editBtn.onclick = () => openEditEntrySheet(item);
      actRow.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'card-action-btn danger';
      delBtn.type = 'button';
      delBtn.innerHTML = '<i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Отменить';
      let delTimer = null;
      delBtn.onclick = async () => {
        if (delBtn.dataset.confirming === 'true') {
          clearTimeout(delTimer);
          await api(`/api/entries/${item.id}`, { method: 'DELETE' });
          loadDay(currentDate);
          card.remove();
        } else {
          delBtn.dataset.confirming = 'true';
          delBtn.textContent = 'Точно?';
          delTimer = setTimeout(() => {
            delBtn.dataset.confirming = 'false';
            delBtn.innerHTML = '<i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Отменить';
          }, 2500);
        }
      };
      actRow.appendChild(delBtn);

      card.appendChild(actRow);
    }
  }

  return card;
}

function renderConfirmationCard(meta) {
  const card = document.createElement('div');
  card.className = 'confirm-card';

  let title = 'Требуется подтверждение';
  let desc = meta.reply_text || 'Подтвердите действие:';

  if (meta.intent === 'set_goal' && meta.goal_change) {
    title = '🎯 Изменение дневной цели';
    const fieldMap = {
      goal_calories: 'Норма калорий',
      goal_protein: 'Норма белков',
      goal_fat: 'Норма жиров',
      goal_carbs: 'Норма углеводов',
      goal_steps: 'Норма шагов',
    };
    const name = fieldMap[meta.goal_change.field] || meta.goal_change.field;
    desc = `Установить ${name}: ${meta.goal_change.value}?`;
  } else if (meta.intent === 'log_weight') {
    title = '⚖️ Запись веса';
    desc = `Записать вес ${meta.weight} кг на ${fmtShortDate(meta.date || currentDate)}?`;
  } else if (meta.intent === 'log_steps') {
    title = '👟 Запись шагов';
    desc = `Записать ${formatNum(meta.steps)} шагов на ${fmtShortDate(meta.date || currentDate)}?`;
  } else if (meta.intent === 'log_meal' && meta.items && meta.items.length > 0) {
    title = `🍽 Запись на ${fmtShortDate(meta.date || currentDate)}`;
    const names = meta.items.map((it) => it.name).join(', ');
    desc = `Добавить в дневник: ${names}?`;
  }

  card.innerHTML = `
    <div class="confirm-card-title">${title}</div>
    <div class="confirm-card-desc">${desc}</div>
    <div class="confirm-card-actions">
      <button class="confirm-btn-yes" type="button">Подтвердить</button>
      <button class="confirm-btn-clarify" type="button">Уточнить</button>
    </div>
  `;

  card.querySelector('.confirm-btn-yes').onclick = async () => {
    try {
      card.querySelector('.confirm-btn-yes').disabled = true;
      card.querySelector('.confirm-btn-yes').textContent = 'Применяю…';
      const action = meta.intent;
      const payload = meta.intent === 'set_goal'
        ? meta.goal_change
        : meta.intent === 'log_weight'
        ? { weight: meta.weight }
        : meta.intent === 'log_steps'
        ? { steps: meta.steps }
        : { items: meta.items, meal_type: meta.meal_type };

      await api('/api/ai/confirm', {
        method: 'POST',
        body: JSON.stringify({ action, date: meta.date || currentDate, payload }),
      });

      card.innerHTML = '<div class="chat-status" style="color:#22c55e;font-weight:600;">✓ Успешно подтверждено и записано!</div>';
      loadDay(currentDate);
    } catch (err) {
      alert('Ошибка подтверждения: ' + err.message);
    }
  };

  card.querySelector('.confirm-btn-clarify').onclick = () => {
    const input = document.getElementById('chatText');
    input.focus();
    if (meta.intent === 'set_goal') {
      input.value = 'Какую норму калорий или БЖУ установить? ';
    } else {
      input.value = 'Хочу уточнить: ';
    }
  };

  return card;
}

async function sendChatMessage() {
  if (chatSending) return;
  const textEl = document.getElementById('chatText');
  const text = textEl.value.trim();
  const photos = [...chatPhotoFiles];
  if (!text && photos.length === 0) return;

  const container = document.getElementById('chatMessages');

  // Add user bubble
  const userRow = document.createElement('div');
  userRow.className = 'chat-msg user';
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble';

  if (photos.length > 0) {
    const photosWrap = document.createElement('div');
    photosWrap.className = 'chat-bubble-photos';
    for (const p of photos) {
      const img = document.createElement('img');
      img.className = 'chat-bubble-photo';
      img.src = URL.createObjectURL(p);
      photosWrap.appendChild(img);
    }
    userBubble.appendChild(photosWrap);
  }
  if (text) {
    const t = document.createElement('div');
    t.textContent = text;
    userBubble.appendChild(t);
  }
  userRow.appendChild(userBubble);
  container.appendChild(userRow);

  // Add assistant pending bubble
  const astRow = document.createElement('div');
  astRow.className = 'chat-msg assistant';
  const astBubble = document.createElement('div');
  astBubble.className = 'chat-bubble';
  astBubble.innerHTML = '<div class="chat-status">Разбираю…</div>';
  astRow.appendChild(astBubble);
  container.appendChild(astRow);
  container.scrollTop = container.scrollHeight;

  // Clear inputs
  textEl.value = '';
  clearChatPhotos();
  chatSending = true;

  const sendBtn = document.getElementById('chatSend');
  sendBtn.disabled = true;

  try {
    const form = new FormData();
    form.append('text', text);
    form.append('date', currentDate);
    form.append('meal', selectedMealContext || guessMealByTime());
    form.append('is_voice', isRecordingVoice ? 'true' : 'false');
    for (const p of photos) {
      form.append('images', p);
    }

    const res = await fetch('/api/ai/chat', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка распознавания');

    astBubble.innerHTML = '';

    if (data.clarification_question) {
      const q = document.createElement('div');
      q.textContent = data.clarification_question;
      astBubble.appendChild(q);
    } else if (data.reply_text) {
      const rep = document.createElement('div');
      rep.textContent = data.reply_text;
      astBubble.appendChild(rep);
    }

    if (data.createdEntries && data.createdEntries.length > 0) {
      astBubble.appendChild(renderReceiptCard(data.createdEntries));
    }

    if (data.needs_confirmation) {
      astBubble.appendChild(renderConfirmationCard(data));
    }

    // Refresh day data
    loadDay(currentDate);
  } catch (err) {
    astBubble.innerHTML = `<div class="chat-status" style="color:var(--danger)">Не удалось обработать: ${escapeHtml(err.message)}</div>`;
  } finally {
    chatSending = false;
    sendBtn.disabled = false;
    container.scrollTop = container.scrollHeight;
  }
}

// --------------------------------------------------------------------------
// Photos in Chat & Drag and Drop
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Voice Input (Web Speech API)
// --------------------------------------------------------------------------

function setupVoiceInput() {
  const btn = document.getElementById('chatVoiceBtn');
  if (!btn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    btn.onclick = () => {
      alert('Голосовой ввод не поддерживается в этом браузере. Вы можете использовать обычный ввод текста.');
    };
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'ru-RU';
  speechRecognition.continuous = false;
  speechRecognition.interimResults = true;

  speechRecognition.onstart = () => {
    isRecordingVoice = true;
    btn.classList.add('recording');
    btn.title = 'Идёт запись речи… нажмите для остановки';
  };

  speechRecognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }
    const input = document.getElementById('chatText');
    input.value = transcript;
  };

  speechRecognition.onerror = (e) => {
    console.warn('Speech recognition error:', e.error);
    isRecordingVoice = false;
    btn.classList.remove('recording');
    btn.title = 'Голосовой ввод';
  };

  speechRecognition.onend = () => {
    isRecordingVoice = false;
    btn.classList.remove('recording');
    btn.title = 'Голосовой ввод';
  };

  btn.onclick = () => {
    if (isRecordingVoice) {
      speechRecognition.stop();
    } else {
      speechRecognition.start();
    }
  };
}

// --------------------------------------------------------------------------
// Direct Editing Bottom Sheet
// --------------------------------------------------------------------------

function openEditEntrySheet(entry) {
  editingEntry = entry;
  recalcOriginal = {
    grams: Number(entry.grams) || 0,
    calories: Number(entry.calories) || 0,
    protein: Number(entry.protein) || 0,
    fat: Number(entry.fat) || 0,
    carbs: Number(entry.carbs) || 0,
  };

  const mealObj = MEALS.find((m) => m.key === entry.meal);
  const mealName = mealObj ? mealObj.label : 'Приём пищи';
  const timeStr = entry.created_at
    ? new Date(entry.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';
  document.getElementById('editEntrySubtitle').textContent = timeStr ? `${mealName} · ${timeStr}` : mealName;

  document.getElementById('editEntryMeal').value = entry.meal || 'breakfast';
  document.getElementById('editEntryDate').value = entry.date || currentDate;
  document.getElementById('editEntryName').value = entry.name || '';
  document.getElementById('editEntryGrams').value = entry.grams != null ? entry.grams : '';
  document.getElementById('editEntryKcal').value = entry.calories != null ? round(entry.calories) : '';
  document.getElementById('editEntryProtein').value = entry.protein != null ? round(entry.protein) : '';
  document.getElementById('editEntryFat').value = entry.fat != null ? round(entry.fat) : '';
  document.getElementById('editEntryCarbs').value = entry.carbs != null ? round(entry.carbs) : '';

  const autoRecalcEl = document.getElementById('editEntryAutoRecalc');
  if (autoRecalcEl) autoRecalcEl.checked = true;

  const delBtn = document.getElementById('deleteEditEntry');
  delBtn.textContent = 'Удалить';
  delBtn.className = 'danger-ghost-btn';
  delBtn.dataset.confirming = 'false';
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);

  document.getElementById('editEntryOverlay').classList.add('open');
}

function handleEditGramsChange() {
  const autoRecalcEl = document.getElementById('editEntryAutoRecalc');
  if (!autoRecalcEl || !autoRecalcEl.checked) return;
  if (!recalcOriginal || !recalcOriginal.grams || recalcOriginal.grams <= 0) return;

  const newGrams = Number(document.getElementById('editEntryGrams').value) || 0;
  if (newGrams <= 0) return;
  const ratio = newGrams / recalcOriginal.grams;

  document.getElementById('editEntryKcal').value = Math.round(recalcOriginal.calories * ratio);
  document.getElementById('editEntryProtein').value = round(recalcOriginal.protein * ratio);
  document.getElementById('editEntryFat').value = round(recalcOriginal.fat * ratio);
  document.getElementById('editEntryCarbs').value = round(recalcOriginal.carbs * ratio);
}

function disableAutoRecalc() {
  const autoRecalcEl = document.getElementById('editEntryAutoRecalc');
  if (autoRecalcEl) autoRecalcEl.checked = false;
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
      name,
      meal,
      date,
      grams: grams !== '' ? Number(grams) : null,
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      fat: Number(fat) || 0,
      carbs: Number(carbs) || 0,
      source: 'manual_edit',
    }),
  });

  document.getElementById('editEntryOverlay').classList.remove('open');
  editingEntry = null;
  loadDay(currentDate);
}

async function handleDeleteEditEntry() {
  if (!editingEntry) return;
  const delBtn = document.getElementById('deleteEditEntry');

  if (delBtn.dataset.confirming === 'true') {
    if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
    await api(`/api/entries/${editingEntry.id}`, { method: 'DELETE' });
    document.getElementById('editEntryOverlay').classList.remove('open');
    editingEntry = null;
    loadDay(currentDate);
  } else {
    delBtn.dataset.confirming = 'true';
    delBtn.textContent = 'Точно удалить?';
    delBtn.className = 'danger-btn';

    deleteConfirmTimer = setTimeout(() => {
      delBtn.dataset.confirming = 'false';
      delBtn.textContent = 'Удалить';
      delBtn.className = 'danger-ghost-btn';
    }, 3000);
  }
}

// --------------------------------------------------------------------------
// Direct Editing for Weight and Steps
// --------------------------------------------------------------------------

let weightDeleteConfirmTimer = null;
function openEditWeightSheet() {
  const title = document.getElementById('editWeightTitle');
  const input = document.getElementById('editWeightInput');
  const delBtn = document.getElementById('deleteWeightBtn');
  if (title) title.textContent = `Вес за ${fmtDateLabel(currentDate)}`;

  const currentWeight = dayData && dayData.weight && dayData.weight.weight != null
    ? dayData.weight.weight
    : '';
  if (input) input.value = currentWeight;

  if (delBtn) {
    delBtn.hidden = !currentWeight;
    delBtn.textContent = 'Удалить';
    delBtn.className = 'danger-ghost-btn';
    delBtn.dataset.confirming = 'false';
  }
  if (weightDeleteConfirmTimer) clearTimeout(weightDeleteConfirmTimer);

  document.getElementById('editWeightOverlay').classList.add('open');
  if (input) input.focus();
}

async function saveWeightSheet() {
  const input = document.getElementById('editWeightInput');
  const val = Number(input.value);
  if (isNaN(val) || val <= 0) return;

  if (dayData && dayData.weight && dayData.weight.id) {
    await api(`/api/weight/${dayData.weight.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: currentDate, weight: val }),
    });
  } else {
    await api('/api/weight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: currentDate, weight: val }),
    });
  }

  document.getElementById('editWeightOverlay').classList.remove('open');
  loadDay(currentDate);
}

async function deleteWeightSheet() {
  const delBtn = document.getElementById('deleteWeightBtn');
  if (!dayData || !dayData.weight || !dayData.weight.id) return;

  if (delBtn.dataset.confirming === 'true') {
    if (weightDeleteConfirmTimer) clearTimeout(weightDeleteConfirmTimer);
    await api(`/api/weight/${dayData.weight.id}`, { method: 'DELETE' });
    document.getElementById('editWeightOverlay').classList.remove('open');
    loadDay(currentDate);
  } else {
    delBtn.dataset.confirming = 'true';
    delBtn.textContent = 'Точно удалить?';
    delBtn.className = 'danger-btn';
    weightDeleteConfirmTimer = setTimeout(() => {
      delBtn.dataset.confirming = 'false';
      delBtn.textContent = 'Удалить';
      delBtn.className = 'danger-ghost-btn';
    }, 3000);
  }
}

let stepsResetConfirmTimer = null;
function openEditStepsSheet() {
  const title = document.getElementById('editStepsTitle');
  const input = document.getElementById('editStepsInput');
  const resetBtn = document.getElementById('resetStepsBtn');
  if (title) title.textContent = `Шаги за ${fmtDateLabel(currentDate)}`;

  const currentSteps = dayData && dayData.steps && dayData.steps.steps != null
    ? dayData.steps.steps
    : '';
  if (input) input.value = currentSteps;

  if (resetBtn) {
    resetBtn.hidden = !currentSteps;
    resetBtn.textContent = 'Сбросить';
    resetBtn.className = 'danger-ghost-btn';
    resetBtn.dataset.confirming = 'false';
  }
  if (stepsResetConfirmTimer) clearTimeout(stepsResetConfirmTimer);

  document.getElementById('editStepsOverlay').classList.add('open');
  if (input) input.focus();
}

async function saveStepsSheet() {
  const input = document.getElementById('editStepsInput');
  const val = Math.max(0, Math.round(Number(input.value)) || 0);

  await api('/api/steps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: currentDate, steps: val }),
  });

  document.getElementById('editStepsOverlay').classList.remove('open');
  loadDay(currentDate);
}

async function resetStepsSheet() {
  const resetBtn = document.getElementById('resetStepsBtn');
  if (!dayData || !dayData.steps || !dayData.steps.id) return;

  if (resetBtn.dataset.confirming === 'true') {
    if (stepsResetConfirmTimer) clearTimeout(stepsResetConfirmTimer);
    await api(`/api/steps/${dayData.steps.id}`, { method: 'DELETE' });
    document.getElementById('editStepsOverlay').classList.remove('open');
    loadDay(currentDate);
  } else {
    resetBtn.dataset.confirming = 'true';
    resetBtn.textContent = 'Точно сбросить?';
    resetBtn.className = 'danger-btn';
    stepsResetConfirmTimer = setTimeout(() => {
      resetBtn.dataset.confirming = 'false';
      resetBtn.textContent = 'Сбросить';
      resetBtn.className = 'danger-ghost-btn';
    }, 3000);
  }
}

// --------------------------------------------------------------------------
// History View (List by Months & Calendar)
// --------------------------------------------------------------------------

async function loadHistory() {
  try {
    historyData = await api('/api/history');
    if (historyTab === 'calendar') {
      renderCalendar();
    } else {
      renderHistoryList();
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function renderHistoryList() {
  const container = document.getElementById('historyListContainer');
  container.innerHTML = '';

  if (historyData.length === 0) {
    container.innerHTML = '<div class="empty-hint">История пока пуста</div>';
    return;
  }

  // Group by month YYYY-MM
  const groups = new Map();
  for (const item of historyData) {
    const monthKey = item.date.slice(0, 7);
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(item);
  }

  for (const [monthKey, items] of groups.entries()) {
    const groupEl = document.createElement('div');
    groupEl.className = 'history-month-group';

    const firstDate = new Date(monthKey + '-01T00:00:00');
    const monthTitle = document.createElement('div');
    monthTitle.className = 'history-month-title';
    monthTitle.textContent = fmtMonthYear(firstDate);
    groupEl.appendChild(monthTitle);

    for (const d of items) {
      const row = document.createElement('div');
      row.className = `history-day-row ${d.status}`;

      const weekday = fmtWeekday(d.date);
      const dayNum = new Date(d.date + 'T00:00:00').getDate();
      const dateLabel = `${weekday}, ${dayNum}`;

      let metaParts = [];
      if (d.weight != null) metaParts.push(`⚖️ ${round(d.weight)} кг`);
      if (d.steps != null && d.steps > 0) metaParts.push(`👟 ${formatNum(d.steps)} шагов`);
      const metaStr = metaParts.join(' · ');

      const goal = d.goal_calories || 2000;
      const pct = d.calories > 0 ? Math.min(100, Math.round((d.calories / goal) * 100)) : 0;
      const barClass = d.status === 'exceeded' ? 'exceeded' : 'in-goal';

      let deltaStr = '—';
      if (d.status === 'in_goal') {
        deltaStr = `${d.delta > 0 ? '+' : ''}${round(d.delta)} ккал`;
      } else if (d.status === 'exceeded') {
        deltaStr = `+${round(d.delta)} ккал`;
      }

      row.innerHTML = `
        <div class="history-day-left">
          <div class="history-day-date">${dateLabel}</div>
          ${d.calories > 0 ? `<div class="history-day-bar-wrap"><div class="history-day-bar ${barClass}" style="width:${pct}%"></div></div>` : ''}
          ${metaStr ? `<div class="history-day-meta">${metaStr}</div>` : ''}
        </div>
        <div class="history-day-right">
          <div class="history-day-kcal">${d.calories > 0 ? round(d.calories) + ' ккал' : '—'}</div>
          <div class="history-day-delta ${d.status}">${deltaStr}</div>
        </div>
      `;

      row.onclick = () => {
        currentDate = d.date;
        setView('day');
      };

      groupEl.appendChild(row);
    }

    container.appendChild(groupEl);
  }
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const y = calendarMonth.getFullYear();
  const m = calendarMonth.getMonth();
  document.getElementById('calMonthTitle').textContent = fmtMonthYear(calendarMonth);

  const histMap = new Map();
  for (const h of historyData) histMap.set(h.date, h);

  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);

  // Monday-based offset (0 = Mon, 6 = Sun)
  let startDay = firstDay.getDay() - 1;
  if (startDay < 0) startDay = 6;

  // Empty pads
  for (let i = 0; i < startDay; i++) {
    const pad = document.createElement('div');
    pad.className = 'calendar-day-cell empty-pad';
    grid.appendChild(pad);
  }

  const curToday = todayStr();

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hist = histMap.get(dStr);
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell';
    if (dStr === curToday) cell.classList.add('today');

    const numSpan = document.createElement('span');
    numSpan.textContent = day;
    cell.appendChild(numSpan);

    const status = hist ? hist.status : 'empty';
    const dot = document.createElement('span');
    dot.className = `calendar-status-dot ${status}`;
    cell.appendChild(dot);

    cell.onclick = () => {
      currentDate = dStr;
      setView('day');
    };

    grid.appendChild(cell);
  }
}

// --------------------------------------------------------------------------
// Settings & Products Modals
// --------------------------------------------------------------------------

function openSettingsSheet() {
  if (settings) {
    document.getElementById('sViewKcal').textContent = formatNum(settings.goal_calories || 2000);
    document.getElementById('sViewProtein').textContent = settings.goal_protein || 120;
    document.getElementById('sViewFat').textContent = settings.goal_fat || 65;
    document.getElementById('sViewCarbs').textContent = settings.goal_carbs || 250;
    document.getElementById('sViewSteps').textContent = formatNum(settings.goal_steps || 10000);

    const providerLabel = settings.ai_provider;
    document.getElementById('aiProviderInfo').textContent = settings.ai_configured
      ? `Провайдер: ${providerLabel} (API-ключ активен)`
      : `Провайдер: ${providerLabel} (ключ не найден в .env)`;
  }
  document.getElementById('settingsOverlay').classList.add('open');
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

    const delBtn = row.querySelector('.entry-del');
    let delTimer = null;
    delBtn.onclick = async (evt) => {
      evt.stopPropagation();
      if (delBtn.dataset.confirming === 'true') {
        clearTimeout(delTimer);
        await api(`/api/products/${p.id}`, { method: 'DELETE' });
        loadProducts(document.getElementById('productsSearch').value);
      } else {
        delBtn.dataset.confirming = 'true';
        delBtn.textContent = 'Точно?';
        delTimer = setTimeout(() => {
          delBtn.dataset.confirming = 'false';
          delBtn.textContent = '✕';
        }, 2500);
      }
    };

    container.appendChild(row);
  }
}

function openProductsSheet() {
  loadProducts();
  document.getElementById('productsOverlay').classList.add('open');
}

function openEditProductSheet(p) {
  editingProduct = p;
  document.getElementById('pName').value = p.name || '';
  document.getElementById('pKcal').value = p.calories != null ? round(p.calories) : '';
  document.getElementById('pProtein').value = p.protein != null ? round(p.protein) : '';
  document.getElementById('pFat').value = p.fat != null ? round(p.fat) : '';
  document.getElementById('pCarbs').value = p.carbs != null ? round(p.carbs) : '';
  document.getElementById('editProductOverlay').classList.add('open');
}

async function saveProductEntry() {
  if (!editingProduct) return;
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

  await api(`/api/products/${editingProduct.id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  document.getElementById('editProductOverlay').classList.remove('open');
  editingProduct = null;
  loadProducts(document.getElementById('productsSearch').value);
}

async function deleteProductEntry() {
  if (!editingProduct) return;
  await api(`/api/products/${editingProduct.id}`, { method: 'DELETE' });
  document.getElementById('editProductOverlay').classList.remove('open');
  editingProduct = null;
  loadProducts(document.getElementById('productsSearch').value);
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxOverlay').classList.add('open');
}

// --------------------------------------------------------------------------
// Initialization & Event Listeners
// --------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const bindKeyboardActivation = (element, action) => {
    if (!element) return;
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        action();
      }
    });
  };

  // Brand title
  const goHome = () => {
    currentDate = todayStr();
    setView('day');
  };
  document.getElementById('brandBtn').onclick = goHome;
  bindKeyboardActivation(document.getElementById('brandBtn'), goHome);

  // Day navigation
  document.getElementById('prevDay').onclick = () => {
    loadDay(addDays(currentDate, -1));
  };
  document.getElementById('nextDay').onclick = () => {
    loadDay(addDays(currentDate, 1));
  };
  document.getElementById('todayBtn').onclick = () => {
    loadDay(todayStr());
  };

  // History navigation
  document.getElementById('toggleHistoryBtn').onclick = () => {
    setView(currentView === 'history' ? 'day' : 'history');
  };
  document.getElementById('backToDayBtn').onclick = () => {
    setView('day');
  };
  document.getElementById('histListTabBtn').onclick = () => setHistoryTab('list');
  document.getElementById('histCalTabBtn').onclick = () => setHistoryTab('calendar');
  document.getElementById('calPrevMonth').onclick = () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  };
  document.getElementById('calNextMonth').onclick = () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  };

  // Day tabs
  document.getElementById('tabBtnChat').onclick = () => setDayTab('chat');
  document.getElementById('tabBtnMeals').onclick = () => setDayTab('meals');

  // Keep bottom padding in sync with the sticky bar's real height
  // (it grows when the backlog banner or photo previews appear, so a
  // fixed 90px padding lets it cover the last chat messages).
  const stickyBar = document.getElementById('stickyBottomBar');
  if (stickyBar && window.ResizeObserver) {
    const syncStickyBarHeight = () => {
      document.documentElement.style.setProperty('--sticky-bar-height', `${stickyBar.offsetHeight}px`);
    };
    new ResizeObserver(syncStickyBarHeight).observe(stickyBar);
    syncStickyBarHeight();
  }

  // Dynamics toggle button
  const toggleDynBtn = document.getElementById('toggleDynamicsBtn');
  if (toggleDynBtn) {
    toggleDynBtn.onclick = (e) => {
      e.stopPropagation();
      toggleDynamics();
    };
  }

  // Meal context chips choose where a recognized meal is logged without
  // polluting the message text with a technical prefix.
  const mealChips = [...document.querySelectorAll('.chip-btn[data-meal]')];
  const activateMealChip = (meal) => {
    selectedMealContext = meal;
    mealChips.forEach((chip) => {
      const active = chip.dataset.meal === meal;
      chip.classList.toggle('selected', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  };
  activateMealChip(guessMealByTime());
  mealChips.forEach((btn) => {
    btn.onclick = () => {
      activateMealChip(btn.dataset.meal);
      document.getElementById('chatText').focus();
    };
  });

  // Metric shortcuts still seed an explicit command for the assistant.
  document.querySelectorAll('.chip-btn[data-fill]').forEach((btn) => {
    btn.onclick = () => {
      const input = document.getElementById('chatText');
      input.value = btn.getAttribute('data-fill');
      input.focus();
    };
  });
  document.getElementById('chipPhotoDish').onclick = () => {
    document.getElementById('chatPhotoInput').click();
  };
  const chipScale = document.getElementById('chipPhotoScale');
  if (chipScale) {
    chipScale.onclick = () => {
      document.getElementById('chatPhotoInput').click();
    };
  }

  // Date picker jump from date label
  const dateLabelEl = document.getElementById('dateLabel');
  const datePickerEl = document.getElementById('datePickerInput');
  if (dateLabelEl && datePickerEl) {
    dateLabelEl.onclick = () => {
      if (typeof datePickerEl.showPicker === 'function') {
        datePickerEl.showPicker();
      } else {
        datePickerEl.click();
      }
    };
    datePickerEl.onchange = (e) => {
      if (e.target.value) {
        currentDate = e.target.value;
        loadDay(currentDate);
      }
    };
  }

  // Extra metrics (weight & steps direct edit)
  const extraWeightWrap = document.getElementById('extraWeightWrap');
  if (extraWeightWrap) {
    extraWeightWrap.onclick = openEditWeightSheet;
    bindKeyboardActivation(extraWeightWrap, openEditWeightSheet);
  }
  const extraStepsWrap = document.getElementById('extraStepsWrap');
  if (extraStepsWrap) {
    extraStepsWrap.onclick = openEditStepsSheet;
    bindKeyboardActivation(extraStepsWrap, openEditStepsSheet);
  }

  // Weight sheet
  const closeEditWeight = document.getElementById('closeEditWeight');
  if (closeEditWeight) closeEditWeight.onclick = () => document.getElementById('editWeightOverlay').classList.remove('open');
  const editWeightOverlay = document.getElementById('editWeightOverlay');
  if (editWeightOverlay) {
    editWeightOverlay.onclick = (e) => {
      if (e.target.id === 'editWeightOverlay') e.currentTarget.classList.remove('open');
    };
  }
  const saveWeightBtn = document.getElementById('saveWeightBtn');
  if (saveWeightBtn) saveWeightBtn.onclick = saveWeightSheet;
  const deleteWeightBtn = document.getElementById('deleteWeightBtn');
  if (deleteWeightBtn) deleteWeightBtn.onclick = deleteWeightSheet;

  // Steps sheet
  const closeEditSteps = document.getElementById('closeEditSteps');
  if (closeEditSteps) closeEditSteps.onclick = () => document.getElementById('editStepsOverlay').classList.remove('open');
  const editStepsOverlay = document.getElementById('editStepsOverlay');
  if (editStepsOverlay) {
    editStepsOverlay.onclick = (e) => {
      if (e.target.id === 'editStepsOverlay') e.currentTarget.classList.remove('open');
    };
  }
  const saveStepsBtn = document.getElementById('saveStepsBtn');
  if (saveStepsBtn) saveStepsBtn.onclick = saveStepsSheet;
  const resetStepsBtn = document.getElementById('resetStepsBtn');
  if (resetStepsBtn) resetStepsBtn.onclick = resetStepsSheet;

  // Chat send & inputs
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

  // Direct editing modal
  document.getElementById('closeEditEntry').onclick = () => document.getElementById('editEntryOverlay').classList.remove('open');
  document.getElementById('editEntryOverlay').onclick = (e) => {
    if (e.target.id === 'editEntryOverlay') e.currentTarget.classList.remove('open');
  };
  document.getElementById('saveEditEntry').onclick = saveEditEntry;
  document.getElementById('deleteEditEntry').onclick = handleDeleteEditEntry;
  document.getElementById('editEntryGrams').addEventListener('input', handleEditGramsChange);
  
  // Disable auto recalc when editing macros directly
  ['editEntryKcal', 'editEntryProtein', 'editEntryFat', 'editEntryCarbs'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', disableAutoRecalc);
  });
  const autoRecalcCheck = document.getElementById('editEntryAutoRecalc');
  if (autoRecalcCheck) {
    autoRecalcCheck.addEventListener('change', () => {
      if (autoRecalcCheck.checked) handleEditGramsChange();
    });
  }

  // Settings
  document.getElementById('openSettings').onclick = openSettingsSheet;
  document.getElementById('closeSettings').onclick = () => document.getElementById('settingsOverlay').classList.remove('open');
  document.getElementById('settingsOverlay').onclick = (e) => {
    if (e.target.id === 'settingsOverlay') e.currentTarget.classList.remove('open');
  };
  document.getElementById('openProductsFromSettings').onclick = () => {
    document.getElementById('settingsOverlay').classList.remove('open');
    openProductsSheet();
  };

  // Products catalog
  document.getElementById('closeProductsSheet').onclick = () => document.getElementById('productsOverlay').classList.remove('open');
  document.getElementById('productsOverlay').onclick = (e) => {
    if (e.target.id === 'productsOverlay') e.currentTarget.classList.remove('open');
  };
  document.getElementById('productsSearch').addEventListener('input', (e) => loadProducts(e.target.value));

  // Edit product modal
  document.getElementById('closeEditProduct').onclick = () => document.getElementById('editProductOverlay').classList.remove('open');
  document.getElementById('editProductOverlay').onclick = (e) => {
    if (e.target.id === 'editProductOverlay') e.currentTarget.classList.remove('open');
  };
  document.getElementById('saveProduct').onclick = saveProductEntry;
  document.getElementById('deleteProductBtn').onclick = deleteProductEntry;

  // Lightbox
  document.getElementById('lightboxOverlay').onclick = () => document.getElementById('lightboxOverlay').classList.remove('open');

  // Voice & Drag and Drop
  setupVoiceInput();
  setupChatDragAndDrop();

  // Load initial settings and day
  loadSettings();
  loadDay(currentDate);
});
