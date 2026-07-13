/* RepForge — equipment-aware workout tracker */
'use strict';

// ===================== State =====================
const STORE_KEY = 'repforge.v1';

const defaultState = () => ({
  ver: 1,
  onboarded: false,
  equipment: [],
  settings: { unit: 'lb', restSec: 90 },
  routines: [],
  workouts: [],
  active: null,
  plan: null, // { enabled, freq (days between workouts), groups: [muscle ids], anchor: day timestamp }
});

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { console.warn('Failed to load state', e); }
  return defaultState();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ===================== Utilities =====================
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unit = () => S.settings.unit;

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtClock(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtNum(n) {
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(n).toLocaleString();
}

function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

// ===================== Equipment logic =====================
function hasEquip(id) { return S.equipment.includes(id); }

// eq entries: string (required) or array (any-of). Returns true if doable.
function canDo(ex) {
  return ex.eq.every(req => Array.isArray(req) ? req.some(hasEquip) : hasEquip(req));
}
function missingFor(ex) {
  const out = [];
  for (const req of ex.eq) {
    if (Array.isArray(req)) {
      if (!req.some(hasEquip)) out.push(req.map(id => EQUIPMENT_BY_ID[id].name).join(' or '));
    } else if (!hasEquip(req)) {
      out.push(EQUIPMENT_BY_ID[req].name);
    }
  }
  return out;
}
function availableExercises() { return EXERCISES.filter(canDo); }

function equipShort(ex) {
  if (!ex.eq.length) return 'Bodyweight';
  return ex.eq.map(req => Array.isArray(req)
    ? req.map(id => EQUIPMENT_BY_ID[id].name).join(' / ')
    : EQUIPMENT_BY_ID[req].name).join(' + ');
}

// Resolve a template slot to the best exercise the user can actually do.
function resolveSlot(slot, taken) {
  for (const id of slot.prefer) {
    const ex = EXERCISE_BY_ID[id];
    if (ex && canDo(ex) && !taken.has(id)) return ex;
  }
  const fallback = EXERCISES.find(e => e.p === slot.p && canDo(e) && !taken.has(e.id));
  return fallback || null;
}
function resolveTemplateDay(day) {
  const taken = new Set();
  const items = [];
  let skipped = 0;
  for (const slot of day.slots) {
    const ex = resolveSlot(slot, taken);
    if (ex) { taken.add(ex.id); items.push({ exId: ex.id, sets: slot.sets, reps: slot.reps }); }
    else skipped++;
  }
  return { items, skipped };
}

// ===================== Workout generator & training plan =====================
function pickForPattern(pat, taken, rand = false) {
  const pref = (PATTERN_PREFER[pat] || []).map(id => EXERCISE_BY_ID[id]).filter(ex => ex && canDo(ex) && !taken.has(ex.id));
  if (pref.length) return rand ? pref[Math.floor(Math.random() * Math.min(3, pref.length))] : pref[0];
  return EXERCISES.find(e => e.p === pat && canDo(e) && !taken.has(e.id)) || null;
}

function repsFor(pat, ex) {
  if (ex.t === 't') return '30-60s';
  if (['squat', 'hinge', 'hpush', 'vpush', 'hpull', 'vpull'].includes(pat)) return '6-10';
  if (pat === 'lunge') return '8-12';
  return '10-15';
}

// Build a workout (list of routine items) for the given muscle groups,
// using only exercises the user's equipment allows.
function generateWorkout(groupIds, rand = false) {
  const taken = new Set();
  const per = groupIds.length <= 1 ? 5 : groupIds.length === 2 ? 3 : groupIds.length <= 4 ? 2 : 1;
  const items = [];
  for (const gid of groupIds) {
    const def = GROUP_DEFS.find(g => g.id === gid);
    if (!def) continue;
    let added = 0;
    for (let i = 0; added < per && i < def.patterns.length * 3; i++) {
      const pat = def.patterns[i % def.patterns.length];
      const ex = pickForPattern(pat, taken, rand);
      if (ex) { taken.add(ex.id); items.push({ exId: ex.id, sets: 3, reps: repsFor(pat, ex) }); added++; }
      else if (i >= def.patterns.length - 1 && !added && i >= def.patterns.length * 2) break;
    }
  }
  return items.slice(0, 8);
}

// Split the chosen groups into rotation days (paired in GROUP_DEFS order,
// which keeps natural pairs like Chest+Triceps and Back+Biceps together).
function buildRotation(groupIds) {
  const ordered = GROUP_DEFS.map(g => g.id).filter(id => groupIds.includes(id));
  if (ordered.length <= 2) return [ordered];
  const days = [];
  for (let i = 0; i < ordered.length; i += 2) days.push(ordered.slice(i, i + 2));
  return days;
}

function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

const FREQ_LABELS = { 1: 'every day', 2: 'every other day', 3: 'every 3rd day' };

// What does the plan say about today? null when no active plan.
function planInfo() {
  const p = S.plan;
  if (!p || !p.enabled || !p.groups.length) return null;
  const today = dayStart(Date.now());
  const diff = Math.round((today - p.anchor) / 864e5);
  const rotation = buildRotation(p.groups);
  const isDay = diff >= 0 && diff % p.freq === 0;
  const slot = i => ((i % rotation.length) + rotation.length) % rotation.length;
  const todayIdx = diff / p.freq;
  const nextIdx = diff < 0 ? 0 : Math.floor(diff / p.freq) + 1;
  return {
    isDay,
    doneToday: S.workouts.some(w => dayStart(w.start) === today),
    todayGroups: isDay ? rotation[slot(todayIdx)] : null,
    nextTs: p.anchor + nextIdx * p.freq * 864e5,
    nextGroups: rotation[slot(nextIdx)],
    freqLabel: FREQ_LABELS[p.freq] || `every ${p.freq} days`,
  };
}

function startGenerated(groups, items) {
  const entries = items.map(i => makeEntry(i.exId, i.sets, i.reps));
  startWorkout(groups.join(' & '), entries);
}

// Plan setup / edit modal
function openPlanEditor() {
  const existing = S.plan;
  let freq = existing?.freq || 2;
  let sel = new Set(existing?.groups || []);

  const redraw = () => {
    const rotation = buildRotation([...sel]);
    openModal(`
      <div class="modal-head"><h2>${existing ? 'Edit training plan' : 'Set up training plan'}</h2><button class="icon-btn" id="pl-x">✕</button></div>
      <div class="modal-body">
        <div class="section-label" style="margin-top:0">How often do you want to train?</div>
        <div class="chip-row">
          ${[1, 2, 3].map(f => `<button class="chip ${freq === f ? 'active' : ''}" data-freq="${f}">${f === 1 ? 'Every day' : f === 2 ? 'Every other day' : 'Every 3rd day'}</button>`).join('')}
        </div>
        <div class="section-label">Which muscle groups do you want to work?</div>
        <div class="group-grid">
          ${GROUP_DEFS.map(g => `
            <button class="equip-item ${sel.has(g.id) ? 'on' : ''}" data-g="${g.id}">
              <span class="eq-icon">${g.icon}</span>${g.id}<span class="eq-check">✓</span>
            </button>`).join('')}
        </div>
        ${sel.size ? `
          <div class="section-label">Your rotation — one of these ${FREQ_LABELS[freq]}</div>
          <div class="rotation-preview">
            ${rotation.map((day, i) => {
              const preview = generateWorkout(day).map(it => EXERCISE_BY_ID[it.exId].name);
              return `<div><b>Day ${i + 1}: ${esc(day.join(' & '))}</b> — ${esc(preview.slice(0, 3).join(', '))}${preview.length > 3 ? '…' : ''}</div>`;
            }).join('')}
          </div>
          <p class="subtle" style="margin-top:6px">Workouts are auto-built from your equipment each time — starting today.</p>` : ''}
        <button class="btn primary block mt" id="pl-save" ${sel.size ? '' : 'disabled'}>${existing ? 'Save plan' : 'Start plan'}</button>
        ${existing ? '<button class="btn danger-ghost block mt" id="pl-off">Turn off plan</button>' : ''}
      </div>`, {
      onOpen(root) {
        root.querySelector('#pl-x').onclick = closeModal;
        root.querySelectorAll('[data-freq]').forEach(b => b.onclick = () => { freq = +b.dataset.freq; redraw(); });
        root.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
          const id = b.dataset.g;
          sel.has(id) ? sel.delete(id) : sel.add(id);
          redraw();
        });
        root.querySelector('#pl-save').onclick = () => {
          if (!sel.size) return;
          S.plan = { enabled: true, freq, groups: [...sel], anchor: existing?.anchor ?? dayStart(Date.now()) };
          if (existing && (existing.freq !== freq)) S.plan.anchor = dayStart(Date.now());
          save(); closeModal(); go('home');
          toast('Training plan saved 🗓️');
        };
        const off = root.querySelector('#pl-off');
        if (off) off.onclick = () => { S.plan = null; save(); closeModal(); render(); toast('Plan turned off'); };
      },
    });
  };
  redraw();
}

// One-off "generate a workout" modal (Start tab)
function openGenerator() {
  let sel = new Set(S.plan?.groups?.slice(0, 2) || ['Chest', 'Back']);
  let items = null;
  const redraw = () => {
    openModal(`
      <div class="modal-head"><h2>✨ Generate workout</h2><button class="icon-btn" id="gen-x">✕</button></div>
      <div class="modal-body">
        <div class="section-label" style="margin-top:0">Pick muscle groups</div>
        <div class="group-grid">
          ${GROUP_DEFS.map(g => `
            <button class="equip-item ${sel.has(g.id) ? 'on' : ''}" data-g="${g.id}">
              <span class="eq-icon">${g.icon}</span>${g.id}<span class="eq-check">✓</span>
            </button>`).join('')}
        </div>
        ${items ? `
          <div class="section-label">Your workout (from your equipment)</div>
          <div class="card">
            ${items.map(i => {
              const ex = EXERCISE_BY_ID[i.exId];
              return `<div class="pr-row"><div class="grow"><b style="font-size:0.88rem">${esc(ex.name)}</b>
                <div class="subtle">${i.sets} × ${esc(i.reps)} · ${esc(equipShort(ex))}</div></div></div>`;
            }).join('') || '<div class="empty-state">Nothing available for that combo — add equipment in Profile.</div>'}
          </div>
          <div class="row">
            <button class="btn grow" id="gen-again" style="flex:1">🎲 Shuffle</button>
            <button class="btn primary" id="gen-start" style="flex:2" ${items.length ? '' : 'disabled'}>Start workout</button>
          </div>` : `
          <button class="btn primary block mt" id="gen-go" ${sel.size ? '' : 'disabled'}>Generate</button>`}
      </div>`, {
      onOpen(root) {
        root.querySelector('#gen-x').onclick = closeModal;
        root.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
          const id = b.dataset.g;
          sel.has(id) ? sel.delete(id) : sel.add(id);
          items = items ? generateWorkout([...sel], true) : null;
          redraw();
        });
        const go1 = root.querySelector('#gen-go');
        if (go1) go1.onclick = () => { items = generateWorkout([...sel], true); redraw(); };
        const again = root.querySelector('#gen-again');
        if (again) again.onclick = () => { items = generateWorkout([...sel], true); redraw(); };
        const st = root.querySelector('#gen-start');
        if (st) st.onclick = () => { const g = [...sel], it = items; closeModal(); startGenerated(g, it); };
      },
    });
  };
  redraw();
}

// ===================== History / PR helpers =====================
function e1rm(w, r) { return r > 0 ? w * (1 + r / 30) : w; }

// Per-exercise records from completed workouts (optionally before a timestamp).
function exerciseRecords(exId, beforeTs = Infinity) {
  let bestW = 0, bestE = 0, bestReps = 0, bestTime = 0;
  for (const w of S.workouts) {
    if (w.start >= beforeTs) continue;
    for (const en of w.entries) {
      if (en.exId !== exId) continue;
      for (const st of en.sets) {
        if (!st.done) continue;
        const wt = +st.w || 0, r = +st.r || 0;
        if (wt > bestW) bestW = wt;
        const e = e1rm(wt, r);
        if (wt && e > bestE) bestE = e;
        if (r > bestReps) bestReps = r;
        if ((+st.time || 0) > bestTime) bestTime = +st.time || 0;
      }
    }
  }
  return { bestW, bestE, bestReps, bestTime };
}

function lastPerformance(exId) {
  const sorted = [...S.workouts].sort((a, b) => b.start - a.start);
  for (const w of sorted) {
    const en = w.entries.find(e => e.exId === exId && e.sets.some(s => s.done));
    if (en) return en.sets.filter(s => s.done);
  }
  return null;
}

function workoutVolume(w) {
  let vol = 0;
  for (const en of w.entries) for (const st of en.sets) {
    if (st.done) vol += (+st.w || 0) * (+st.r || 0);
  }
  return vol;
}
function workoutSetCount(w) {
  return w.entries.reduce((n, en) => n + en.sets.filter(s => s.done).length, 0);
}

function weekKey(ts) {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7; // Monday start
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function streakWeeks() {
  if (!S.workouts.length) return 0;
  const weeks = new Set(S.workouts.map(w => weekKey(w.start)));
  let streak = 0, cur = weekKey(Date.now());
  const WEEK = 7 * 864e5;
  while (weeks.has(cur)) { streak++; cur -= WEEK; }
  return streak;
}

// ===================== Modal =====================
let modalCleanup = null;
function openModal(html, { onOpen } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet">${html}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  if (onOpen) modalCleanup = onOpen(root) || null;
}
function closeModal() {
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
  $('#modal-root').innerHTML = '';
}
function confirmModal(title, body, actionLabel, onYes, danger = true) {
  openModal(`
    <div class="modal-head"><h2>${esc(title)}</h2></div>
    <div class="modal-body">
      <p class="subtle" style="margin-bottom:16px">${esc(body)}</p>
      <button class="btn block ${danger ? 'danger-ghost' : 'primary'}" id="cf-yes">${esc(actionLabel)}</button>
      <button class="btn block ghost mt" id="cf-no">Cancel</button>
    </div>`, {
    onOpen(root) {
      root.querySelector('#cf-yes').onclick = () => { closeModal(); onYes(); };
      root.querySelector('#cf-no').onclick = closeModal;
    },
  });
}

// ===================== Charts (single-series, dark surface) =====================
const CHART = { line: '#3987e5', grid: '#2c2c2a', axis: '#383835', label: '#898781' };

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

function attachTip(wrap, show) {
  // show(clientX) -> {left, top, html} | null
  let tip = null;
  const move = e => {
    const pt = e.touches ? e.touches[0] : e;
    const res = show(pt.clientX);
    if (!res) { if (tip) { tip.remove(); tip = null; } return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; wrap.appendChild(tip); }
    tip.innerHTML = res.html;
    tip.style.left = res.left + 'px';
    tip.style.top = res.top + 'px';
  };
  const leave = () => { if (tip) { tip.remove(); tip = null; } };
  wrap.addEventListener('mousemove', move);
  wrap.addEventListener('touchstart', move, { passive: true });
  wrap.addEventListener('touchmove', move, { passive: true });
  wrap.addEventListener('mouseleave', leave);
  wrap.addEventListener('touchend', leave);
}

// Line chart: points [{label, value}]
function lineChart(container, points, valueFmt) {
  if (points.length < 2) {
    container.innerHTML = `<div class="empty-chart">Log this exercise in ${2 - points.length} more workout${points.length === 1 ? '' : 's'} to see a trend.</div>`;
    return;
  }
  const W = 340, H = 150, padL = 34, padR = 12, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = niceMax(Math.max(...points.map(p => p.value)));
  const X = i => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const Y = v => padT + ih - (v / max) * ih;

  let grid = '', yLabels = '';
  for (let g = 0; g <= 2; g++) {
    const v = (max / 2) * g, y = Y(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${CHART.grid}" stroke-width="1"/>`;
    yLabels += `<text x="${padL - 6}" y="${y + 3}" fill="${CHART.label}" font-size="8.5" text-anchor="end">${fmtNum(v)}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) =>
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="3.5" fill="${CHART.line}" stroke="#1a1a19" stroke-width="1.5"/>`).join('');
  const last = points[points.length - 1];
  const xLab = `<text x="${padL}" y="${H - 6}" fill="${CHART.label}" font-size="8.5">${esc(points[0].label)}</text>
    <text x="${W - padR}" y="${H - 6}" fill="${CHART.label}" font-size="8.5" text-anchor="end">${esc(last.label)}</text>`;
  const endLabel = `<text x="${(X(points.length - 1) - 6).toFixed(1)}" y="${(Y(last.value) - 8).toFixed(1)}" fill="#c3c2b7" font-size="9" font-weight="700" text-anchor="end">${esc(valueFmt(last.value))}</text>`;

  container.innerHTML = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img">
    ${grid}${yLabels}${xLab}
    <line id="xh" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" stroke="${CHART.axis}" stroke-width="1" opacity="0"/>
    <path d="${path}" fill="none" stroke="${CHART.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${endLabel}
  </svg></div>`;

  const wrap = container.querySelector('.chart-wrap');
  const svg = wrap.querySelector('svg');
  const xh = svg.querySelector('#xh');
  attachTip(wrap, clientX => {
    const rect = svg.getBoundingClientRect();
    const sx = (clientX - rect.left) / rect.width * W;
    if (sx < padL - 8 || sx > W - padR + 8) { xh.setAttribute('opacity', '0'); return null; }
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const d = Math.abs(X(i) - sx); if (d < bd) { bd = d; best = i; } });
    xh.setAttribute('x1', X(best)); xh.setAttribute('x2', X(best));
    xh.setAttribute('opacity', '1');
    const p = points[best];
    return {
      left: X(best) / W * rect.width,
      top: Y(p.value) / H * rect.height,
      html: `${esc(valueFmt(p.value))}<small>${esc(p.label)}</small>`,
    };
  });
  wrap.addEventListener('mouseleave', () => xh.setAttribute('opacity', '0'));
}

// Bar chart: bars [{label, value, sub}]
function barChart(container, bars, valueFmt) {
  if (!bars.some(b => b.value > 0)) {
    container.innerHTML = '<div class="empty-chart">Finish a workout to start filling this in.</div>';
    return;
  }
  const W = 340, H = 150, padL = 34, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = niceMax(Math.max(...bars.map(b => b.value)));
  const bw = iw / bars.length;
  const barW = Math.min(26, bw - 2);

  let grid = '', yLabels = '';
  for (let g = 0; g <= 2; g++) {
    const v = (max / 2) * g, y = padT + ih - (v / max) * ih;
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${CHART.grid}" stroke-width="1"/>`;
    yLabels += `<text x="${padL - 6}" y="${y + 3}" fill="${CHART.label}" font-size="8.5" text-anchor="end">${fmtNum(v)}</text>`;
  }
  const rects = bars.map((b, i) => {
    const x = padL + i * bw + (bw - barW) / 2;
    const h = Math.max(b.value > 0 ? 3 : 0, (b.value / max) * ih);
    const y = padT + ih - h;
    return `<rect data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${CHART.line}"/>`;
  }).join('');
  const labels = bars.map((b, i) => {
    if (bars.length > 8 && i % 2 !== bars.length % 2) return '';
    const x = padL + i * bw + bw / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 6}" fill="${CHART.label}" font-size="8" text-anchor="middle">${esc(b.label)}</text>`;
  }).join('');

  container.innerHTML = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img">
    ${grid}${yLabels}
    <line x1="${padL}" y1="${padT + ih}" x2="${W - padR}" y2="${padT + ih}" stroke="${CHART.axis}" stroke-width="1"/>
    ${rects}${labels}
  </svg></div>`;

  const wrap = container.querySelector('.chart-wrap');
  const svg = wrap.querySelector('svg');
  attachTip(wrap, clientX => {
    const rect = svg.getBoundingClientRect();
    const sx = (clientX - rect.left) / rect.width * W;
    const i = Math.floor((sx - padL) / bw);
    if (i < 0 || i >= bars.length) return null;
    const b = bars[i];
    const h = (b.value / max) * ih;
    return {
      left: (padL + i * bw + bw / 2) / W * rect.width,
      top: (padT + ih - h) / H * rect.height,
      html: `${esc(valueFmt(b.value))}<small>${esc(b.sub || b.label)}</small>`,
    };
  });
}

// ===================== Router =====================
let currentTab = 'home';
function go(tab) {
  currentTab = tab;
  render();
}
function render() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  const v = $('#view');
  v.scrollTop = 0; window.scrollTo(0, 0);
  stopWorkoutClock();

  if (!S.onboarded) { $('#tabbar').classList.add('hidden'); renderOnboarding(v); updateResumePill(); return; }
  $('#tabbar').classList.remove('hidden');

  switch (currentTab) {
    case 'home': renderHome(v); break;
    case 'routines': renderRoutines(v); break;
    case 'start': renderStart(v); break;
    case 'exercises': renderExercises(v); break;
    case 'profile': renderProfile(v); break;
    case 'workout': renderWorkout(v); break;
    case 'history': renderHistory(v); break;
  }
  updateResumePill();
}

function updateResumePill() {
  const pill = $('#resume-pill');
  const show = S.active && currentTab !== 'workout' && S.onboarded;
  pill.classList.toggle('hidden', !show);
  if (show) $('#resume-text').textContent = S.active.name;
}
$('#resume-pill').onclick = () => go('workout');

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    if (t.dataset.tab === 'start' && S.active) { go('workout'); return; }
    go(t.dataset.tab);
  };
});

// ===================== Onboarding =====================
let obStep = 0;
let obSel = new Set();

function renderOnboarding(v) {
  if (obStep === 0) {
    v.innerHTML = `
      <div class="onboard-hero">
        <div class="logo">🏋️</div>
        <h1>RepForge</h1>
        <p>Track your lifts, build routines, and beat your PRs — built around <b>the equipment you actually have</b>.</p>
      </div>
      <div class="section-label">Quick setup — pick what fits</div>
      ${EQUIPMENT_PRESETS.map(p => `
        <button class="card tappable preset-card" style="width:100%" data-preset="${p.id}">
          <div class="grow"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></div>
          <span style="color:var(--ink-3)">›</span>
        </button>`).join('')}
      <button class="btn block mt" id="ob-custom">Or pick equipment one by one</button>`;
    v.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      const p = EQUIPMENT_PRESETS.find(x => x.id === b.dataset.preset);
      obSel = new Set(p.ids);
      obStep = 1; render();
    });
    v.querySelector('#ob-custom').onclick = () => { obSel = new Set(); obStep = 1; render(); };
    return;
  }
  // Step 1: fine-tune equipment
  v.innerHTML = `
    <div class="view-header">
      <button class="icon-btn" id="ob-back">‹</button>
      <h1>Your equipment</h1>
    </div>
    <p class="subtle" style="margin-bottom:6px">Tap everything you have access to. Exercises and routines will be filtered to match. You can change this anytime in Profile.</p>
    ${renderEquipGrid(obSel)}
    <div style="height:70px"></div>
    <div class="sticky-cta no-tabbar">
      <button class="btn primary block" id="ob-done">Start training (<span id="ob-count">${countAvailable(obSel)}</span> exercises unlocked)</button>
    </div>`;
  v.querySelector('#ob-back').onclick = () => { obStep = 0; render(); };
  bindEquipGrid(v, obSel, () => {
    v.querySelector('#ob-count').textContent = countAvailable(obSel);
  });
  v.querySelector('#ob-done').onclick = () => {
    S.equipment = [...obSel];
    S.onboarded = true;
    save();
    go('home');
    toast('Setup complete. Time to lift! 💪');
  };
}

function countAvailable(sel) {
  const has = id => sel.has(id);
  return EXERCISES.filter(ex => ex.eq.every(r => Array.isArray(r) ? r.some(has) : has(r))).length;
}

function renderEquipGrid(sel) {
  return EQUIPMENT_GROUPS.map(g => `
    <div class="section-label">${esc(g.name)}</div>
    <div class="equip-grid">
      ${g.items.map(i => `
        <button class="equip-item ${sel.has(i.id) ? 'on' : ''}" data-eq="${i.id}">
          <span class="eq-icon">${i.icon}</span>${esc(i.name)}<span class="eq-check">✓</span>
        </button>`).join('')}
    </div>`).join('');
}
function bindEquipGrid(root, sel, onChange) {
  root.querySelectorAll('[data-eq]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.eq;
      if (sel.has(id)) { sel.delete(id); b.classList.remove('on'); }
      else { sel.add(id); b.classList.add('on'); }
      onChange && onChange();
    };
  });
}

// ===================== Home =====================
function renderHome(v) {
  const now = Date.now();
  const wkStart = weekKey(now);
  const thisWeek = S.workouts.filter(w => w.start >= wkStart);
  const weekVol = thisWeek.reduce((n, w) => n + workoutVolume(w), 0);
  const streak = streakWeeks();

  // Weekly volume, last 8 weeks
  const WEEK = 7 * 864e5;
  const bars = [];
  for (let i = 7; i >= 0; i--) {
    const k = wkStart - i * WEEK;
    const vol = S.workouts.filter(w => weekKey(w.start) === k).reduce((n, w) => n + workoutVolume(w), 0);
    const d = new Date(k);
    bars.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, value: vol, sub: 'week of ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }

  const recent = [...S.workouts].sort((a, b) => b.start - a.start).slice(0, 3);
  const prs = collectRecentPRs().slice(0, 4);

  const pi = planInfo();
  const todayItems = pi?.isDay && !pi.doneToday ? generateWorkout(pi.todayGroups) : null;
  let planHtml;
  if (!pi) {
    planHtml = `
      <button class="card tappable" id="plan-setup" style="width:100%;text-align:left">
        <div class="row"><span class="plan-emoji" style="font-size:1.5rem">🗓️</span>
          <div class="grow"><b>Set up a training plan</b>
            <div class="subtle">Train every other day (or your pick) — RepForge auto-builds each workout from the muscle groups you choose.</div>
          </div><span style="color:var(--ink-3)">›</span></div>
      </button>`;
  } else if (pi.isDay && !pi.doneToday) {
    planHtml = `
      <div class="card plan-card">
        <div class="row">
          <div class="grow"><b>💪 Today: ${esc(pi.todayGroups.join(' & '))}</b>
            <div class="subtle">${todayItems.length} exercises · training ${esc(pi.freqLabel)}</div></div>
          <button class="btn sm ghost" id="plan-edit">Edit</button>
        </div>
        <div class="hist-sets subtle">${esc(todayItems.map(i => EXERCISE_BY_ID[i.exId].name).join(', '))}</div>
        <button class="btn primary block mt" id="plan-start">Start today's workout</button>
      </div>`;
  } else if (pi.isDay && pi.doneToday) {
    planHtml = `
      <div class="card plan-card">
        <div class="row">
          <div class="grow"><b>✅ Done for today!</b>
            <div class="subtle">Next: ${esc(pi.nextGroups.join(' & '))} on ${fmtDate(pi.nextTs)}</div></div>
          <button class="btn sm ghost" id="plan-edit">Edit</button>
        </div>
      </div>`;
  } else {
    planHtml = `
      <div class="card plan-rest">
        <div class="row">
          <div class="grow"><b>😴 Rest day</b>
            <div class="subtle">Next workout: ${esc(pi.nextGroups.join(' & '))} on ${fmtDate(pi.nextTs)}</div></div>
          <button class="btn sm ghost" id="plan-edit">Edit</button>
        </div>
      </div>`;
  }

  v.innerHTML = `
    <div class="view-header">
      <div>
        <h1>RepForge</h1>
        <div class="subtle">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
      <button class="icon-btn" id="home-settings" title="Settings">⚙</button>
    </div>

    ${planHtml}

    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-value">${thisWeek.length}</div><div class="stat-label">Workouts this week</div></div>
      <div class="stat-tile"><div class="stat-value">${fmtNum(weekVol)}</div><div class="stat-label">${esc(unit())} lifted this week</div></div>
      <div class="stat-tile"><div class="stat-value">${streak}🔥</div><div class="stat-label">Week streak</div></div>
    </div>

    <div class="section-label">Weekly volume (${esc(unit())})</div>
    <div class="chart-card"><div id="home-chart"></div></div>

    ${prs.length ? `
      <div class="section-label">Recent PRs</div>
      <div class="card">${prs.map(p => `
        <div class="pr-row"><span class="medal">🏆</span>
          <div class="grow"><b style="font-size:0.9rem">${esc(p.name)}</b><div class="subtle">${esc(p.detail)}</div></div>
          <span class="subtle">${fmtDate(p.date)}</span>
        </div>`).join('')}
      </div>` : ''}

    <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
      <span>Recent workouts</span>
      ${S.workouts.length ? '<button class="btn ghost sm" id="see-history">View all ›</button>' : ''}
    </div>
    ${recent.length ? recent.map(w => historyCard(w)).join('') : `
      <div class="empty-state"><div class="big">🏋️</div>No workouts yet.<br>Hit the <b>+</b> button to log your first one!</div>`}
  `;
  barChart(v.querySelector('#home-chart'), bars, x => `${fmtNum(x)} ${unit()}`);
  const setup = v.querySelector('#plan-setup');
  if (setup) setup.onclick = openPlanEditor;
  const planEdit = v.querySelector('#plan-edit');
  if (planEdit) planEdit.onclick = openPlanEditor;
  const planStart = v.querySelector('#plan-start');
  if (planStart) planStart.onclick = () => startGenerated(pi.todayGroups, todayItems);
  v.querySelector('#home-settings').onclick = () => go('profile');
  const hist = v.querySelector('#see-history');
  if (hist) hist.onclick = () => go('history');
  bindHistoryCards(v);
}

function collectRecentPRs() {
  const out = [];
  const sorted = [...S.workouts].sort((a, b) => b.start - a.start).slice(0, 10);
  for (const w of sorted) {
    for (const en of w.entries) {
      const ex = EXERCISE_BY_ID[en.exId];
      if (!ex) continue;
      const prev = exerciseRecords(en.exId, w.start);
      let best = null;
      for (const st of en.sets) {
        if (!st.done) continue;
        const wt = +st.w || 0, r = +st.r || 0;
        if (ex.t === 'wr' && wt > prev.bestW && wt > 0) best = `${wt} ${unit()} × ${r} — new best weight`;
        else if (ex.t === 'r' && r > prev.bestReps && r > 0) best = `${r} reps — new rep record`;
      }
      if (best) out.push({ name: ex.name, detail: best, date: w.start });
    }
  }
  return out;
}

// ===================== History =====================
function historyCard(w) {
  const vol = workoutVolume(w);
  const sets = workoutSetCount(w);
  const names = w.entries.map(en => EXERCISE_BY_ID[en.exId]?.name || '?').slice(0, 4);
  return `
    <div class="card tappable" data-hist="${w.id}">
      <div class="row">
        <div class="grow">
          <b>${esc(w.name)}</b>
          <div class="subtle">${fmtDate(w.start)} · ${fmtDur(w.end - w.start)} · ${sets} sets${vol ? ` · ${fmtNum(vol)} ${esc(unit())}` : ''}</div>
        </div>
        <span style="color:var(--ink-3)">›</span>
      </div>
      <div class="hist-sets subtle">${esc(names.join(', '))}${w.entries.length > 4 ? '…' : ''}</div>
    </div>`;
}
function bindHistoryCards(v) {
  v.querySelectorAll('[data-hist]').forEach(c => c.onclick = () => openWorkoutDetail(c.dataset.hist));
}

function renderHistory(v) {
  const sorted = [...S.workouts].sort((a, b) => b.start - a.start);
  v.innerHTML = `
    <div class="view-header">
      <button class="icon-btn" id="hist-back">‹</button>
      <h1>History</h1>
    </div>
    ${sorted.length ? sorted.map(w => historyCard(w)).join('') : '<div class="empty-state"><div class="big">📭</div>Nothing here yet.</div>'}`;
  v.querySelector('#hist-back').onclick = () => go('home');
  bindHistoryCards(v);
}

function openWorkoutDetail(id) {
  const w = S.workouts.find(x => x.id === id);
  if (!w) return;
  openModal(`
    <div class="modal-head">
      <h2>${esc(w.name)}</h2>
      <button class="icon-btn" id="wd-del" title="Delete">🗑</button>
      <button class="icon-btn" id="wd-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="subtle" style="margin-bottom:12px">${fmtDate(w.start)} · ${fmtDur(w.end - w.start)} · ${fmtNum(workoutVolume(w))} ${esc(unit())} total</div>
      ${w.entries.map(en => {
        const ex = EXERCISE_BY_ID[en.exId];
        return `<div class="card">
          <b style="color:var(--accent)">${esc(ex?.name || '?')}</b>
          <div class="hist-sets">
            ${en.sets.map((s, i) => s.done ? `<div>Set ${i + 1}: <b>${setLabel(ex, s)}</b></div>` : '').join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`, {
    onOpen(root) {
      root.querySelector('#wd-x').onclick = closeModal;
      root.querySelector('#wd-del').onclick = () => {
        confirmModal('Delete workout?', 'This removes it from your history and stats. This can\'t be undone.', 'Delete', () => {
          S.workouts = S.workouts.filter(x => x.id !== id);
          save(); render();
        });
      };
    },
  });
}

function setLabel(ex, s) {
  if (!ex) return '';
  if (ex.t === 't') return fmtClock(+s.time || 0) + ' min:sec';
  if (ex.t === 'r' && !(+s.w)) return `${+s.r || 0} reps`;
  return `${+s.w || 0} ${unit()} × ${+s.r || 0}`;
}

// ===================== Exercises tab =====================
let exFilter = { q: '', muscle: 'All', onlyAvail: true };

function renderExercises(v) {
  v.innerHTML = `
    <div class="view-header"><h1>Exercises</h1>
      <button class="chip ${exFilter.onlyAvail ? 'active' : ''}" id="avail-toggle">My equipment</button>
    </div>
    <div class="search-bar"><input type="search" id="ex-q" placeholder="Search exercises…" value="${esc(exFilter.q)}"></div>
    <div class="chip-row" id="muscle-chips">
      ${['All', ...MUSCLES].map(m => `<button class="chip ${exFilter.muscle === m ? 'active' : ''}" data-m="${m}">${m}</button>`).join('')}
    </div>
    <div id="ex-list"></div>`;

  const list = v.querySelector('#ex-list');
  const draw = () => {
    const q = exFilter.q.toLowerCase();
    let items = EXERCISES.filter(ex =>
      (exFilter.muscle === 'All' || ex.m === exFilter.muscle || ex.sec.includes(exFilter.muscle)) &&
      (!q || ex.name.toLowerCase().includes(q)));
    if (exFilter.onlyAvail) items = items.filter(canDo);
    items.sort((a, b) => (canDo(b) - canDo(a)) || a.name.localeCompare(b.name));
    list.innerHTML = items.length ? items.map(ex => exRowHtml(ex)).join('')
      : '<div class="empty-state">No exercises match. Try adding more equipment in Profile.</div>';
    list.querySelectorAll('[data-ex]').forEach(r => r.onclick = () => openExerciseDetail(r.dataset.ex));
  };
  draw();

  v.querySelector('#ex-q').oninput = e => { exFilter.q = e.target.value; draw(); };
  v.querySelector('#avail-toggle').onclick = e => {
    exFilter.onlyAvail = !exFilter.onlyAvail;
    e.target.classList.toggle('active', exFilter.onlyAvail);
    draw();
  };
  v.querySelectorAll('#muscle-chips .chip').forEach(c => c.onclick = () => {
    exFilter.muscle = c.dataset.m;
    v.querySelectorAll('#muscle-chips .chip').forEach(x => x.classList.toggle('active', x.dataset.m === exFilter.muscle));
    draw();
  });
}

function exRowHtml(ex, extra = '') {
  const ok = canDo(ex);
  const missing = ok ? [] : missingFor(ex);
  return `
    <button class="ex-row ${ok ? '' : 'unavailable'}" data-ex="${ex.id}">
      <span class="ex-avatar">${esc(ex.m.slice(0, 2).toUpperCase())}</span>
      <span class="grow">
        <b>${esc(ex.name)}</b>
        <small>${esc(ex.m)} · ${esc(equipShort(ex))}</small>
        ${missing.length ? `<div><span class="tag missing">needs ${esc(missing.join(', '))}</span></div>` : ''}
      </span>${extra}
    </button>`;
}

function openExerciseDetail(exId) {
  const ex = EXERCISE_BY_ID[exId];
  const rec = exerciseRecords(exId);
  const isWr = ex.t === 'wr';

  // Best e1RM (or reps) per workout, oldest → newest
  const points = [];
  [...S.workouts].sort((a, b) => a.start - b.start).forEach(w => {
    let best = 0;
    for (const en of w.entries) {
      if (en.exId !== exId) continue;
      for (const s of en.sets) {
        if (!s.done) continue;
        const val = isWr ? e1rm(+s.w || 0, +s.r || 0) : (ex.t === 'r' ? (+s.r || 0) : (+s.time || 0));
        if (val > best) best = val;
      }
    }
    if (best > 0) points.push({ label: fmtDate(w.start), value: Math.round(best) });
  });

  const last = lastPerformance(exId);
  openModal(`
    <div class="modal-head"><h2>${esc(ex.name)}</h2><button class="icon-btn" id="exd-x">✕</button></div>
    <div class="modal-body">
      <div style="margin-bottom:10px">
        <span class="tag accent">${esc(ex.m)}</span>
        ${ex.sec.map(s => `<span class="tag">${esc(s)}</span>`).join(' ')}
        <span class="tag">${esc(equipShort(ex))}</span>
        ${canDo(ex) ? '' : `<span class="tag missing">needs ${esc(missingFor(ex).join(', '))}</span>`}
      </div>
      <div class="stat-grid" style="margin-bottom:12px">
        <div class="stat-tile"><div class="stat-value">${isWr ? (rec.bestW || '—') : (ex.t === 'r' ? (rec.bestReps || '—') : (rec.bestTime ? fmtClock(rec.bestTime) : '—'))}</div>
          <div class="stat-label">${isWr ? 'Best ' + esc(unit()) : ex.t === 'r' ? 'Best reps' : 'Best time'}</div></div>
        <div class="stat-tile"><div class="stat-value">${isWr && rec.bestE ? Math.round(rec.bestE) : '—'}</div><div class="stat-label">Est. 1RM</div></div>
        <div class="stat-tile"><div class="stat-value">${points.length}</div><div class="stat-label">Sessions</div></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">${isWr ? 'Estimated 1RM over time' : ex.t === 'r' ? 'Best reps over time' : 'Best time over time'}</div>
        <div class="chart-sub">Best set from each workout</div>
        <div id="exd-chart"></div>
      </div>
      ${last ? `<div class="section-label">Last time</div><div class="card hist-sets">
        ${last.map((s, i) => `<div>Set ${i + 1}: <b>${setLabel(ex, s)}</b></div>`).join('')}
      </div>` : ''}
    </div>`, {
    onOpen(root) {
      root.querySelector('#exd-x').onclick = closeModal;
      lineChart(root.querySelector('#exd-chart'), points,
        x => isWr ? `${x} ${unit()}` : ex.t === 'r' ? `${x} reps` : fmtClock(x));
    },
  });
}

// ===================== Routines =====================
function renderRoutines(v) {
  v.innerHTML = `
    <div class="view-header"><h1>Routines</h1>
      <button class="btn sm primary" id="new-routine">+ New</button>
    </div>

    ${S.routines.length ? `<div class="section-label">My routines</div>` +
      S.routines.map(r => `
        <div class="card tappable" data-routine="${r.id}">
          <div class="row">
            <div class="grow">
              <b>${esc(r.name)}</b>
              <div class="subtle">${r.items.length} exercises · ${r.items.reduce((n, i) => n + i.sets, 0)} sets</div>
            </div>
            <button class="icon-btn" data-start-r="${r.id}" title="Start">▶</button>
          </div>
          <div class="hist-sets subtle">${esc(r.items.slice(0, 4).map(i => EXERCISE_BY_ID[i.exId]?.name || '?').join(', '))}${r.items.length > 4 ? '…' : ''}</div>
        </div>`).join('')
      : ''}

    <div class="section-label">Smart templates — adapted to your equipment</div>
    <p class="subtle" style="margin-bottom:8px">These programs automatically swap in exercises you can do with your gear (${S.equipment.length ? esc(S.equipment.map(id => EQUIPMENT_BY_ID[id].name).join(', ')) : 'bodyweight only'}).</p>
    ${ROUTINE_TEMPLATES.map(t => `
      <div class="card tappable" data-template="${t.id}">
        <b>${esc(t.name)}</b>
        <div class="subtle">${esc(t.desc)} · ${t.days.length} day${t.days.length > 1 ? 's' : ''}</div>
      </div>`).join('')}`;

  v.querySelector('#new-routine').onclick = () => openRoutineEditor(null);
  v.querySelectorAll('[data-routine]').forEach(c => c.onclick = e => {
    if (e.target.closest('[data-start-r]')) return;
    openRoutineEditor(c.dataset.routine);
  });
  v.querySelectorAll('[data-start-r]').forEach(b => b.onclick = () => startFromRoutine(b.dataset.startR));
  v.querySelectorAll('[data-template]').forEach(c => c.onclick = () => openTemplatePreview(c.dataset.template));
}

function openTemplatePreview(tid) {
  const t = ROUTINE_TEMPLATES.find(x => x.id === tid);
  const resolved = t.days.map(d => ({ name: d.name, ...resolveTemplateDay(d) }));
  const totalSkipped = resolved.reduce((n, d) => n + d.skipped, 0);
  openModal(`
    <div class="modal-head"><h2>${esc(t.name)}</h2><button class="icon-btn" id="tp-x">✕</button></div>
    <div class="modal-body">
      <p class="subtle" style="margin-bottom:10px">${esc(t.desc)} Exercises below were picked for <b>your equipment</b>.
      ${totalSkipped ? `<span class="tag missing">${totalSkipped} slot${totalSkipped > 1 ? 's' : ''} skipped — no matching gear</span>` : ''}</p>
      ${resolved.map((d, di) => `
        <div class="card">
          <div class="row" style="margin-bottom:6px">
            <b class="grow">${esc(d.name)}</b>
            <button class="btn sm primary" data-add-day="${di}">Save as routine</button>
          </div>
          ${d.items.map(i => {
            const ex = EXERCISE_BY_ID[i.exId];
            return `<div class="pr-row"><div class="grow"><b style="font-size:0.88rem">${esc(ex.name)}</b>
              <div class="subtle">${i.sets} × ${esc(i.reps)} · ${esc(equipShort(ex))}</div></div></div>`;
          }).join('')}
        </div>`).join('')}
      <button class="btn primary block mt" id="tp-add-all">Save all ${t.days.length} days as routines</button>
    </div>`, {
    onOpen(root) {
      root.querySelector('#tp-x').onclick = closeModal;
      const saveDay = di => {
        const d = resolved[di];
        S.routines.push({ id: uid(), name: d.name, items: d.items.map(i => ({ ...i })) });
      };
      root.querySelectorAll('[data-add-day]').forEach(b => b.onclick = () => {
        saveDay(+b.dataset.addDay);
        save(); closeModal(); go('routines');
        toast('Routine saved ✓');
      });
      root.querySelector('#tp-add-all').onclick = () => {
        resolved.forEach((_, di) => saveDay(di));
        save(); closeModal(); go('routines');
        toast(`${t.days.length} routines saved ✓`);
      };
    },
  });
}

// Routine editor (create or edit)
function openRoutineEditor(rid) {
  const existing = rid ? S.routines.find(r => r.id === rid) : null;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), name: '', items: [] };

  const redraw = () => {
    openModal(`
      <div class="modal-head">
        <h2>${existing ? 'Edit routine' : 'New routine'}</h2>
        ${existing ? '<button class="icon-btn" id="re-del">🗑</button>' : ''}
        <button class="icon-btn" id="re-x">✕</button>
      </div>
      <div class="modal-body">
        <input type="text" id="re-name" placeholder="Routine name (e.g. Push Day)" value="${esc(draft.name)}" style="margin-bottom:12px">
        ${draft.items.map((i, idx) => {
          const ex = EXERCISE_BY_ID[i.exId];
          return `<div class="card">
            <div class="row">
              <div class="grow"><b style="font-size:0.9rem">${esc(ex.name)}</b><div class="subtle">${esc(ex.m)}</div></div>
              <button class="icon-btn" data-rm="${idx}">✕</button>
            </div>
            <div class="row mt">
              <label class="subtle">Sets <input type="number" data-sets="${idx}" value="${i.sets}" min="1" max="10" style="width:64px;margin-left:6px"></label>
              <label class="subtle">Reps <input type="text" data-reps="${idx}" value="${esc(i.reps)}" style="width:82px;margin-left:6px"></label>
            </div>
          </div>`;
        }).join('')}
        <button class="btn block" id="re-add">+ Add exercise</button>
        <button class="btn primary block mt" id="re-save" ${draft.items.length ? '' : 'disabled'}>Save routine</button>
      </div>`, {
      onOpen(root) {
        root.querySelector('#re-x').onclick = closeModal;
        root.querySelector('#re-name').oninput = e => { draft.name = e.target.value; };
        root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { draft.items.splice(+b.dataset.rm, 1); redraw(); });
        root.querySelectorAll('[data-sets]').forEach(inp => inp.oninput = () => { draft.items[+inp.dataset.sets].sets = Math.max(1, +inp.value || 1); });
        root.querySelectorAll('[data-reps]').forEach(inp => inp.oninput = () => { draft.items[+inp.dataset.reps].reps = inp.value; });
        root.querySelector('#re-add').onclick = () => openExercisePicker(ex => {
          draft.items.push({ exId: ex.id, sets: 3, reps: ex.t === 't' ? '30-60s' : '8-12' });
          redraw();
        }, redraw);
        const del = root.querySelector('#re-del');
        if (del) del.onclick = () => confirmModal('Delete routine?', `"${draft.name}" will be removed. Your workout history stays.`, 'Delete', () => {
          S.routines = S.routines.filter(r => r.id !== rid);
          save(); go('routines');
        });
        root.querySelector('#re-save').onclick = () => {
          if (!draft.items.length) return;
          draft.name = draft.name.trim() || 'My Routine';
          if (existing) {
            const i = S.routines.findIndex(r => r.id === rid);
            S.routines[i] = draft;
          } else {
            S.routines.push(draft);
          }
          save(); closeModal(); go('routines');
          toast('Routine saved ✓');
        };
      },
    });
  };
  redraw();
}

// Exercise picker modal — filtered to available by default
function openExercisePicker(onPick, onBack) {
  let q = '', muscle = 'All', onlyAvail = true;
  const redraw = () => {
    const ql = q.toLowerCase();
    let items = EXERCISES.filter(ex =>
      (muscle === 'All' || ex.m === muscle || ex.sec.includes(muscle)) &&
      (!ql || ex.name.toLowerCase().includes(ql)));
    if (onlyAvail) items = items.filter(canDo);
    items.sort((a, b) => (canDo(b) - canDo(a)) || a.name.localeCompare(b.name));

    openModal(`
      <div class="modal-head"><h2>Pick exercise</h2>
        <button class="chip ${onlyAvail ? 'active' : ''}" id="ep-avail">My equipment</button>
        <button class="icon-btn" id="ep-x">✕</button>
      </div>
      <div class="modal-body">
        <div class="search-bar"><input type="search" id="ep-q" placeholder="Search…" value="${esc(q)}"></div>
        <div class="chip-row">
          ${['All', ...MUSCLES].map(m => `<button class="chip ${muscle === m ? 'active' : ''}" data-m="${m}">${m}</button>`).join('')}
        </div>
        ${items.map(ex => exRowHtml(ex)).join('') || '<div class="empty-state">Nothing matches.</div>'}
      </div>`, {
      onOpen(root) {
        root.querySelector('#ep-x').onclick = () => { closeModal(); onBack && onBack(); };
        const qi = root.querySelector('#ep-q');
        qi.oninput = e => { q = e.target.value; redraw(); setTimeout(() => { const n = $('#ep-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); };
        root.querySelector('#ep-avail').onclick = () => { onlyAvail = !onlyAvail; redraw(); };
        root.querySelectorAll('[data-m]').forEach(c => c.onclick = () => { muscle = c.dataset.m; redraw(); });
        root.querySelectorAll('[data-ex]').forEach(r => r.onclick = () => {
          closeModal();
          onPick(EXERCISE_BY_ID[r.dataset.ex]);
        });
      },
    });
  };
  redraw();
}

// ===================== Start tab =====================
function renderStart(v) {
  v.innerHTML = `
    <div class="view-header"><h1>Start workout</h1></div>
    <button class="btn primary block" id="start-empty" style="padding:16px">🏁 Start empty workout</button>
    <button class="btn block mt" id="start-gen" style="padding:16px">✨ Generate a workout — pick muscle groups</button>
    ${S.routines.length ? `<div class="section-label">From a routine</div>` +
      S.routines.map(r => `
        <button class="card tappable" style="width:100%;text-align:left" data-start-r="${r.id}">
          <div class="row">
            <div class="grow"><b>${esc(r.name)}</b>
              <div class="subtle">${r.items.length} exercises · ${esc(r.items.slice(0, 3).map(i => EXERCISE_BY_ID[i.exId]?.name || '?').join(', '))}${r.items.length > 3 ? '…' : ''}</div>
            </div><span style="color:var(--accent);font-weight:800">▶</span>
          </div>
        </button>`).join('')
      : `<p class="subtle mt">Tip: build a routine first (or grab a smart template) and it'll show up here for one-tap starts.</p>`}`;
  v.querySelector('#start-empty').onclick = () => startWorkout('Workout', []);
  v.querySelector('#start-gen').onclick = openGenerator;
  v.querySelectorAll('[data-start-r]').forEach(b => b.onclick = () => startFromRoutine(b.dataset.startR));
}

function parseTargetReps(repsStr) {
  const m = /^(\d+)/.exec(String(repsStr || ''));
  return m ? m[1] : '';
}

function startFromRoutine(rid) {
  const r = S.routines.find(x => x.id === rid);
  if (!r) return;
  const entries = r.items.map(i => makeEntry(i.exId, i.sets, i.reps));
  startWorkout(r.name, entries, rid);
}

function makeEntry(exId, setCount = 3, reps = '') {
  const prev = lastPerformance(exId) || [];
  const sets = [];
  for (let i = 0; i < setCount; i++) {
    const p = prev[i] || prev[prev.length - 1];
    sets.push({
      w: '', r: '', time: '', done: false,
      pw: p ? p.w : '', pr: p ? p.r : '', pt: p ? p.time : '',
      target: parseTargetReps(reps),
    });
  }
  return { exId, targetReps: reps, sets };
}

function startWorkout(name, entries, routineId = null) {
  if (S.active) { go('workout'); return; }
  S.active = { id: uid(), name, routineId, start: Date.now(), entries };
  save();
  go('workout');
}

// ===================== Active workout =====================
let clockInt = null;
function stopWorkoutClock() { if (clockInt) { clearInterval(clockInt); clockInt = null; } }

function renderWorkout(v) {
  const w = S.active;
  if (!w) { go('start'); return; }

  v.innerHTML = `
    <div class="workout-topbar">
      <div class="grow">
        <input type="text" id="w-name" value="${esc(w.name)}" style="background:transparent;border:none;padding:0;font-weight:800;font-size:1.05rem">
        <div class="workout-timer subtle" id="w-clock">0:00</div>
      </div>
      <button class="btn sm danger-ghost" id="w-cancel">Discard</button>
      <button class="btn sm good" id="w-finish">Finish</button>
    </div>
    <div id="w-entries">${w.entries.map((en, ei) => entryCard(en, ei)).join('')}</div>
    <button class="btn block mt" id="w-add">+ Add exercise</button>`;

  const clock = v.querySelector('#w-clock');
  const tick = () => { clock.textContent = fmtDur(Date.now() - w.start); };
  tick();
  clockInt = setInterval(tick, 1000);

  v.querySelector('#w-name').oninput = e => { w.name = e.target.value; save(); };
  v.querySelector('#w-add').onclick = () => openExercisePicker(ex => {
    w.entries.push(makeEntry(ex.id));
    save(); render();
  });
  v.querySelector('#w-cancel').onclick = () =>
    confirmModal('Discard workout?', 'All sets from this session will be lost.', 'Discard', () => {
      S.active = null; save(); stopRest(); go('home');
    });
  v.querySelector('#w-finish').onclick = finishWorkout;

  bindWorkoutEvents(v);
}

function entryCard(en, ei) {
  const ex = EXERCISE_BY_ID[en.exId];
  const isTime = ex.t === 't';
  const showW = ex.t === 'wr';
  return `
    <div class="card wx-card" data-entry="${ei}">
      <div class="wx-head">
        <button class="wx-name" data-exinfo="${ex.id}" style="text-align:left">${esc(ex.name)}</button>
        <button class="icon-btn" data-swap="${ei}" title="Swap exercise">⇄</button>
        <button class="icon-btn" data-rment="${ei}" title="Remove">✕</button>
      </div>
      <div class="subtle" style="font-size:0.75rem;margin-bottom:4px">${esc(ex.m)} · ${esc(equipShort(ex))}${en.targetReps ? ` · target ${esc(String(en.targetReps))} reps` : ''}</div>
      <table class="set-table">
        <thead><tr>
          <th>Set</th><th>Prev</th>
          ${isTime ? '<th>Time (s)</th>' : `${showW ? `<th>${esc(unit())}</th>` : ''}<th>Reps</th>`}
          <th>✓</th>
        </tr></thead>
        <tbody>
          ${en.sets.map((s, si) => `
            <tr class="set-row ${s.done ? 'done' : ''}" data-set="${si}">
              <td class="set-num">${si + 1}</td>
              <td class="prev-col">${prevLabel(ex, s)}</td>
              ${isTime
                ? `<td><input type="number" inputmode="numeric" class="in-w" data-f="time" value="${esc(s.time)}" placeholder="${esc(s.pt || s.target || '60')}"></td>`
                : `${showW ? `<td><input type="number" inputmode="decimal" class="in-w" data-f="w" value="${esc(s.w)}" placeholder="${esc(s.pw || '0')}"></td>` : ''}
                   <td><input type="number" inputmode="numeric" class="in-r" data-f="r" value="${esc(s.r)}" placeholder="${esc(s.pr || s.target || '0')}"></td>`}
              <td><button class="set-check" data-check>✓</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn sm block mt" data-addset="${ei}">+ Add set</button>
    </div>`;
}

function prevLabel(ex, s) {
  if (ex.t === 't') return s.pt ? fmtClock(+s.pt) : '—';
  if (ex.t === 'r' && !s.pw) return s.pr ? `${s.pr} reps` : '—';
  return s.pw ? `${s.pw}×${s.pr}` : '—';
}

function bindWorkoutEvents(v) {
  const w = S.active;

  v.querySelectorAll('[data-exinfo]').forEach(b => b.onclick = () => openExerciseDetail(b.dataset.exinfo));

  v.querySelectorAll('[data-entry] input[data-f]').forEach(inp => {
    inp.oninput = () => {
      if (+inp.value < 0) inp.value = inp.value.replace('-', '');
      const ei = +inp.closest('[data-entry]').dataset.entry;
      const si = +inp.closest('[data-set]').dataset.set;
      w.entries[ei].sets[si][inp.dataset.f] = inp.value;
      save();
    };
  });

  v.querySelectorAll('[data-check]').forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest('[data-set]');
      const ei = +btn.closest('[data-entry]').dataset.entry;
      const si = +row.dataset.set;
      const en = w.entries[ei];
      const s = en.sets[si];
      const ex = EXERCISE_BY_ID[en.exId];
      s.done = !s.done;
      if (s.done) {
        // Auto-fill blanks: earlier set from this session, then last workout, then target
        const lastDone = en.sets.slice(0, si).reverse().find(x => x.done);
        if (ex.t === 't') { if (!s.time) s.time = lastDone?.time || s.pt || s.target || '60'; }
        else {
          if (ex.t === 'wr' && !s.w) s.w = lastDone?.w || s.pw || '0';
          if (!s.r) s.r = lastDone?.r || s.pr || s.target || '0';
        }
        startRest(S.settings.restSec);
        maybePrToast(ex, s, w.start);
      }
      save(); render();
    };
  });

  v.querySelectorAll('[data-addset]').forEach(b => b.onclick = () => {
    const en = w.entries[+b.dataset.addset];
    const lastSet = en.sets[en.sets.length - 1];
    en.sets.push({ w: '', r: '', time: '', done: false, pw: lastSet?.pw || '', pr: lastSet?.pr || '', pt: lastSet?.pt || '', target: lastSet?.target || '' });
    save(); render();
  });

  v.querySelectorAll('[data-rment]').forEach(b => b.onclick = () => {
    w.entries.splice(+b.dataset.rment, 1);
    save(); render();
  });

  v.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => {
    const ei = +b.dataset.swap;
    const cur = EXERCISE_BY_ID[w.entries[ei].exId];
    openSwapPicker(cur, ex => {
      const old = w.entries[ei];
      w.entries[ei] = makeEntry(ex.id, old.sets.length, old.targetReps);
      save(); render();
      toast(`Swapped to ${esc(ex.name)}`);
    });
  });
}

// Swap picker: same movement pattern first, then same muscle.
function openSwapPicker(cur, onPick) {
  const inWorkout = new Set(S.active.entries.map(e => e.exId));
  const samePattern = EXERCISES.filter(e => e.p === cur.p && e.id !== cur.id && canDo(e) && !inWorkout.has(e.id));
  const sameMuscle = EXERCISES.filter(e => e.p !== cur.p && e.m === cur.m && e.id !== cur.id && canDo(e) && !inWorkout.has(e.id));
  openModal(`
    <div class="modal-head"><h2>Swap ${esc(cur.name)}</h2><button class="icon-btn" id="sw-x">✕</button></div>
    <div class="modal-body">
      ${samePattern.length ? `<div class="section-label" style="margin-top:0">Same movement</div>` + samePattern.map(e => exRowHtml(e)).join('') : ''}
      ${sameMuscle.length ? `<div class="section-label">Same muscle (${esc(cur.m)})</div>` + sameMuscle.map(e => exRowHtml(e)).join('') : ''}
      ${!samePattern.length && !sameMuscle.length ? '<div class="empty-state">No alternatives available with your equipment.</div>' : ''}
    </div>`, {
    onOpen(root) {
      root.querySelector('#sw-x').onclick = closeModal;
      root.querySelectorAll('[data-ex]').forEach(r => r.onclick = () => { closeModal(); onPick(EXERCISE_BY_ID[r.dataset.ex]); });
    },
  });
}

function maybePrToast(ex, s, beforeTs) {
  const prev = exerciseRecords(ex.id, beforeTs);
  const wt = +s.w || 0, r = +s.r || 0;
  if (ex.t === 'wr' && wt > 0 && wt > prev.bestW) toast(`🏆 New ${esc(ex.name)} PR: ${wt} ${esc(unit())}!`, 'pr');
  else if (ex.t === 'r' && r > 0 && r > prev.bestReps) toast(`🏆 Rep PR on ${esc(ex.name)}: ${r} reps!`, 'pr');
}

function finishWorkout() {
  const w = S.active;
  const doneSets = w.entries.reduce((n, en) => n + en.sets.filter(s => s.done).length, 0);
  if (!doneSets) {
    confirmModal('No sets completed', 'Check off at least one set, or discard the workout.', 'Discard workout', () => {
      S.active = null; save(); stopRest(); go('home');
    });
    return;
  }
  const finished = {
    id: w.id, name: w.name.trim() || 'Workout', routineId: w.routineId,
    start: w.start, end: Date.now(),
    entries: w.entries
      .map(en => ({ exId: en.exId, sets: en.sets.filter(s => s.done).map(s => ({ w: s.w, r: s.r, time: s.time, done: true })) }))
      .filter(en => en.sets.length),
  };

  // Count PRs vs history before this workout
  let prCount = 0;
  for (const en of finished.entries) {
    const ex = EXERCISE_BY_ID[en.exId];
    const prev = exerciseRecords(en.exId, w.start);
    for (const s of en.sets) {
      const wt = +s.w || 0, r = +s.r || 0;
      if ((ex.t === 'wr' && wt > prev.bestW && wt > 0) || (ex.t === 'r' && r > prev.bestReps && r > 0)) { prCount++; break; }
    }
  }

  S.workouts.push(finished);
  S.active = null;
  save(); stopRest();

  const vol = workoutVolume(finished);
  openModal(`
    <div class="summary-hero">
      <div class="big">${prCount ? '🏆' : '💪'}</div>
      <h2 style="margin-bottom:2px">Workout complete!</h2>
      <div class="subtle">${esc(finished.name)}</div>
    </div>
    <div class="modal-body">
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-tile"><div class="stat-value">${fmtDur(finished.end - finished.start)}</div><div class="stat-label">Duration</div></div>
        <div class="stat-tile"><div class="stat-value">${fmtNum(vol)}</div><div class="stat-label">${esc(unit())} volume</div></div>
        <div class="stat-tile"><div class="stat-value">${doneSets}</div><div class="stat-label">Sets</div></div>
      </div>
      ${prCount ? `<div class="card center" style="border-color:var(--gold)"><b>🏆 ${prCount} new PR${prCount > 1 ? 's' : ''}!</b></div>` : ''}
      <button class="btn primary block" id="sum-done">Done</button>
    </div>`, {
    onOpen(root) {
      root.querySelector('#sum-done').onclick = () => { closeModal(); go('home'); };
    },
  });
  go('home');
}

// ===================== Rest timer =====================
let restInt = null, restLeft = 0, restTotal = 0;

function startRest(sec) {
  stopRest();
  restLeft = restTotal = sec;
  const banner = $('#rest-banner');
  banner.classList.remove('hidden');
  drawRest();
  restInt = setInterval(() => {
    restLeft--;
    if (restLeft <= 0) { restDone(); return; }
    drawRest();
  }, 1000);
}
function drawRest() {
  $('#rest-time').textContent = fmtClock(Math.max(0, restLeft));
  $('#rest-progress').style.width = (restLeft / restTotal * 100) + '%';
}
function stopRest() {
  if (restInt) clearInterval(restInt);
  restInt = null;
  $('#rest-banner').classList.add('hidden');
}
function restDone() {
  stopRest();
  beep();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  toast('⏰ Rest over — next set!');
}
$('#rest-skip').onclick = stopRest;
$('#rest-plus').onclick = () => { restLeft += 15; restTotal = Math.max(restTotal, restLeft); drawRest(); };
$('#rest-minus').onclick = () => { restLeft = Math.max(1, restLeft - 15); drawRest(); };

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch (e) { /* audio unavailable */ }
}

// ===================== Profile =====================
function renderProfile(v) {
  const avail = availableExercises().length;
  v.innerHTML = `
    <div class="view-header"><h1>Profile</h1></div>

    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-value">${S.workouts.length}</div><div class="stat-label">Workouts</div></div>
      <div class="stat-tile"><div class="stat-value">${fmtNum(S.workouts.reduce((n, w) => n + workoutVolume(w), 0))}</div><div class="stat-label">${esc(unit())} lifetime</div></div>
      <div class="stat-tile"><div class="stat-value">${avail}</div><div class="stat-label">Exercises unlocked</div></div>
    </div>

    <div class="section-label">My equipment (${S.equipment.length} items)</div>
    <p class="subtle" style="margin-bottom:6px">This drives everything: the exercise library, smart templates and swap suggestions only show what you can actually do.</p>
    <div id="prof-equip">${renderEquipGrid(new Set(S.equipment))}</div>

    <div class="section-label">Training plan</div>
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div class="grow">${S.plan?.enabled
          ? `<b style="font-size:0.92rem">${esc(S.plan.groups.join(', '))}</b><div class="subtle">Training ${esc(FREQ_LABELS[S.plan.freq] || 'on schedule')}</div>`
          : '<span class="subtle">No plan yet — pick a schedule and muscle groups.</span>'}</div>
        <button class="btn sm" id="prof-plan">${S.plan?.enabled ? 'Edit' : 'Set up'}</button>
      </div>
    </div>

    <div class="section-label">Settings</div>
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <span>Units</span>
        <div>
          <button class="chip ${unit() === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
          <button class="chip ${unit() === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        </div>
      </div>
      <div class="divider"></div>
      <div class="row" style="justify-content:space-between">
        <span>Rest timer</span>
        <div>
          ${[60, 90, 120, 180].map(s => `<button class="chip ${S.settings.restSec === s ? 'active' : ''}" data-rest="${s}">${fmtClock(s)}</button>`).join(' ')}
        </div>
      </div>
    </div>

    <div class="section-label">Data</div>
    <div class="card">
      <button class="btn block" id="exp-data">⬇ Export data (JSON)</button>
      <button class="btn block mt" id="imp-data">⬆ Import data</button>
      <input type="file" id="imp-file" accept="application/json" class="hidden">
      <button class="btn danger-ghost block mt" id="reset-data">Reset everything</button>
    </div>
    <p class="subtle center" style="margin-top:8px">RepForge stores everything locally on this device.</p>`;

  const sel = new Set(S.equipment);
  bindEquipGrid(v.querySelector('#prof-equip'), sel, () => {
    S.equipment = [...sel];
    save();
  });

  v.querySelector('#prof-plan').onclick = openPlanEditor;
  v.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => {
    S.settings.unit = b.dataset.unit; save(); render();
  });
  v.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => {
    S.settings.restSec = +b.dataset.rest; save(); render();
  });

  v.querySelector('#exp-data').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `repforge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const fileInput = v.querySelector('#imp-file');
  v.querySelector('#imp-data').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (!data || !Array.isArray(data.workouts)) throw new Error('bad format');
        S = Object.assign(defaultState(), data);
        save(); render();
        toast('Data imported ✓');
      } catch (e) { toast('Import failed — not a RepForge backup.'); }
    };
    rd.readAsText(f);
  };
  v.querySelector('#reset-data').onclick = () =>
    confirmModal('Reset everything?', 'All workouts, routines and settings will be permanently deleted from this device.', 'Reset', () => {
      localStorage.removeItem(STORE_KEY);
      S = defaultState();
      obStep = 0; obSel = new Set();
      go('home');
    });
}

// ===================== Boot =====================
render();
