// ============================================================
// 神睡眠トラッカー PWA — Main Application
// ============================================================

const DB_KEY = 'sleep_tracker_data';
const SLEEP_KEY = 'sleep_tracker_pending';
const PROFILE_KEY = 'sleep_tracker_profile';

// ---- Data Layer ----
// Data format: records[dateKey] = [ { bedtime, waketime, duration, rating, type }, ... ]

function loadRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(DB_KEY)) || {};
    // Migrate old single-object format to array format
    for (const key of Object.keys(raw)) {
      if (!Array.isArray(raw[key])) {
        raw[key] = [raw[key]];
      }
    }
    return raw;
  } catch { return {}; }
}

function saveRecords(records) {
  localStorage.setItem(DB_KEY, JSON.stringify(records));
}

function getPendingSleep() {
  try {
    return JSON.parse(localStorage.getItem(SLEEP_KEY));
  } catch { return null; }
}

function setPendingSleep(data) {
  if (data) {
    localStorage.setItem(SLEEP_KEY, JSON.stringify(data));
  } else {
    localStorage.removeItem(SLEEP_KEY);
  }
}

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayKey() {
  return dateKey(new Date());
}

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}時間${m}分`;
}

function formatDurationShort(ms) {
  const h = (ms / 3600000).toFixed(1);
  return `${h}h`;
}

function ratingColor(r) {
  if (r >= 8) return '#4ecdc4';
  if (r >= 5) return '#ffe66d';
  if (r >= 3) return '#ff9f43';
  return '#ff6b6b';
}

function ratingClass(r) {
  if (r >= 8) return 'good';
  if (r >= 5) return 'ok';
  return 'bad';
}

// Classify sleep type: night sleep vs nap
function classifySleep(bedtimeISO, durationMs) {
  const hour = new Date(bedtimeISO).getHours();
  const isNightHour = hour >= 18 || hour <= 5;
  const isLong = durationMs >= 3 * 3600000; // 3 hours+
  if (isNightHour && isLong) return 'night';
  return 'nap';
}

function typeLabel(type) {
  return type === 'night' ? '🌙 夜の睡眠' : '💤 仮眠';
}

// ---- Navigation ----

const views = document.querySelectorAll('.view');
const navBtns = document.querySelectorAll('.nav-btn');

function showView(name) {
  views.forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'home') updateHomeView();
  if (name === 'history') renderHistory();
  if (name === 'calendar') renderCalendar();
  if (name === 'report') renderReport();
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ---- Home View ----

let wakeTimeISO = null;

function updateHomeView() {
  const today = todayKey();
  const records = loadRecords();
  const pending = getPendingSleep();
  const todaySessions = records[today] || [];

  document.getElementById('today-date').textContent = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  const sleepSection = document.getElementById('sleep-section');
  const wakeButtonSection = document.getElementById('wake-button-section');
  const ratingSection = document.getElementById('rating-section');
  const todaySessionsDiv = document.getElementById('today-sessions');

  // Hide interactive sections
  sleepSection.classList.add('hidden');
  wakeButtonSection.classList.add('hidden');
  ratingSection.classList.add('hidden');

  if (pending) {
    // Currently sleeping — show wake button
    wakeButtonSection.classList.remove('hidden');
    const bedtime = new Date(pending.bedtime);
    const now = new Date();
    const duration = now - bedtime;
    document.getElementById('wake-bedtime').textContent = formatTime(pending.bedtime);
    document.getElementById('wake-duration').textContent = formatDuration(duration);
  } else {
    // Show sleep button (always available for new session)
    sleepSection.classList.remove('hidden');
    document.getElementById('sleep-status').classList.remove('hidden');
    document.getElementById('sleeping-status').classList.add('hidden');
  }

  // Show today's sessions
  if (todaySessions.length > 0) {
    todaySessionsDiv.classList.remove('hidden');
    const list = document.getElementById('today-sessions-list');
    list.innerHTML = '';
    todaySessions.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'session-card';
      card.innerHTML = `
        <div class="session-type">${typeLabel(s.type)}</div>
        <div class="session-details">
          <span>${formatTime(s.bedtime)} → ${formatTime(s.waketime)}</span>
          <span>${formatDuration(s.duration)}</span>
        </div>
        <div class="session-rating">
          <span class="rating-badge-sm" style="background:${ratingColor(s.rating)};color:${s.rating <= 6 ? '#0f0f1a' : 'white'}">${s.rating}</span>
        </div>
      `;
      list.appendChild(card);
    });

    // Show total sleep today
    const totalMs = todaySessions.reduce((s, r) => s + r.duration, 0);
    const nightMs = todaySessions.filter(r => r.type === 'night').reduce((s, r) => s + r.duration, 0);
    const napMs = todaySessions.filter(r => r.type === 'nap').reduce((s, r) => s + r.duration, 0);
    let summary = `合計: ${formatDuration(totalMs)}`;
    if (nightMs > 0 && napMs > 0) {
      summary += `（夜: ${formatDuration(nightMs)} / 仮眠: ${formatDuration(napMs)}）`;
    }
    const sumEl = document.getElementById('today-summary') || document.createElement('p');
    sumEl.id = 'today-summary';
    sumEl.className = 'today-summary';
    sumEl.textContent = summary;
    if (!sumEl.parentNode) list.parentNode.insertBefore(sumEl, list);
  } else {
    todaySessionsDiv.classList.add('hidden');
  }
}

// Sleep button (おやすみ)
document.getElementById('btn-sleep').addEventListener('click', () => {
  const now = new Date().toISOString();
  setPendingSleep({ bedtime: now });
  document.getElementById('sleep-status').classList.add('hidden');
  document.getElementById('sleeping-status').classList.remove('hidden');
  document.getElementById('bedtime-display').textContent = formatTime(now);
});

// Cancel sleep
document.getElementById('btn-cancel-sleep').addEventListener('click', () => {
  setPendingSleep(null);
  updateHomeView();
});
document.getElementById('btn-cancel-sleep2').addEventListener('click', () => {
  setPendingSleep(null);
  updateHomeView();
});

// Wake up — shared logic
function handleWakeUp() {
  wakeTimeISO = new Date().toISOString();
  const pending = getPendingSleep();
  if (!pending) return;

  const bedtime = new Date(pending.bedtime);
  const wakeTime = new Date(wakeTimeISO);
  const duration = wakeTime - bedtime;
  const type = classifySleep(pending.bedtime, duration);

  // Hide everything, show rating
  document.getElementById('sleep-section').classList.add('hidden');
  document.getElementById('wake-button-section').classList.add('hidden');
  document.getElementById('rating-section').classList.remove('hidden');
  document.getElementById('rating-duration').textContent = formatDuration(duration);
  document.getElementById('sleep-type-label').textContent = typeLabel(type);
  document.getElementById('rating-greeting').textContent = type === 'night' ? 'おはよう！' : 'お疲れさま！';
  document.body.classList.add('dawn');
  buildRatingGrid();
}

document.getElementById('btn-wake').addEventListener('click', handleWakeUp);
document.getElementById('btn-wake-from-sleep').addEventListener('click', handleWakeUp);

// Rating grid — tap to instantly save
function buildRatingGrid() {
  const grid = document.getElementById('rating-grid');
  grid.innerHTML = '';
  const emojis = ['😫','😩','😔','😟','😐','🙂','😊','😌','💤','🌙'];
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.className = `rating-btn r${i}`;
    btn.innerHTML = `<span class="rating-num">${i}</span><span class="rating-emoji">${emojis[i-1]}</span>`;
    btn.addEventListener('click', () => saveRecord(i));
    grid.appendChild(btn);
  }
}

// Save record
function saveRecord(rating) {
  const pending = getPendingSleep();
  if (!pending || !wakeTimeISO) return;

  const bedtime = new Date(pending.bedtime);
  const wakeTime = new Date(wakeTimeISO);
  const duration = wakeTime - bedtime;
  const type = classifySleep(pending.bedtime, duration);

  const key = dateKey(wakeTime);
  const records = loadRecords();
  if (!records[key]) records[key] = [];

  const newRecord = {
    bedtime: pending.bedtime,
    waketime: wakeTimeISO,
    duration: duration,
    rating: rating,
    type: type,
  };
  records[key].push(newRecord);

  saveRecords(records);
  syncToSheets(newRecord); // fire-and-forget
  setPendingSleep(null);
  wakeTimeISO = null;
  document.body.classList.remove('dawn');
  updateHomeView();
}

// ---- History (計測) View ----

function renderHistory() {
  const records = loadRecords();
  const container = document.getElementById('history-list');

  // Flatten and sort by date descending
  const allDays = Object.keys(records).sort().reverse();

  if (allDays.length === 0) {
    container.innerHTML = `
      <div class="no-data">
        <div class="no-data-icon">⏱</div>
        <p>まだ計測データがありません</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  for (const day of allDays) {
    const sessions = records[day];
    if (!sessions || sessions.length === 0) continue;

    const dayDiv = document.createElement('div');
    dayDiv.className = 'history-day';

    const totalMs = sessions.reduce((s, r) => s + r.duration, 0);
    const avgRating = (sessions.reduce((s, r) => s + r.rating, 0) / sessions.length).toFixed(1);

    dayDiv.innerHTML = `<div class="history-day-header">
      <span class="history-date">${formatDateLabel(day)}</span>
      <span class="history-day-summary">${sessions.length}回 / ${formatDuration(totalMs)} / 気分 ${avgRating}</span>
    </div>`;

    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'history-session';
      row.innerHTML = `
        <span class="history-type">${typeLabel(s.type)}</span>
        <span class="history-time">${formatTime(s.bedtime)} → ${formatTime(s.waketime)}</span>
        <span class="history-dur">${formatDuration(s.duration)}</span>
        <span class="rating-badge-sm" style="background:${ratingColor(s.rating)};color:${s.rating <= 6 ? '#0f0f1a' : 'white'}">${s.rating}</span>
      `;
      dayDiv.appendChild(row);
    });

    container.appendChild(dayDiv);
  }
}

function formatDateLabel(key) {
  const d = new Date(key + 'T00:00:00');
  const today = todayKey();
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  if (key === today) return '今日';
  if (key === yesterday) return '昨日';
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });
}

// ---- Calendar View ----

let calYear, calMonth;

function initCalendar() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

document.getElementById('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});

document.getElementById('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

function renderCalendar() {
  const records = loadRecords();
  const title = document.getElementById('cal-month-title');
  title.textContent = `${calYear}年${calMonth + 1}月`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayKey();

  // Previous month padding
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    const btn = document.createElement('button');
    btn.className = 'cal-day other-month';
    btn.textContent = prevDays - i;
    grid.appendChild(btn);
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const sessions = records[key] || [];
    const btn = document.createElement('button');
    btn.className = 'cal-day';
    if (key === today) btn.classList.add('today');

    if (sessions.length > 0) {
      btn.classList.add('has-data');
      const avgRating = Math.round(sessions.reduce((s, r) => s + r.rating, 0) / sessions.length);
      const badge = document.createElement('span');
      badge.className = `cal-rating ${ratingClass(avgRating)}`;
      badge.textContent = sessions.length > 1 ? `${avgRating}×${sessions.length}` : avgRating;
      btn.innerHTML = `<span>${d}</span>`;
      btn.appendChild(badge);
    } else {
      btn.textContent = d;
    }
    btn.addEventListener('click', () => showCalDetail(key, sessions));
    grid.appendChild(btn);
  }

  // Next month padding
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const btn = document.createElement('button');
    btn.className = 'cal-day other-month';
    btn.textContent = i;
    grid.appendChild(btn);
  }

  document.getElementById('cal-detail').classList.add('hidden');
}

function showCalDetail(key, sessions) {
  const detail = document.getElementById('cal-detail');
  if (!sessions || sessions.length === 0) {
    detail.innerHTML = `<h3>${key}</h3><p class="no-data">記録なし</p>`;
  } else {
    let html = `<h3>${key}（${sessions.length}回）</h3>`;
    sessions.forEach(s => {
      html += `
        <div class="cal-session">
          <span class="cal-session-type">${typeLabel(s.type)}</span>
          <div class="record-details">
            <div class="record-item">
              <span class="record-label">就寝</span>
              <span class="record-value">${formatTime(s.bedtime)}</span>
            </div>
            <div class="record-item">
              <span class="record-label">起床</span>
              <span class="record-value">${formatTime(s.waketime)}</span>
            </div>
            <div class="record-item">
              <span class="record-label">睡眠時間</span>
              <span class="record-value">${formatDuration(s.duration)}</span>
            </div>
            <div class="record-item">
              <span class="record-label">気分</span>
              <span class="record-value rating-badge" style="background:${ratingColor(s.rating)};color:${s.rating <= 6 ? '#0f0f1a' : 'white'}">${s.rating}</span>
            </div>
          </div>
        </div>
      `;
    });
    const totalMs = sessions.reduce((s, r) => s + r.duration, 0);
    html += `<p class="cal-total">合計睡眠: ${formatDuration(totalMs)}</p>`;
    detail.innerHTML = html;
  }
  detail.classList.remove('hidden');
}

// ---- Report View ----

let currentPeriod = 'week';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    renderReport();
  });
});

function getFilteredSessions(period) {
  const records = loadRecords();
  const now = new Date();
  let cutoff;

  if (period === 'week') {
    cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 7);
  } else if (period === 'month') {
    cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 1);
  } else {
    cutoff = new Date(2000, 0, 1);
  }

  const all = [];
  for (const [key, sessions] of Object.entries(records)) {
    const d = new Date(key + 'T00:00:00');
    if (d >= cutoff) {
      for (const s of sessions) {
        if (s.rating) all.push({ date: key, ...s });
      }
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all;
}

function renderReport() {
  const data = getFilteredSessions(currentPeriod);
  const container = document.getElementById('report-content');

  if (data.length === 0) {
    container.innerHTML = `
      <div class="no-data">
        <div class="no-data-icon">📊</div>
        <p>まだデータがありません</p>
        <p>毎日の記録を続けるとレポートが表示されます</p>
      </div>
    `;
    return;
  }

  const nightData = data.filter(d => d.type === 'night');
  const napData = data.filter(d => d.type === 'nap');

  const avgRating = (data.reduce((s, d) => s + d.rating, 0) / data.length).toFixed(1);
  const avgSleep = data.reduce((s, d) => s + d.duration, 0) / data.length;
  const bestRating = Math.min(...data.map(d => d.rating));
  const totalSessions = data.length;

  container.innerHTML = `
    <div class="report-card">
      <h3>概要</h3>
      <div class="stats-grid">
        <div class="stat">
          <span class="stat-value" id="stat-avg-rating">${avgRating}</span>
          <span class="stat-label">平均気分</span>
        </div>
        <div class="stat">
          <span class="stat-value">${formatDurationShort(avgSleep)}</span>
          <span class="stat-label">平均睡眠</span>
        </div>
        <div class="stat">
          <span class="stat-value">${bestRating}</span>
          <span class="stat-label">最高評価</span>
        </div>
        <div class="stat">
          <span class="stat-value">${totalSessions}回</span>
          <span class="stat-label">計測回数</span>
        </div>
      </div>
      ${nightData.length > 0 && napData.length > 0 ? `
        <div class="type-breakdown">
          <span>🌙 夜: ${nightData.length}回（平均 ${formatDurationShort(nightData.reduce((s,d) => s+d.duration, 0) / nightData.length)}）</span>
          <span>💤 仮眠: ${napData.length}回（平均 ${formatDurationShort(napData.reduce((s,d) => s+d.duration, 0) / napData.length)}）</span>
        </div>
      ` : ''}
    </div>
    <div class="report-card">
      <h3>気分の推移</h3>
      <canvas id="chart-rating" height="200"></canvas>
    </div>
    <div class="report-card">
      <h3>睡眠時間の推移</h3>
      <canvas id="chart-sleep" height="200"></canvas>
    </div>
    <div class="report-card">
      <h3>曜日別の傾向</h3>
      <div id="weekday-stats" class="weekday-stats"></div>
    </div>
    <div class="report-card">
      <h3>睡眠時間と気分の関係</h3>
      <div id="correlation-info" class="correlation-info"></div>
    </div>
  `;

  drawLineChart('chart-rating', data, d => d.rating, {
    min: 1, max: 10, invert: true, color: '#6c63ff'
  });
  drawLineChart('chart-sleep', data, d => d.duration / 3600000, {
    min: 0, max: 12, invert: false, color: '#4ecdc4'
  });
  renderWeekdayStats(data);
  renderCorrelation(data);
}

function drawLineChart(canvasId, data, valueFn, opts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  const pad = { top: 20, right: 16, bottom: 30, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) {
    ctx.fillStyle = '#8888aa';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('2回以上のデータが必要です', w / 2, h / 2);
    return;
  }

  const values = data.map(valueFn);
  const range = opts.max - opts.min;

  ctx.strokeStyle = '#2a2a4a';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#8888aa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    let labelVal = opts.invert ? opts.min + (range / 4) * i : opts.max - (range / 4) * i;
    ctx.fillText(labelVal.toFixed(labelVal % 1 === 0 ? 0 : 1), pad.left - 8, y + 4);
  }

  ctx.fillStyle = '#8888aa';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += labelStep) {
    const x = pad.left + (plotW / (data.length - 1)) * i;
    const parts = data[i].date.split('-');
    ctx.fillText(`${parseInt(parts[1])}/${parseInt(parts[2])}`, x, h - 6);
  }

  const points = values.map((v, i) => {
    const x = pad.left + (plotW / (data.length - 1)) * i;
    let norm = opts.invert ? (v - opts.min) / range : 1 - (v - opts.min) / range;
    const y = pad.top + norm * plotH;
    return { x, y, type: data[i].type };
  });

  // Area
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + plotH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, pad.top + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  grad.addColorStop(0, opts.color + '40');
  grad.addColorStop(1, opts.color + '05');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Points — different shape for nap vs night
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = p.type === 'nap' ? '#ff9f43' : opts.color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#0f0f1a';
    ctx.fill();
  });
}

function renderWeekdayStats(data) {
  const container = document.getElementById('weekday-stats');
  if (!container) return;
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const buckets = Array.from({ length: 7 }, () => ({ ratings: [], sleeps: [] }));

  data.forEach(rec => {
    const dow = new Date(rec.date + 'T00:00:00').getDay();
    buckets[dow].ratings.push(rec.rating);
    buckets[dow].sleeps.push(rec.duration / 3600000);
  });

  container.innerHTML = '';
  buckets.forEach((b, i) => {
    const avg = b.ratings.length > 0
      ? (b.ratings.reduce((s, v) => s + v, 0) / b.ratings.length).toFixed(1)
      : '--';
    const avgNum = parseFloat(avg) || 5;
    const pct = Math.max(10, ((10 - avgNum) / 9) * 100);
    const color = ratingColor(avgNum);

    const item = document.createElement('div');
    item.className = 'weekday-item';
    item.innerHTML = `
      <span class="day-avg" style="color:${color}">${avg}</span>
      <div class="day-bar">
        <div class="day-fill" style="height:${pct}%;background:${color}"></div>
      </div>
      <span class="day-name">${dayNames[i]}</span>
    `;
    container.appendChild(item);
  });
}

function renderCorrelation(data) {
  const container = document.getElementById('correlation-info');
  if (!container) return;

  if (data.length < 3) {
    container.innerHTML = '<p class="no-data">3回以上のデータが必要です</p>';
    return;
  }

  const sleeps = data.map(d => d.duration / 3600000);
  const ratings = data.map(d => d.rating);
  const n = data.length;
  const meanS = sleeps.reduce((a, b) => a + b, 0) / n;
  const meanR = ratings.reduce((a, b) => a + b, 0) / n;
  let num = 0, denS = 0, denR = 0;
  for (let i = 0; i < n; i++) {
    const ds = sleeps[i] - meanS;
    const dr = ratings[i] - meanR;
    num += ds * dr;
    denS += ds * ds;
    denR += dr * dr;
  }
  const r = denS && denR ? num / Math.sqrt(denS * denR) : 0;

  const good = data.filter(d => d.rating <= 3);
  const avgGoodSleep = good.length > 0
    ? (good.reduce((s, d) => s + d.duration / 3600000, 0) / good.length).toFixed(1)
    : null;

  let insights = '';
  if (Math.abs(r) < 0.2) {
    insights += `<div class="insight">睡眠時間と気分の間に明確な関連は見られません（相関: ${r.toFixed(2)}）</div>`;
  } else if (r < 0) {
    insights += `<div class="insight">睡眠時間が長いほど気分が良い傾向があります（相関: ${r.toFixed(2)}）</div>`;
  } else {
    insights += `<div class="insight">睡眠時間が短い方が気分が良い傾向があります（相関: ${r.toFixed(2)}）</div>`;
  }

  if (avgGoodSleep) {
    insights += `<div class="insight">気分が良い日（1〜3）の平均睡眠時間: <strong>${avgGoodSleep}時間</strong></div>`;
  }

  const avgBedHour = data.reduce((s, d) => {
    const h = new Date(d.bedtime).getHours();
    return s + (h < 12 ? h + 24 : h);
  }, 0) / n;
  insights += `<div class="insight">平均就寝時刻: <strong>${Math.floor(avgBedHour % 24)}:${String(Math.round((avgBedHour % 1) * 60)).padStart(2, '0')}</strong></div>`;

  container.innerHTML = insights;
}

// ---- Service Worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Push 購読期限切れ時に SW から再登録依頼を受け取る
  navigator.serviceWorker.addEventListener('message', async e => {
    if (e.data?.type === 'push-resubscribe') {
      await subscribeToPush({ force: true });
    }
  });
}

// バックグラウンド→前面に戻った時にPush購読をサーバーと再同期
// （iOS でアプリを閉じた後に購読が失効していても自動復旧）
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const s = loadSettings();
    if (s.reminderEnabled) {
      const ok = await subscribeToPush();
      if (!ok) {
        // 購読失敗 → force で新規作成
        await subscribeToPush({ force: true });
      }
      await updatePushStatusUI();
    }
  }
});

// ---- Bedtime Reminder ----

// Cloudflare Worker のデプロイ後に設定する
const PUSH_SERVER_URL = 'https://sleep-tracker-push.ichikawa888.workers.dev';

// 睡眠データ収集（本部管理用 — ユーザーには非公開）
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwS1sCWg3Tz3ERMafkyVcfiwPy-49J3zsoXRQz_7VQwHpDtO_UF82N--OG6Bejus5xAVQ/exec';
const VAPID_PUBLIC_KEY = 'BF6ZnvMefM6NwoG_z0WLrYI1xXrPGsEyVNDJwnk8vDfKjoEo81bcnLYQ4jUl_0026Q6sZzrYLK8nfVlkB2xlMWg';

const SETTINGS_KEY = 'sleep_tracker_settings';

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch { return {}; }
}

// IndexedDB: Service Worker と設定を共有するため
function openSettingsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sleep-tracker-db', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('settings');
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function saveSettingsToDB(s) {
  try {
    const db = await openSettingsDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(s, 'main');
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  } catch (e) {
    console.warn('IndexedDB保存失敗:', e);
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  saveSettingsToDB(s);
}

async function registerPeriodicSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await reg.periodicSync.register('bedtime-reminder', { minInterval: 60 * 1000 });
      console.log('Periodic Background Sync 登録済み');
    }
  } catch (e) {
    console.log('Periodic Sync 未対応:', e);
  }
}

// ---- Web Push（サーバー経由・iOS対応）----

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function isStandalone() {
  return navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

async function subscribeToPush({ force = false } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (VAPID_PUBLIC_KEY.startsWith('YOUR_')) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // force=true のとき（再登録ボタン）は既存を破棄して新規作成
    if (sub && force) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const s = loadSettings();
    const res = await fetch(`${PUSH_SERVER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        reminderTime: s.reminderTime || '23:00',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => String(res.status));
      throw new Error(`Push server error ${res.status}: ${msg}`);
    }
    console.log('Push 購読済み ✓');
    return true;
  } catch (e) {
    console.warn('Push 購読失敗:', e);
    return false;
  }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch(`${PUSH_SERVER_URL}/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
    console.log('Push 購読解除済み');
  } catch (e) {
    console.warn('Push 購読解除失敗:', e);
  }
}

async function updatePushReminderTime(reminderTime) {
  if (!('serviceWorker' in navigator) || VAPID_PUBLIC_KEY.startsWith('YOUR_')) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch(`${PUSH_SERVER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        reminderTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
  } catch (e) {
    console.warn('Push 時刻更新失敗:', e);
  }
}

let lastNotifiedMinute = null;
let reminderInterval = null;

function checkReminder() {
  const s = loadSettings();
  if (!s.reminderEnabled || !s.reminderTime) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm === s.reminderTime && hhmm !== lastNotifiedMinute) {
    lastNotifiedMinute = hhmm;
    showBedtimeNotification();
  }
}

async function showBedtimeNotification() {
  const opts = {
    body: 'そろそろ眠る時間ですよ 🌙',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'bedtime-reminder',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
  };
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('神睡眠トラッカー', opts);
      return;
    } catch {}
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('神睡眠トラッカー', opts);
  }
}

function startReminderCheck() {
  if (reminderInterval) clearInterval(reminderInterval);
  reminderInterval = setInterval(checkReminder, 30000);
}

// ---- Settings Modal ----

function updateNotifPermissionBanner() {
  const banner = document.getElementById('notification-permission-banner');
  const denied = document.getElementById('notification-denied-banner');
  const iosBanner = document.getElementById('ios-standalone-banner');
  const iosGuide = document.getElementById('ios-notif-guide');

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  // iOSかつPWA未インストールの場合は専用バナーを表示
  if (isIos && !isStandalone()) {
    iosBanner.classList.remove('hidden');
    banner.classList.add('hidden');
    denied.classList.add('hidden');
    iosGuide.classList.add('hidden');
    return;
  }
  iosBanner.classList.add('hidden');

  // iOSのスタンドアロン+通知許可済み → ロック画面・集中モード設定ガイドを表示
  if (isIos && isStandalone() && 'Notification' in window && Notification.permission === 'granted') {
    iosGuide.classList.remove('hidden');
  } else {
    iosGuide.classList.add('hidden');
  }

  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    banner.classList.add('hidden');
    denied.classList.add('hidden');
  } else if (Notification.permission === 'denied') {
    banner.classList.add('hidden');
    denied.classList.remove('hidden');
  } else {
    banner.classList.remove('hidden');
    denied.classList.add('hidden');
  }
}

async function updatePushStatusUI() {
  const badge = document.getElementById('push-status-badge');
  const resubBtn = document.getElementById('btn-resubscribe');
  const testBtn = document.getElementById('btn-test-push');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    badge.textContent = '非対応';
    badge.className = 'push-status-badge';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // ブラウザ側に購読あり → サーバー側も確認
      let serverOk = false;
      try {
        const res = await fetch(
          `${PUSH_SERVER_URL}/subscription-status?endpoint=${encodeURIComponent(sub.endpoint)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const data = await res.json();
          serverOk = data.registered === true;
        }
      } catch {}

      if (serverOk) {
        badge.textContent = '登録済み ✓';
        badge.className = 'push-status-badge subscribed';
        resubBtn.classList.add('hidden');
        testBtn.classList.remove('hidden');
      } else {
        // ブラウザにあるがサーバーにない → 再登録促す
        badge.textContent = 'サーバー未登録 ⚠';
        badge.className = 'push-status-badge not-subscribed';
        testBtn.classList.add('hidden');
        resubBtn.classList.remove('hidden');
        // 自動で再登録試行
        subscribeToPush();
      }
    } else {
      badge.textContent = '未登録';
      badge.className = 'push-status-badge not-subscribed';
      testBtn.classList.add('hidden');
      const s = loadSettings();
      if (s.reminderEnabled && Notification.permission === 'granted') {
        resubBtn.classList.remove('hidden');
      } else {
        resubBtn.classList.add('hidden');
      }
    }
  } catch {
    badge.textContent = 'エラー';
    badge.className = 'push-status-badge';
  }
}

async function openSettings() {
  const s = loadSettings();
  const toggle = document.getElementById('reminder-toggle');
  const timeInput = document.getElementById('reminder-time');
  toggle.checked = !!s.reminderEnabled;
  timeInput.value = s.reminderTime || '23:00';
  updateNotifPermissionBanner();
  updatePushStatusUI();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('btn-clear-cache').addEventListener('click', async () => {
  const btn = document.getElementById('btn-clear-cache');
  btn.textContent = 'クリア中...';
  btn.disabled = true;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch {}
  location.reload();
});
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSettings();
});

document.getElementById('reminder-toggle').addEventListener('change', async e => {
  const s = loadSettings();
  s.reminderEnabled = e.target.checked;
  saveSettings(s);
  if (s.reminderEnabled) {
    if ('Notification' in window && Notification.permission === 'default') {
      updateNotifPermissionBanner();
    } else if (Notification.permission === 'granted') {
      await subscribeToPush();
      await updatePushStatusUI();
    }
  } else {
    await unsubscribeFromPush();
    await updatePushStatusUI();
  }
});

document.getElementById('reminder-time').addEventListener('change', async e => {
  const s = loadSettings();
  s.reminderTime = e.target.value;
  saveSettings(s);
  if (s.reminderEnabled && Notification.permission === 'granted') {
    await updatePushReminderTime(e.target.value);
  }
});

// ---- Data Export / Import ----

document.getElementById('btn-export').addEventListener('click', () => {
  const records = loadRecords();
  const json = JSON.stringify({ version: 1, exported: new Date().toISOString(), records }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sleep-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('input-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const resultEl = document.getElementById('import-result');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.records || typeof data.records !== 'object') throw new Error('形式が正しくありません');
    const existing = loadRecords();
    // Merge: imported data takes priority per date
    const merged = { ...existing, ...data.records };
    localStorage.setItem(DB_KEY, JSON.stringify(merged));
    const count = Object.values(data.records).flat().length;
    resultEl.textContent = `✓ ${count}件のデータをインポートしました`;
    resultEl.className = 'import-result success';
    resultEl.classList.remove('hidden');
    e.target.value = '';
    updateHomeView();
  } catch (err) {
    resultEl.textContent = `エラー: ${err.message}`;
    resultEl.className = 'import-result error';
    resultEl.classList.remove('hidden');
    e.target.value = '';
  }
});

document.getElementById('btn-resubscribe').addEventListener('click', async () => {
  const btn = document.getElementById('btn-resubscribe');
  btn.textContent = '登録中...';
  btn.disabled = true;
  const ok = await subscribeToPush({ force: true });
  await updatePushStatusUI();
  btn.textContent = ok ? '再登録しました ✓' : '通知を再登録する';
  setTimeout(() => {
    btn.textContent = '通知を再登録する';
    btn.disabled = false;
  }, 2000);
});

document.getElementById('btn-test-push').addEventListener('click', async () => {
  const btn = document.getElementById('btn-test-push');
  btn.textContent = '送信中...';
  btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      btn.textContent = '未登録 → 再登録してください';
      setTimeout(() => { btn.textContent = 'テスト通知を送る'; btn.disabled = false; }, 3000);
      return;
    }
    const res = await fetch(`${PUSH_SERVER_URL}/test-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = '送信完了 ✓ 通知を確認してください';
    } else if (data.error === 'not_registered') {
      btn.textContent = 'サーバー未登録 → 再登録ボタンを押してください';
      document.getElementById('btn-resubscribe').classList.remove('hidden');
    } else if (res.status === 410) {
      btn.textContent = '購読期限切れ → 再登録してください';
      document.getElementById('btn-resubscribe').classList.remove('hidden');
    } else {
      btn.textContent = `エラー: ${data.error}`;
    }
  } catch (e) {
    btn.textContent = `失敗: ${e.message}`;
  }
  setTimeout(() => { btn.textContent = 'テスト通知を送る'; btn.disabled = false; }, 5000);
});

document.getElementById('btn-request-notif').addEventListener('click', async () => {
  const result = await Notification.requestPermission();
  updateNotifPermissionBanner();
  if (result === 'granted') {
    const s = loadSettings();
    s.reminderEnabled = true;
    saveSettings(s);
    document.getElementById('reminder-toggle').checked = true;
    registerPeriodicSync();
    await subscribeToPush();
  }
});

// ---- Starfield ----

(function () {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function initStars() {
    stars = [];
    // Small dim stars
    for (let i = 0; i < 120; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.0 + 0.2, speed: Math.random() * 0.015 + 0.003, phase: Math.random() * Math.PI * 2, bright: false });
    }
    // Medium stars
    for (let i = 0; i < 25; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 1.0, speed: Math.random() * 0.008 + 0.002, phase: Math.random() * Math.PI * 2, bright: false });
    }
    // Bright glowing stars
    for (let i = 0; i < 8; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.0 + 2.0, speed: Math.random() * 0.005 + 0.001, phase: Math.random() * Math.PI * 2, bright: true });
    }
  }

  function draw(ts) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    stars.forEach(s => {
      const alpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(ts * s.speed + s.phase));
      const x = s.x * w, y = s.y * h;
      if (s.bright) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, s.r * 4);
        glow.addColorStop(0, `rgba(200, 210, 255, ${alpha})`);
        glow.addColorStop(1, 'rgba(200, 210, 255, 0)');
        ctx.beginPath();
        ctx.arc(x, y, s.r * 4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220, 225, 255, ${alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); initStars(); });
  resize();
  initStars();
  requestAnimationFrame(draw);
})();

// ---- Profile ----

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch { return null; }
}
function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function initOnboarding() {
  const yearSel = document.getElementById('ob-year');
  const monthSel = document.getElementById('ob-month');
  const daySel = document.getElementById('ob-day');
  const cur = new Date().getFullYear();

  // Year
  yearSel.innerHTML = '<option value="">年</option>';
  for (let y = cur; y >= cur - 100; y--) {
    yearSel.innerHTML += `<option value="${y}">${y}</option>`;
  }
  // Month
  monthSel.innerHTML = '<option value="">月</option>';
  for (let m = 1; m <= 12; m++) {
    monthSel.innerHTML += `<option value="${String(m).padStart(2,'0')}">${m}</option>`;
  }
  // Day
  daySel.innerHTML = '<option value="">日</option>';
  for (let d = 1; d <= 31; d++) {
    daySel.innerHTML += `<option value="${String(d).padStart(2,'0')}">${d}</option>`;
  }

  document.getElementById('ob-submit').addEventListener('click', () => {
    const year = yearSel.value, month = monthSel.value, day = daySel.value;
    const gender = document.querySelector('input[name="ob-gender"]:checked');
    const errEl = document.getElementById('ob-error');
    if (!year || !month || !day || !gender) {
      errEl.classList.remove('hidden'); return;
    }
    errEl.classList.add('hidden');
    saveProfile({
      userId: generateUUID(),
      birthdate: `${year}-${month}-${day}`,
      gender: gender.value,
      registeredAt: new Date().toISOString(),
    });
    document.getElementById('onboarding-overlay').classList.add('hidden');
  });
}

function checkOnboarding() {
  if (!loadProfile()) {
    document.getElementById('onboarding-overlay').classList.remove('hidden');
    initOnboarding();
  }
}

// ---- Google Sheets Sync ----

function buildPayload(record, profile, reminderTime) {
  return {
    userId:        profile.userId,
    birthdate:     profile.birthdate,
    gender:        profile.gender,
    date:          dateKey(new Date(record.waketime)),
    bedtime:       record.bedtime,
    waketime:      record.waketime,
    duration_min:  Math.round(record.duration / 60000),
    sleep_type:    record.type,
    rating:        record.rating,
    reminder_time: reminderTime || '',
  };
}

async function postToGAS(payload) {
  await fetch(GAS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
  });
}

async function syncToSheets(record) {
  if (!GAS_URL) return;
  const profile = loadProfile();
  if (!profile) return;
  const s = loadSettings();
  try {
    await postToGAS(buildPayload(record, profile, s.reminderTime));
  } catch {}
}

// 起動時に全既存データを一括送信（初回のみ）
async function bulkSyncAllRecords() {
  if (!GAS_URL) return;
  const profile = loadProfile();
  if (!profile) return;
  if (localStorage.getItem('sleep_tracker_bulk_synced')) return;

  const records = loadRecords();
  const s = loadSettings();
  const all = Object.values(records).flat();
  if (all.length === 0) return;

  for (const rec of all) {
    try { await postToGAS(buildPayload(rec, profile, s.reminderTime)); } catch {}
  }
  localStorage.setItem('sleep_tracker_bulk_synced', '1');
}

// ---- Init ----

checkOnboarding();
bulkSyncAllRecords();
startReminderCheck();
// 既存のlocalStorage設定をIndexedDBに同期（SW共有のため）
saveSettingsToDB(loadSettings());
if ('Notification' in window && Notification.permission === 'granted') {
  registerPeriodicSync();
  const initSettings = loadSettings();
  if (initSettings.reminderEnabled) subscribeToPush();
}
initCalendar();
updateHomeView();
