/* RepForge — equipment-aware workout tracker */
'use strict';

// ===================== State =====================
const STORE_KEY = 'repforge.v1';

const defaultState = () => ({
  ver: 1,
  onboarded: false,
  equipment: [],
  settings: { unit: 'lb', restSec: 90, notify: false },
  routines: [],
  workouts: [],
  active: null,
  plan: null, // { enabled, freq (days between workouts), groups: [muscle ids], anchor: day timestamp }
  maxes: {},  // manually logged one-rep maxes: exId -> [{ w, ts }]
  habits: null, // daily habits: { items: [{id, name, emoji, time}], log: { id: { 'YYYY-MM-DD': 1 } } }
});

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { console.warn('Failed to load state', e); }
  return defaultState();
}
function save() {
  const raw = JSON.stringify(S);
  localStorage.setItem(STORE_KEY, raw);
  idbBackup(raw);
}

// --- Durable storage: everything is mirrored to IndexedDB and the browser is
// asked to mark storage persistent, so data survives app updates, reinstalls
// and storage cleanup. localStorage stays the primary store.
const IDB_NAME = 'repforge-backup';
function idbOpen(cb) {
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => cb(req.result);
    req.onerror = () => cb(null);
  } catch (e) { cb(null); }
}
function idbBackup(raw) {
  idbOpen(db => {
    if (!db) return;
    try {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(raw, 'state');
      tx.oncomplete = () => db.close();
    } catch (e) { db.close(); }
  });
}
function idbRestore(cb) {
  idbOpen(db => {
    if (!db) { cb(null); return; }
    try {
      const g = db.transaction('kv', 'readonly').objectStore('kv').get('state');
      g.onsuccess = () => { cb(g.result || null); db.close(); };
      g.onerror = () => { cb(null); db.close(); };
    } catch (e) { cb(null); db.close(); }
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
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

// ===================== Assistance (bands, machine, partner) =====================
// For rep-based exercises (chin-ups, dips, pistols...) a set can be marked as
// assisted, recording what helped. Assisted sets never count as rep PRs.
const ASSIST_OPTIONS = [
  { id: 'Red band',     color: '#e34948' },
  { id: 'Black band',   color: '#555550' },
  { id: 'Purple band',  color: '#9085e9' },
  { id: 'Green band',   color: '#0ca30c' },
  { id: 'Blue band',    color: '#3987e5' },
  { id: 'Orange band',  color: '#eb6834' },
  { id: 'Yellow band',  color: '#eda100' },
  { id: 'Machine assist', color: '#898781' },
  { id: 'Partner assist', color: '#898781' },
];
function assistColor(name) {
  const opt = ASSIST_OPTIONS.find(o => o.id === name);
  return opt ? opt.color : '#898781';
}
function assistDot(name, size = 10) {
  if (!name) return '';
  return `<span class="band-dot" style="background:${assistColor(name)};width:${size}px;height:${size}px" title="${esc(name)}"></span>`;
}

function openAssistPicker(current, onPick) {
  openModal(`
    <div class="modal-head"><h2>Assistance</h2><button class="icon-btn" id="as-x">✕</button></div>
    <div class="modal-body">
      <p class="subtle" style="margin-bottom:10px">Mark this set as assisted and note what you used. Assisted sets don't count toward rep PRs.</p>
      <button class="ex-row" data-as=""><span class="ex-avatar">✕</span><span class="grow"><b>No assistance</b></span>${current ? '' : '<span style="color:var(--accent);font-weight:800">✓</span>'}</button>
      ${ASSIST_OPTIONS.map(o => `
        <button class="ex-row" data-as="${esc(o.id)}">
          <span class="ex-avatar" style="background:transparent">${assistDot(o.id, 18)}</span>
          <span class="grow"><b>${esc(o.id)}</b></span>
          ${current === o.id ? '<span style="color:var(--accent);font-weight:800">✓</span>' : ''}
        </button>`).join('')}
      <div class="row mt">
        <input type="text" id="as-custom" placeholder="Custom (e.g. thin grey band)" value="${current && !ASSIST_OPTIONS.some(o => o.id === current) ? esc(current) : ''}">
        <button class="btn sm primary" id="as-set">Set</button>
      </div>
    </div>`, {
    onOpen(root) {
      root.querySelector('#as-x').onclick = closeModal;
      root.querySelectorAll('[data-as]').forEach(b => b.onclick = () => { closeModal(); onPick(b.dataset.as); });
      root.querySelector('#as-set').onclick = () => {
        const val = root.querySelector('#as-custom').value.trim();
        if (!val) return;
        closeModal(); onPick(val);
      };
    },
  });
}

// ===================== Workout generator & training plan =====================
// variant: undefined/0 = best available (the classic), 'rand' = random among
// the top 3, a number = deterministic rotation among the top 4 — used to vary
// accessories from one planned day to the next.
// How trackable/preferred an exercise's loading is: weighted (barbell, dumbbell,
// machine, cable, kettlebell) is best, bodyweight next, resistance bands last —
// bands are hard to load precisely, so they're only picked when nothing better
// is available for that movement.
function loadTier(ex) {
  if (ex.eq.length === 1 && ex.eq[0] === 'bands') return 0; // pure-band exercise
  if (!ex.eq.length) return 1; // bodyweight
  return 2; // loadable with real weight
}
function pickForPattern(pat, taken, variant) {
  let cand = (PATTERN_PREFER[pat] || []).map(id => EXERCISE_BY_ID[id]).filter(ex => ex && canDo(ex) && !taken.has(ex.id));
  if (!cand.length) return EXERCISES.find(e => e.p === pat && canDo(e) && !taken.has(e.id)) || null;
  // Bands are a true last resort: if any non-band option exists for this
  // movement, drop the band ones so they're never chosen or rotated in.
  const nonBand = cand.filter(ex => loadTier(ex) > 0);
  if (nonBand.length) cand = nonBand;
  // Stable-sort by load tier so weighted options come before bodyweight; the
  // variation rotation then cycles the most trackable choices first.
  cand = cand.map((ex, i) => [ex, i]).sort((a, b) => loadTier(b[0]) - loadTier(a[0]) || a[1] - b[1]).map(p => p[0]);
  if (variant === 'rand') return cand[Math.floor(Math.random() * Math.min(3, cand.length))];
  const v = typeof variant === 'number' ? variant : 0;
  return cand[v % Math.min(4, cand.length)];
}

function repsFor(pat, ex) {
  if (ex.t === 't') return '30-60s';
  if (['squat', 'hinge', 'hpush', 'vpush', 'hpull', 'vpull'].includes(pat)) return '6-10';
  if (pat === 'lunge') return '8-12';
  return '10-15';
}

// Build a workout (list of routine items) for the given muscle groups,
// using only exercises the user's equipment allows. With a `seed` (days since
// the plan's anchor), each group's first exercise stays the classic pick
// (bench, squat, barbell curl, ...) while later slots rotate day to day.
// The big compound slots keep their classic pick every time (bench, rows,
// squat, overhead press, curls); isolation/accessory slots rotate with the seed.
const CLASSIC_PATTERNS = new Set(['hpush', 'hpull', 'vpush', 'vpull', 'squat', 'hinge', 'lunge', 'curl']);

function generateWorkout(groupIds, rand = false, seed = null) {
  const taken = new Set();
  const per = groupIds.length <= 1 ? 5 : groupIds.length === 2 ? 3 : groupIds.length <= 4 ? 2 : 1;
  const items = [];
  for (const gid of groupIds) {
    const def = GROUP_DEFS.find(g => g.id === gid);
    if (!def) continue;
    let added = 0;
    for (let i = 0; added < per && i < def.patterns.length * 3; i++) {
      const pat = def.patterns[i % def.patterns.length];
      let variant = 0;
      if (rand) variant = 'rand';
      else if (seed !== null && !(added === 0 && CLASSIC_PATTERNS.has(pat))) variant = seed + added + i;
      const ex = pickForPattern(pat, taken, variant);
      if (ex) { taken.add(ex.id); items.push({ exId: ex.id, sets: 3, reps: repsFor(pat, ex) }); added++; }
      else if (i >= def.patterns.length - 1 && !added && i >= def.patterns.length * 2) break;
    }
  }
  return ensureDumbbellCurl(items.slice(0, 8), rand, seed);
}

// House rule: biceps work always includes some sort of dumbbell curl (when
// dumbbells are available). If no curl slot landed on one, the last curl slot
// is swapped for a dumbbell curl variant.
const DB_CURLS = ['db_curl', 'hammer_curl', 'incline_db_curl', 'concentration_curl', 'spider_curl', 'zottman_curl'];
function ensureDumbbellCurl(items, rand, seed) {
  const curlIdx = [];
  items.forEach((it, i) => { if (EXERCISE_BY_ID[it.exId].p === 'curl') curlIdx.push(i); });
  if (!curlIdx.length) return items;
  if (items.some(it => DB_CURLS.includes(it.exId))) return items;
  const inWorkout = new Set(items.map(it => it.exId));
  const options = DB_CURLS.map(id => EXERCISE_BY_ID[id]).filter(ex => ex && canDo(ex) && !inWorkout.has(ex.id));
  if (!options.length) return items;
  const pick = rand
    ? options[Math.floor(Math.random() * Math.min(3, options.length))]
    : options[(seed || 0) % Math.min(4, options.length)];
  const i = curlIdx[curlIdx.length - 1];
  items[i] = { exId: pick.id, sets: items[i].sets, reps: items[i].reps };
  return items;
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

// ===================== Daily habits (creatine etc.) =====================
function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultHabits() {
  return { items: [{ id: uid(), name: 'Creatine', emoji: '💊', time: '21:00' }], log: {} };
}
function habitDone(id, key = dateKey()) {
  return !!(S.habits && S.habits.log[id] && S.habits.log[id][key]);
}
function toggleHabit(id, key = dateKey()) {
  if (!S.habits) return;
  const log = (S.habits.log[id] = S.habits.log[id] || {});
  if (log[key]) delete log[key]; else log[key] = 1;
  save();
}
function habitStreak(id) {
  if (!S.habits) return 0;
  let streak = 0;
  let ts = dayStart(Date.now());
  // If today isn't done yet, don't break the streak — count back from yesterday.
  if (!habitDone(id, dateKey(ts))) ts -= 864e5;
  while (habitDone(id, dateKey(ts))) { streak++; ts -= 864e5; }
  return streak;
}
// Habits whose reminder time has passed today and that aren't checked off yet.
function habitsDueNow() {
  if (!S.habits || !S.habits.items.length) return [];
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return S.habits.items.filter(h => {
    const [hh, mm] = (h.time || '21:00').split(':').map(Number);
    return mins >= hh * 60 + mm && !habitDone(h.id);
  });
}

const HABIT_EMOJI = ['💊', '🥤', '💧', '🌙', '☀️', '🧘', '🏃', '🥗', '📖', '💤'];
function openHabitAdd() {
  let emoji = '💊';
  openModal(`
    <div class="modal-head"><h2>Add a daily habit</h2><button class="icon-btn" id="ha-x">✕</button></div>
    <div class="modal-body">
      <input type="text" id="ha-name" placeholder="Habit name (e.g. Vitamin D)" style="margin-bottom:10px">
      <div class="section-label" style="margin-top:0">Icon</div>
      <div class="chip-row" id="ha-emoji">
        ${HABIT_EMOJI.map((e, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-e="${e}" style="font-size:1.1rem">${e}</button>`).join('')}
      </div>
      <div class="row mt" style="justify-content:space-between;align-items:center">
        <span>Reminder time</span>
        <input type="time" id="ha-time" value="21:00" style="width:118px">
      </div>
      <button class="btn primary block mt" id="ha-save">Add habit</button>
    </div>`, {
    onOpen(root) {
      root.querySelector('#ha-x').onclick = closeModal;
      root.querySelectorAll('#ha-emoji [data-e]').forEach(b => b.onclick = () => {
        emoji = b.dataset.e;
        root.querySelectorAll('#ha-emoji .chip').forEach(c => c.classList.toggle('active', c === b));
      });
      root.querySelector('#ha-save').onclick = () => {
        const name = root.querySelector('#ha-name').value.trim();
        if (!name) { toast('Give it a name first'); return; }
        if (!S.habits) S.habits = { items: [], log: {} };
        S.habits.items.push({ id: uid(), name, emoji, time: root.querySelector('#ha-time').value || '21:00' });
        save(); closeModal(); render();
        toast(`${emoji} ${esc(name)} added`);
      };
    },
  });
}

// Set a REAL recurring alarm in the phone's Clock app — the reliable way to be
// reminded when the app is closed. Android opens the alarm pre-filled; iOS gets
// a quick manual guide (no alarm URL scheme exists).
function setupNightlyAlarm() {
  const items = (S.habits && S.habits.items) || [];
  if (!items.length) return;
  if (items.length === 1) { launchHabitAlarm(items[0]); return; }
  openModal(`
    <div class="modal-head"><h2>⏰ Which reminder?</h2><button class="icon-btn" id="al-x">✕</button></div>
    <div class="modal-body">
      <p class="subtle" style="margin-bottom:10px">Pick a habit to set an alarm for in your phone's Clock app.</p>
      ${items.map(h => `<button class="ex-row" data-halarm="${h.id}"><span class="ex-avatar" style="background:transparent">${h.emoji}</span><span class="grow"><b>${esc(h.name)}</b><small>${esc(h.time || '21:00')}</small></span><span style="color:var(--ink-3)">›</span></button>`).join('')}
    </div>`, {
    onOpen(root) {
      root.querySelector('#al-x').onclick = closeModal;
      root.querySelectorAll('[data-halarm]').forEach(b => b.onclick = () => {
        const h = items.find(x => x.id === b.dataset.halarm);
        closeModal(); launchHabitAlarm(h);
      });
    },
  });
}
function launchHabitAlarm(h) {
  const [hh, mm] = (h.time || '21:00').split(':').map(Number);
  if (IS_IOS) { openIosAlarmHelp(h); return; }
  const msg = encodeURIComponent(h.name);
  location.href = `intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${hh};i.android.intent.extra.alarm.MINUTES=${mm};S.android.intent.extra.alarm.MESSAGE=${msg};B.android.intent.extra.alarm.SKIP_UI=false;end`;
}
function openIosAlarmHelp(h) {
  const t = h.time || '21:00';
  openModal(`
    <div class="modal-head"><h2>⏰ Nightly ${esc(h.name)} alarm</h2><button class="icon-btn" id="ia-x">✕</button></div>
    <div class="modal-body">
      <p class="subtle" style="margin-bottom:10px">iPhones don't let apps create alarms directly, but it's 20 seconds by hand and it repeats forever:</p>
      <div class="card hist-sets">
        <div>1. Open the <b>Clock</b> app → <b>Alarms</b> → tap <b>+</b></div>
        <div>2. Set the time to <b>${esc(t)}</b></div>
        <div>3. Tap <b>Repeat</b> → choose <b>Every Day</b></div>
        <div>4. Tap <b>Label</b> → type <b>${esc(h.name)}</b> → <b>Save</b></div>
      </div>
      <p class="subtle" style="margin-top:10px">That alarm rings every night whether or not this app is open — nothing can stop it.</p>
      <button class="btn primary block mt" id="ia-done">Got it</button>
    </div>`, {
    onOpen(root) {
      root.querySelector('#ia-x').onclick = closeModal;
      root.querySelector('#ia-done').onclick = closeModal;
    },
  });
}

const FREQ_LABELS = { 1: 'every day', 2: 'every other day', 3: 'every 3rd day' };

// Weekly split schedules: a repeating 7-day pattern of workout days
// (label + muscle groups) and rest days (null), anchored to the save date.
const UPPER_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'];
const LOWER_GROUPS = ['Legs', 'Glutes', 'Core'];
const WEEKLY_PRESETS = [
  {
    id: 'ul4',
    name: 'Upper / Lower · 4 days a week',
    short: '4 days a week (upper/lower)',
    pattern: [
      { label: 'Upper Body', groups: UPPER_GROUPS },
      { label: 'Lower Body', groups: LOWER_GROUPS },
      null,
      { label: 'Upper Body', groups: UPPER_GROUPS },
      { label: 'Lower Body', groups: LOWER_GROUPS },
      null,
      null,
    ],
  },
];

// What (if anything) does the plan schedule for a given date?
// Returns { label, groups, seed } or null. The seed (days since the plan's
// anchor) drives day-to-day exercise variation.
function planForDate(ts) {
  const p = S.plan;
  if (!p || !p.enabled || (p.type !== 'weekly' && !p.groups?.length)) return null;
  const day = dayStart(ts);
  // Overrides support moving a workout to another day: a date can point at a
  // different schedule slot (its diff), or be forced to rest (-1).
  const ov = p.overrides ? p.overrides[day] : undefined;
  if (ov === -1) return null;
  const diff = ov != null ? ov : Math.round((day - p.anchor) / 864e5);
  if (diff < 0) return null;
  if (p.type === 'weekly') {
    const preset = WEEKLY_PRESETS.find(x => x.id === p.presetId) || WEEKLY_PRESETS[0];
    const e = preset.pattern[diff % 7];
    return e ? { label: e.label, groups: e.groups, seed: diff } : null;
  }
  if (diff % p.freq !== 0) return null;
  const rotation = buildRotation(p.groups);
  const groups = rotation[(diff / p.freq) % rotation.length];
  return { label: groups.join(' & '), groups, seed: diff };
}

// What does the plan say about today? null when no active plan.
function planInfo() {
  const p = S.plan;
  if (!p || !p.enabled || (p.type !== 'weekly' && !p.groups?.length)) return null;
  const today = dayStart(Date.now());
  const t = planForDate(today);
  let next = null, nextTs = today;
  for (let d = 1; d <= 28; d++) {
    const e = planForDate(today + d * 864e5);
    if (e) { next = e; nextTs = today + d * 864e5; break; }
  }
  const preset = WEEKLY_PRESETS.find(x => x.id === p.presetId) || WEEKLY_PRESETS[0];
  return {
    isDay: !!t,
    doneToday: S.workouts.some(w => dayStart(w.start) === today),
    todayGroups: t ? t.groups : null,
    todayName: t ? t.label : null,
    seed: t ? t.seed : 0,
    nextTs,
    nextName: next ? next.label : '',
    freqLabel: p.type === 'weekly' ? preset.short : (FREQ_LABELS[p.freq] || `every ${p.freq} days`),
  };
}

function startGenerated(groups, items, name) {
  const entries = items.map(i => makeEntry(i.exId, i.sets, i.reps));
  startWorkout(name || groups.join(' & '), entries);
}

// Move a planned workout from a future date to today and start it; its
// original day becomes a rest day, the rest of the schedule stays put.
function pullWorkoutToToday(ts) {
  const p = S.plan;
  const plan = planForDate(ts);
  if (!p || !plan) return;
  const today = dayStart(Date.now());
  const srcDay = dayStart(ts);
  if (srcDay !== today) {
    p.overrides = p.overrides || {};
    for (const k of Object.keys(p.overrides)) if (+k < today - 45 * 864e5) delete p.overrides[k];
    p.overrides[today] = plan.seed;
    p.overrides[srcDay] = -1;
    save();
    toast(`Moved ${esc(plan.label)} to today — ${esc(fmtDate(srcDay))} is now a rest day`);
  }
  startGenerated(plan.groups, generateWorkout(plan.groups, false, plan.seed), plan.label);
}

// Plan setup / edit modal
function openPlanEditor() {
  const existing = S.plan;
  let freq = existing?.type === 'weekly' ? 'ul4' : (existing?.freq || 2); // number = interval mode, string = weekly preset id
  let sel = new Set(existing?.groups || []);

  const redraw = () => {
    const weekly = typeof freq === 'string' ? WEEKLY_PRESETS.find(x => x.id === freq) : null;
    const rotation = buildRotation([...sel]);
    const canSave = weekly ? true : sel.size > 0;
    openModal(`
      <div class="modal-head"><h2>${existing ? 'Edit training plan' : 'Set up training plan'}</h2><button class="icon-btn" id="pl-x">✕</button></div>
      <div class="modal-body">
        <div class="section-label" style="margin-top:0">How often do you want to train?</div>
        <div class="chip-row">
          ${[1, 2, 3].map(f => `<button class="chip ${freq === f ? 'active' : ''}" data-freq="${f}">${f === 1 ? 'Every day' : f === 2 ? 'Every other day' : 'Every 3rd day'}</button>`).join('')}
          ${WEEKLY_PRESETS.map(w => `<button class="chip ${freq === w.id ? 'active' : ''}" data-freqw="${w.id}">🏋️ ${esc(w.name)}</button>`).join('')}
        </div>
        ${weekly ? `
          <div class="section-label">Your week — repeats weekly, starting today</div>
          <div class="rotation-preview">
            ${weekly.pattern.map((e, i) => {
              if (!e) return `<div><b>Day ${i + 1}:</b> 😴 Rest</div>`;
              const preview = generateWorkout(e.groups).map(it => EXERCISE_BY_ID[it.exId].name);
              return `<div><b>Day ${i + 1}: ${esc(e.label)}</b> — ${esc(preview.slice(0, 3).join(', '))}${preview.length > 3 ? '…' : ''}</div>`;
            }).join('')}
          </div>
          <p class="subtle" style="margin-top:6px">Each workout is auto-built from your equipment on the day.</p>` : `
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
            <p class="subtle" style="margin-top:6px">Workouts are auto-built from your equipment each time — starting today.</p>` : ''}`}
        <button class="btn primary block mt" id="pl-save" ${canSave ? '' : 'disabled'}>${existing ? 'Save plan' : 'Start plan'}</button>
        ${existing ? '<button class="btn danger-ghost block mt" id="pl-off">Turn off plan</button>' : ''}
      </div>`, {
      onOpen(root) {
        root.querySelector('#pl-x').onclick = closeModal;
        root.querySelectorAll('[data-freq]').forEach(b => b.onclick = () => { freq = +b.dataset.freq; redraw(); });
        root.querySelectorAll('[data-freqw]').forEach(b => b.onclick = () => { freq = b.dataset.freqw; redraw(); });
        root.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
          const id = b.dataset.g;
          sel.has(id) ? sel.delete(id) : sel.add(id);
          redraw();
        });
        root.querySelector('#pl-save').onclick = () => {
          if (weekly) {
            S.plan = { enabled: true, type: 'weekly', presetId: weekly.id, name: weekly.name, anchor: dayStart(Date.now()) };
          } else {
            if (!sel.size) return;
            S.plan = { enabled: true, type: 'rotation', freq, groups: [...sel], anchor: existing?.anchor ?? dayStart(Date.now()) };
            if (existing && (existing.freq !== freq || existing.type === 'weekly')) S.plan.anchor = dayStart(Date.now());
          }
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

// Quick workout: simple picks (Chest, Arms, Full Body...) that expand to
// muscle groups and instantly build a workout from the user's equipment.
const QUICK_DEFS = [
  { id: 'Chest',     icon: '🫁', groups: ['Chest'] },
  { id: 'Back',      icon: '🪽', groups: ['Back'] },
  { id: 'Shoulders', icon: '🏔️', groups: ['Shoulders'] },
  { id: 'Arms',      icon: '💪', groups: ['Biceps', 'Triceps'] },
  { id: 'Legs',      icon: '🦵', groups: ['Legs'] },
  { id: 'Glutes',    icon: '🍑', groups: ['Glutes'] },
  { id: 'Core',      icon: '🎯', groups: ['Core'] },
  { id: 'Full Body', icon: '⚡', groups: ['Chest', 'Back', 'Shoulders', 'Legs', 'Core'] },
];

function openGenerator(preselect = []) {
  let sel = new Set(preselect);
  let items = sel.size ? generateWorkout(expandQuick(sel), true) : null;

  function expandQuick(s) {
    const out = [];
    for (const q of QUICK_DEFS) if (s.has(q.id)) for (const g of q.groups) if (!out.includes(g)) out.push(g);
    return out;
  }

  const redraw = () => {
    openModal(`
      <div class="modal-head"><h2>⚡ Quick workout</h2><button class="icon-btn" id="gen-x">✕</button></div>
      <div class="modal-body">
        <div class="section-label" style="margin-top:0">What do you want to work today?</div>
        <div class="group-grid">
          ${QUICK_DEFS.map(g => `
            <button class="equip-item ${sel.has(g.id) ? 'on' : ''}" data-g="${g.id}">
              <span class="eq-icon">${g.icon}</span>${g.id}<span class="eq-check">✓</span>
            </button>`).join('')}
        </div>
        ${!sel.size ? '<p class="subtle center mt">Tap a muscle group and your workout appears here — built from your equipment.</p>' : `
          <div class="section-label">Your ${esc([...sel].join(' & '))} workout</div>
          <div class="card">
            ${items.map(i => {
              const ex = EXERCISE_BY_ID[i.exId];
              return `<div class="pr-row"><div class="grow"><b style="font-size:0.88rem">${esc(ex.name)}</b>
                <div class="subtle">${i.sets} × ${esc(i.reps)} · ${esc(equipShort(ex))}</div></div></div>`;
            }).join('') || '<div class="empty-state">Nothing available for that combo — add equipment in Profile.</div>'}
          </div>
          <div class="row">
            <button class="btn" id="gen-again" style="flex:1">🎲 Shuffle</button>
            <button class="btn primary" id="gen-start" style="flex:2" ${items.length ? '' : 'disabled'}>Start workout</button>
          </div>`}
      </div>`, {
      onOpen(root) {
        root.querySelector('#gen-x').onclick = closeModal;
        root.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
          const id = b.dataset.g;
          sel.has(id) ? sel.delete(id) : sel.add(id);
          items = sel.size ? generateWorkout(expandQuick(sel), true) : null;
          redraw();
        });
        const again = root.querySelector('#gen-again');
        if (again) again.onclick = () => { items = generateWorkout(expandQuick(sel), true); redraw(); };
        const st = root.querySelector('#gen-start');
        if (st) st.onclick = () => { const g = [...sel], it = items; closeModal(); startGenerated(g, it); };
      },
    });
  };
  redraw();
}

// ===================== History / PR helpers =====================
function e1rm(w, r) { return r > 0 ? w * (1 + r / 30) : w; }

// Round a weight to the nearest loadable increment (5 lb / 2.5 kg).
function roundLoad(w) {
  const inc = unit() === 'kg' ? 2.5 : 5;
  return Math.round(w / inc) * inc;
}
// Suggested working weights for common rep ranges from a one-rep max, using a
// standard %1RM chart. Returns [{ reps, pct, weight }].
const RM_PCT = [[3, 90], [5, 85], [8, 78], [10, 73], [12, 68]];
function workingWeights(oneRM) {
  if (!(oneRM > 0)) return [];
  return RM_PCT.map(([reps, pct]) => ({ reps, pct, weight: roundLoad(oneRM * pct / 100) }));
}

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
        if (r > bestReps && !st.assist) bestReps = r; // assisted reps don't set records
        if ((+st.time || 0) > bestTime) bestTime = +st.time || 0;
      }
    }
  }
  // Manually logged one-rep maxes count toward records too
  for (const m of (S.maxes && S.maxes[exId]) || []) {
    if (m.ts >= beforeTs) continue;
    const wt = +m.w || 0;
    if (wt > bestW) bestW = wt;
    if (wt > bestE) bestE = wt;
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
let lastRenderedTab = null;
function go(tab) {
  currentTab = tab;
  render();
}
function render() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  const v = $('#view');
  // Re-rendering the screen you're already on (checking off a set, adding a
  // set, ...) keeps your scroll position; only a real navigation jumps to top.
  const keepScroll = lastRenderedTab === currentTab;
  const scrollY = window.scrollY;
  lastRenderedTab = currentTab;
  stopWorkoutClock();

  if (!S.onboarded) {
    $('#tabbar').classList.add('hidden');
    renderOnboarding(v);
    if (!keepScroll) window.scrollTo(0, 0);
    updateResumePill();
    return;
  }
  $('#tabbar').classList.remove('hidden');

  switch (currentTab) {
    case 'home': renderHome(v); break;
    case 'routines': renderRoutines(v); break;
    case 'start': renderStart(v); break;
    case 'exercises': renderExercises(v); break;
    case 'profile': renderProfile(v); break;
    case 'workout': renderWorkout(v); break;
    case 'history': renderHistory(v); break;
    case 'calendar': renderCalendar(v); break;
  }
  if (keepScroll) window.scrollTo(0, scrollY);
  else { v.scrollTop = 0; window.scrollTo(0, 0); }
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
  const todayItems = pi?.isDay && !pi.doneToday ? generateWorkout(pi.todayGroups, false, pi.seed) : null;
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
          <div class="grow"><b>💪 Today: ${esc(pi.todayName)}</b>
            <div class="subtle">${todayItems.length} exercises · ${esc(pi.freqLabel)}</div></div>
          <button class="btn sm ghost" id="plan-edit">Edit</button>
        </div>
        <button class="plan-view-list" id="plan-view">
          <span class="hist-sets subtle" style="margin:0">${esc(todayItems.map(i => EXERCISE_BY_ID[i.exId].name).join(', '))}</span>
          <span class="subtle" style="white-space:nowrap"> · View ›</span>
        </button>
        <button class="btn primary block mt" id="plan-start">Start today's workout</button>
      </div>`;
  } else if (pi.isDay && pi.doneToday) {
    planHtml = `
      <div class="card plan-card">
        <div class="row">
          <div class="grow"><b>✅ Done for today!</b>
            <div class="subtle">Next: ${esc(pi.nextName)} on ${fmtDate(pi.nextTs)}</div></div>
          <button class="btn sm ghost" id="plan-edit">Edit</button>
        </div>
      </div>`;
  } else {
    planHtml = `
      <div class="card plan-rest">
        <div class="row">
          <div class="grow"><b>😴 Rest day</b>
            <div class="subtle">Next workout: ${esc(pi.nextName)} on ${fmtDate(pi.nextTs)}</div></div>
          <button class="btn sm ghost" id="plan-edit">Edit</button>
        </div>
        <button class="btn block mt" id="plan-pull">🔁 Busy ${fmtDate(pi.nextTs) === fmtDate(Date.now() + 864e5) ? 'tomorrow' : 'then'}? Do ${esc(pi.nextName)} today</button>
      </div>`;
  }

  let habitsHtml = '';
  if (S.habits && S.habits.items.length) {
    const tk = dateKey();
    habitsHtml = `
      <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Daily habits</span>
        <button class="btn ghost sm" id="habits-manage">Manage ›</button>
      </div>
      <div class="card">
        ${S.habits.items.map(h => {
          const done = habitDone(h.id, tk);
          const st = habitStreak(h.id);
          return `<button class="habit-row" data-habit="${h.id}">
            <span class="habit-check ${done ? 'done' : ''}">${done ? '✓' : ''}</span>
            <span class="grow"><b>${h.emoji} ${esc(h.name)}</b>
              <div class="subtle">${done ? 'Done today 🎉' : 'Tap to mark done'}${st ? ` · ${st}🔥 day streak` : ''}</div></span>
            <span class="subtle">${esc(h.time || '')}</span>
          </button>`;
        }).join('')}
      </div>`;
  }

  v.innerHTML = `
    <div class="view-header">
      <div>
        <h1>RepForge</h1>
        <div class="subtle">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
      <button class="icon-btn" id="home-calendar" title="Workout calendar">📅</button>
      <button class="icon-btn" id="home-settings" title="Settings">⚙</button>
    </div>

    ${planHtml}

    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-value">${thisWeek.length}</div><div class="stat-label">Workouts this week</div></div>
      <div class="stat-tile"><div class="stat-value">${fmtNum(weekVol)}</div><div class="stat-label">${esc(unit())} lifted this week</div></div>
      <div class="stat-tile"><div class="stat-value">${streak}🔥</div><div class="stat-label">Week streak</div></div>
    </div>

    ${habitsHtml}

    <div class="section-label">Quick workout — tap what you want to train</div>
    <div class="chip-row">
      ${QUICK_DEFS.map(g => `<button class="chip" data-quick="${g.id}">${g.icon} ${g.id}</button>`).join('')}
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
  if (planStart) planStart.onclick = () => startGenerated(pi.todayGroups, todayItems, pi.todayName);
  const planView = v.querySelector('#plan-view');
  if (planView) planView.onclick = () => openPlannedDay(dayStart(Date.now()));
  const planPull = v.querySelector('#plan-pull');
  if (planPull) planPull.onclick = () => openPlannedDay(pi.nextTs);
  v.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => openGenerator([b.dataset.quick]));
  v.querySelector('#home-settings').onclick = () => go('profile');
  v.querySelector('#home-calendar').onclick = () => go('calendar');
  const hist = v.querySelector('#see-history');
  if (hist) hist.onclick = () => go('history');
  v.querySelectorAll('[data-habit]').forEach(b => b.onclick = () => {
    const id = b.dataset.habit;
    const wasDone = habitDone(id);
    toggleHabit(id);
    if (!wasDone) { const h = S.habits.items.find(x => x.id === id); toast(`${h.emoji} ${esc(h.name)} — nice! ${habitStreak(id)}🔥`); }
    closeSwipeGuard();
    render();
  });
  const hm = v.querySelector('#habits-manage');
  if (hm) hm.onclick = () => go('profile');
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
        else if (ex.t === 'r' && r > prev.bestReps && r > 0 && !st.assist) best = `${r} reps — new rep record`;
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
      <button class="icon-btn" id="hist-cal" title="Workout calendar">📅</button>
    </div>
    ${sorted.length ? sorted.map(w => historyCard(w)).join('') : '<div class="empty-state"><div class="big">📭</div>Nothing here yet.</div>'}`;
  v.querySelector('#hist-back').onclick = () => go('home');
  v.querySelector('#hist-cal').onclick = () => go('calendar');
  bindHistoryCards(v);
}

// ===================== Calendar (yearly consistency view) =====================
function renderCalendar(v) {
  // Map of day-start timestamp -> first workout id that day
  const dayMap = {};
  for (const w of S.workouts) {
    const k = dayStart(w.start);
    if (!(k in dayMap)) dayMap[k] = w.id;
  }
  const now = new Date();
  const thisYear = now.getFullYear();
  const today = dayStart(Date.now());
  const yearsWithData = S.workouts.map(w => new Date(w.start).getFullYear());
  const firstYear = yearsWithData.length ? Math.min(...yearsWithData, thisYear) : thisYear;

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let html = '';
  for (let y = firstYear; y <= thisYear; y++) {
    html += `<h1 class="cal-year">${y}</h1><div class="cal-months">`;
    for (let mo = 0; mo < 12; mo++) {
      const daysInMonth = new Date(y, mo + 1, 0).getDate();
      const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday-first
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span class="cal-day pad"></span>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ts = new Date(y, mo, d).getTime();
        const wid = dayMap[ts];
        const planned = !wid && ts >= today ? planForDate(ts) : null;
        const cls = ['cal-day', wid ? 'on' : '', planned ? 'plan' : '', ts === today ? 'today' : ''].filter(Boolean).join(' ');
        if (wid) cells += `<button class="${cls}" data-cal-w="${wid}" title="${new Date(ts).toLocaleDateString()}"></button>`;
        else if (planned) cells += `<button class="${cls}" data-cal-p="${ts}" title="${esc(planned.label)}"></button>`;
        else cells += `<span class="${cls}"></span>`;
      }
      const isCurrent = y === thisYear && mo === now.getMonth();
      html += `
        <div class="cal-month" ${isCurrent ? 'id="cal-current"' : ''}>
          <div class="cal-title">${MONTH_NAMES[mo]}</div>
          <div class="cal-grid">${cells}</div>
        </div>`;
    }
    html += '</div>';
  }

  const yearCount = S.workouts.filter(w => new Date(w.start).getFullYear() === thisYear).length;
  v.innerHTML = `
    <div class="view-header">
      <button class="icon-btn" id="cal-back">‹</button>
      <h1>Calendar</h1>
      <span class="subtle">${yearCount} workout${yearCount === 1 ? '' : 's'} in ${thisYear}</span>
    </div>
    <p class="subtle" style="margin-bottom:10px">
      <span class="cal-key on"></span> trained — tap to see that workout
      ${S.plan?.enabled ? '<br><span class="cal-key plan"></span> planned — tap to preview that day\'s workout' : ''}
    </p>
    ${html}`;
  v.querySelector('#cal-back').onclick = () => go('home');
  v.querySelectorAll('[data-cal-w]').forEach(b => b.onclick = () => openWorkoutDetail(b.dataset.calW));
  v.querySelectorAll('[data-cal-p]').forEach(b => b.onclick = () => openPlannedDay(+b.dataset.calP));
  // Bring the current month into view (multi-year histories can get long)
  setTimeout(() => {
    const cur = document.getElementById('cal-current');
    if (cur && document.querySelectorAll('.cal-year').length > 1) cur.scrollIntoView({ block: 'center' });
  }, 0);
}

// Preview of a planned (future or today's) workout from the calendar.
function openPlannedDay(ts) {
  const plan = planForDate(ts);
  if (!plan) return;
  const items = generateWorkout(plan.groups, false, plan.seed);
  const isToday = dayStart(ts) === dayStart(Date.now());
  openModal(`
    <div class="modal-head"><h2>${esc(plan.label)}</h2><button class="icon-btn" id="pd-x">✕</button></div>
    <div class="modal-body">
      <div class="subtle" style="margin-bottom:10px">${fmtDate(ts)} · planned workout, built from your equipment · tap an exercise for details</div>
      <div class="card">
        ${items.map(i => {
          const ex = EXERCISE_BY_ID[i.exId];
          return `<button class="pr-row" data-ex="${ex.id}" style="width:100%;text-align:left"><div class="grow"><b style="font-size:0.88rem">${esc(ex.name)}</b>
            <div class="subtle">${i.sets} × ${esc(i.reps)} · ${esc(equipShort(ex))}</div></div><span style="color:var(--ink-3)">›</span></button>`;
        }).join('') || '<div class="empty-state">No exercises available — add equipment in Profile.</div>'}
      </div>
      ${isToday
        ? `<button class="btn primary block" id="pd-start" ${items.length ? '' : 'disabled'}>Start this workout</button>
           <p class="subtle center" style="margin-top:8px">Just looking? Close this — nothing starts until you tap the button.</p>`
        : `<button class="btn primary block" id="pd-pull" ${items.length ? '' : 'disabled'}>🔁 Do this workout today instead</button>
           <p class="subtle center" style="margin-top:8px">Moves it to today and makes ${fmtDate(ts)} a rest day. Main lifts stay the same; accessories rotate day to day.</p>`}
    </div>`, {
    onOpen(root) {
      root.querySelector('#pd-x').onclick = closeModal;
      root.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => openExerciseDetail(b.dataset.ex));
      const st = root.querySelector('#pd-start');
      if (st) st.onclick = () => { closeModal(); startGenerated(plan.groups, items, plan.label); };
      const pull = root.querySelector('#pd-pull');
      if (pull) pull.onclick = () => { closeModal(); pullWorkoutToToday(ts); };
    },
  });
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
  if (ex.t === 'r' && !(+s.w)) return `${+s.r || 0} reps${s.assist ? ` ${assistDot(s.assist, 9)} ${esc(s.assist)}` : ''}`;
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
      (exFilter.muscle === 'All' || ex.m === exFilter.muscle || exFilter.muscle in ex.r) &&
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

// Sorted [muscle, score] pairs for an exercise, best first.
function ratingsOf(ex) {
  return Object.entries(ex.r || {}).sort((a, b) => b[1] - a[1]);
}
function ratingBadges(ex, max = 3) {
  return ratingsOf(ex).slice(0, max)
    .map(([m, v]) => `<span class="rate-chip"><b>${esc(m)}</b> ${v}/10</span>`).join('');
}

function exRowHtml(ex, extra = '') {
  const ok = canDo(ex);
  const missing = ok ? [] : missingFor(ex);
  return `
    <button class="ex-row ${ok ? '' : 'unavailable'}" data-ex="${ex.id}">
      <span class="ex-avatar">${esc(ex.m.slice(0, 2).toUpperCase())}</span>
      <span class="grow">
        <b>${esc(ex.name)}</b>
        <span class="rate-chips">${ratingBadges(ex)}</span>
        <small>${esc(equipShort(ex))}</small>
        ${missing.length ? `<div><span class="tag missing">needs ${esc(missing.join(', '))}</span></div>` : ''}
      </span>${extra}
    </button>`;
}

function openExerciseDetail(exId, flashRecs = false) {
  const ex = EXERCISE_BY_ID[exId];
  const rec = exerciseRecords(exId);
  const isWr = ex.t === 'wr';

  // Best e1RM (or reps) per workout, oldest → newest, plus manual 1RM entries
  const raw = [];
  [...S.workouts].sort((a, b) => a.start - b.start).forEach(w => {
    let best = 0;
    for (const en of w.entries) {
      if (en.exId !== exId) continue;
      for (const s of en.sets) {
        if (!s.done) continue;
        if (ex.t === 'r' && s.assist) continue; // progress chart tracks unassisted reps
        const val = isWr ? e1rm(+s.w || 0, +s.r || 0) : (ex.t === 'r' ? (+s.r || 0) : (+s.time || 0));
        if (val > best) best = val;
      }
    }
    if (best > 0) raw.push({ ts: w.start, value: Math.round(best) });
  });
  const manual = (S.maxes && S.maxes[exId]) || [];
  if (isWr) for (const m of manual) if (+m.w > 0) raw.push({ ts: m.ts, value: Math.round(+m.w) });
  raw.sort((a, b) => a.ts - b.ts);
  const points = raw.map(p => ({ label: fmtDate(p.ts), value: p.value }));

  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  const last = lastPerformance(exId);
  openModal(`
    <div class="modal-head"><h2>${esc(ex.name)}</h2><button class="icon-btn" id="exd-x">✕</button></div>
    <div class="modal-body">
      <div style="margin-bottom:10px">
        <span class="tag">${esc(equipShort(ex))}</span>
        ${canDo(ex) ? '' : `<span class="tag missing">needs ${esc(missingFor(ex).join(', '))}</span>`}
      </div>
      <div class="section-label" style="margin-top:0">Muscles worked (out of 10)</div>
      <div class="card" style="padding:10px 12px">
        ${ratingsOf(ex).map(([m, v]) => `
          <div class="rate-row">
            <span class="rate-m">${esc(m)}</span>
            <span class="rate-bar"><span style="width:${v * 10}%"></span></span>
            <span class="rate-v">${v}/10</span>
          </div>`).join('')}
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
      ${isWr ? `
        <div class="section-label">One-rep max log</div>
        <div class="card">
          ${manual.length ? [...manual].sort((a, b) => b.ts - a.ts).map((m, mi) => `
            <div class="pr-row"><span class="medal">🎯</span>
              <div class="grow"><b style="font-size:0.9rem">${esc(String(+m.w))} ${esc(unit())}</b></div>
              <span class="subtle">${fmtDate(m.ts)}</span>
              <button class="icon-btn" data-delm="${m.ts}-${esc(String(m.w))}" style="width:28px;height:28px">✕</button>
            </div>`).join('') : '<p class="subtle">Tested a max outside a workout? Log it here — it counts toward your records and chart.</p>'}
          <div class="row mt">
            <input type="number" inputmode="decimal" id="orm-w" placeholder="${esc(unit())}" style="flex:1">
            <input type="date" id="orm-d" value="${todayIso}" style="flex:1.4">
            <button class="btn sm primary" id="orm-add">Add 1RM</button>
          </div>
        </div>` : ''}
      ${(() => {
        const oneRM = Math.round(rec.bestE || rec.bestW || 0);
        const recs = isWr ? workingWeights(oneRM) : [];
        if (!recs.length) return '';
        return `
        <div class="section-label">Suggested working weights 💡</div>
        <div class="card rec-card ${flashRecs ? 'flash' : ''}" id="rec-card">
          <p class="subtle" style="margin-bottom:8px">Based on your ${oneRM} ${esc(unit())} max — target weights for each rep range:</p>
          ${recs.map(r => `
            <div class="rec-row">
              <span class="rec-reps">${r.reps} reps</span>
              <span class="rec-bar"><span style="width:${r.pct}%"></span></span>
              <span class="rec-w">${r.weight} ${esc(unit())}</span>
            </div>`).join('')}
          <p class="subtle" style="font-size:0.72rem;margin-top:8px">Estimates from a standard %1RM chart — start on the lighter side and adjust to how the bar moves.</p>
        </div>`;
      })()}
      ${last ? `<div class="section-label">Last time</div><div class="card hist-sets">
        ${last.map((s, i) => `<div>Set ${i + 1}: <b>${setLabel(ex, s)}</b></div>`).join('')}
      </div>` : ''}
    </div>`, {
    onOpen(root) {
      root.querySelector('#exd-x').onclick = closeModal;
      lineChart(root.querySelector('#exd-chart'), points,
        x => isWr ? `${x} ${unit()}` : ex.t === 'r' ? `${x} reps` : fmtClock(x));
      const add = root.querySelector('#orm-add');
      if (add) add.onclick = () => {
        const w = +root.querySelector('#orm-w').value;
        if (!(w > 0)) { toast('Enter a weight first'); return; }
        const dval = root.querySelector('#orm-d').value;
        const parts = dval ? dval.split('-').map(Number) : null;
        const ts = parts && parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2], 12).getTime() : Date.now();
        if (!S.maxes) S.maxes = {};
        (S.maxes[exId] = S.maxes[exId] || []).push({ w, ts });
        save();
        toast(`🎯 New max! Here's what to lift next 👇`, 'pr');
        openExerciseDetail(exId, true);
        setTimeout(() => { const c = $('#rec-card'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60);
      };
      root.querySelectorAll('[data-delm]').forEach(b => b.onclick = () => {
        const [ts, w] = b.dataset.delm.split('-');
        S.maxes[exId] = (S.maxes[exId] || []).filter(m => !(String(m.ts) === ts && String(m.w) === w));
        save();
        openExerciseDetail(exId);
      });
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
      (muscle === 'All' || ex.m === muscle || muscle in ex.r) &&
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
    <button class="btn block mt" id="start-gen" style="padding:16px">⚡ Quick workout — pick muscles, get a workout</button>
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
  v.querySelector('#start-gen').onclick = () => openGenerator();
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
      // Pre-fill saved weights/reps (and assistance) from your last session so
      // every set is one tap away — adjust only what changed.
      w: p ? p.w : '', r: p ? p.r : '', time: p ? p.time : '', done: false,
      assist: (p && p.assist) || '',
      pw: p ? p.w : '', pr: p ? p.r : '', pt: p ? p.time : '', pa: (p && p.assist) || '',
      target: parseTargetReps(reps),
    });
  }
  return { exId, targetReps: reps, sets };
}

function startWorkout(name, entries, routineId = null) {
  if (S.active) { go('workout'); return; }
  S.active = { id: uid(), name, routineId, start: Date.now(), entries };
  save();
  acquireWakeLock();
  go('workout');
}

// ---- Screen wake lock: keep the screen on for the whole workout ----
// The lock is auto-released by the OS when the app is backgrounded, so it's
// re-acquired every time the app becomes visible while a workout is active.
let wakeLock = null;
window.__wakeLockOn = false;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || !S.active || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    window.__wakeLockOn = true;
    wakeLock.addEventListener('release', () => { wakeLock = null; window.__wakeLockOn = false; });
  } catch (e) { /* low battery mode etc. — screen falls back to normal timeout */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  window.__wakeLockOn = false;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.active) acquireWakeLock();
});

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
      S.active = null; save(); stopRest(); releaseWakeLock(); closeSwipeGuard(); go('home');
    });
  v.querySelector('#w-finish').onclick = finishWorkout;

  bindWorkoutEvents(v);
}

function entryCard(en, ei) {
  const ex = EXERCISE_BY_ID[en.exId];
  const isTime = ex.t === 't';
  const showW = ex.t === 'wr';
  const canAssist = ex.t === 'r';
  return `
    <div class="card wx-card" data-entry="${ei}">
      <div class="wx-head">
        <button class="wx-name" data-exinfo="${ex.id}" style="text-align:left">${esc(ex.name)}</button>
        <button class="icon-btn" data-swap="${ei}" title="Swap exercise">⇄</button>
        <button class="icon-btn" data-rment="${ei}" title="Remove">✕</button>
      </div>
      <div class="subtle" style="font-size:0.75rem;margin-bottom:4px">${esc(ex.m)} · ${esc(equipShort(ex))}${en.targetReps ? ` · target ${esc(String(en.targetReps))} reps` : ''}</div>
      ${lastTimeLine(en)}
      <table class="set-table">
        <thead><tr>
          <th>Set</th><th>Prev</th>
          ${isTime ? '<th>Time (s)</th>' : `${showW ? `<th>${esc(unit())}</th>` : ''}<th>Reps</th>`}
          ${canAssist ? '<th>Assist</th>' : ''}
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
              ${canAssist ? `<td><button class="assist-btn ${s.assist ? 'has' : ''}" data-assist title="${esc(s.assist || 'No assistance')}">${s.assist ? assistDot(s.assist, 12) : '—'}</button></td>` : ''}
              <td><button class="set-check" data-check>✓</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn sm block mt" data-addset="${ei}">+ Add set</button>
    </div>`;
}

// "Last time: 30×10, 30×8 · Best: 35 lb" reminder line shown on each
// exercise during a workout.
function lastTimeLine(en) {
  const ex = EXERCISE_BY_ID[en.exId];
  const last = lastPerformance(en.exId);
  if (!last || !last.length) return '';
  const weighted = last.some(s => +s.w);
  const parts = last.map(s =>
    ex.t === 't' ? fmtClock(+s.time || 0)
    : weighted ? `${+s.w || 0}×${+s.r || 0}`
    : `${+s.r || 0}${s.assist ? 'ᴬ' : ''}`);
  const rec = exerciseRecords(en.exId, S.active ? S.active.start : Infinity);
  let best = '';
  if (ex.t === 'wr' && rec.bestW) best = ` · Best: ${rec.bestW} ${unit()}`;
  else if (ex.t === 'r' && rec.bestReps) best = ` · Best: ${rec.bestReps} reps`;
  else if (ex.t === 't' && rec.bestTime) best = ` · Best: ${fmtClock(rec.bestTime)}`;
  const label = ex.t === 't' ? '' : weighted ? ` ${unit()}×reps` : ' reps';
  return `<div class="last-time">↩ Last time: ${esc(parts.join(', '))}${label}${esc(best)}</div>`;
}

function prevLabel(ex, s) {
  if (ex.t === 't') return s.pt ? fmtClock(+s.pt) : '—';
  if (ex.t === 'r' && !s.pw) return s.pr ? `${s.pr} reps ${assistDot(s.pa, 8)}` : '—';
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

  v.querySelectorAll('[data-assist]').forEach(btn => {
    btn.onclick = () => {
      const ei = +btn.closest('[data-entry]').dataset.entry;
      const si = +btn.closest('[data-set]').dataset.set;
      const s = w.entries[ei].sets[si];
      openAssistPicker(s.assist, val => {
        s.assist = val;
        save(); render();
      });
    };
  });

  v.querySelectorAll('[data-addset]').forEach(b => b.onclick = () => {
    const en = w.entries[+b.dataset.addset];
    const lastSet = en.sets[en.sets.length - 1];
    en.sets.push({ w: '', r: '', time: '', done: false, assist: lastSet?.assist || '', pw: lastSet?.pw || '', pr: lastSet?.pr || '', pt: lastSet?.pt || '', pa: lastSet?.pa || '', target: lastSet?.target || '' });
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
  else if (ex.t === 'r' && r > 0 && r > prev.bestReps && !s.assist) toast(`🏆 Rep PR on ${esc(ex.name)}: ${r} reps!`, 'pr');
}

function finishWorkout() {
  const w = S.active;
  const doneSets = w.entries.reduce((n, en) => n + en.sets.filter(s => s.done).length, 0);
  if (!doneSets) {
    confirmModal('No sets completed', 'Check off at least one set, or discard the workout.', 'Discard workout', () => {
      S.active = null; save(); stopRest(); releaseWakeLock(); closeSwipeGuard(); go('home');
    });
    return;
  }
  const finished = {
    id: w.id, name: w.name.trim() || 'Workout', routineId: w.routineId,
    start: w.start, end: Date.now(),
    entries: w.entries
      .map(en => ({ exId: en.exId, sets: en.sets.filter(s => s.done).map(s => ({ w: s.w, r: s.r, time: s.time, assist: s.assist || '', done: true })) }))
      .filter(en => en.sets.length),
  };

  // Count PRs vs history before this workout
  let prCount = 0;
  for (const en of finished.entries) {
    const ex = EXERCISE_BY_ID[en.exId];
    const prev = exerciseRecords(en.exId, w.start);
    for (const s of en.sets) {
      const wt = +s.w || 0, r = +s.r || 0;
      if ((ex.t === 'wr' && wt > prev.bestW && wt > 0) || (ex.t === 'r' && r > prev.bestReps && r > 0 && !s.assist)) { prCount++; break; }
    }
  }

  S.workouts.push(finished);
  S.active = null;
  save(); stopRest(); releaseWakeLock(); closeSwipeGuard();

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
// Wall-clock based: the end time is a real timestamp, so the countdown stays
// correct while the app is backgrounded (where JS timers are throttled) and
// even survives closing and reopening the app mid-rest.
let restInt = null, restTimeout = null, restEnd = 0, restTotal = 0;

function restLeftSec() { return Math.max(0, Math.ceil((restEnd - Date.now()) / 1000)); }

function persistRest() {
  if (S.active) { S.active.restEnd = restEnd; S.active.restTotal = restTotal; save(); }
}

function startRest(sec, endTs) {
  stopRest(false);
  restTotal = sec;
  restEnd = endTs || (Date.now() + sec * 1000);
  persistRest();
  $('#rest-banner').classList.remove('hidden');
  drawRest();
  restInt = setInterval(() => {
    if (restLeftSec() <= 0) { restDone(); return; }
    drawRest();
  }, 250);
  // Exact-time fallback: in the background the interval is throttled, but a
  // one-shot timer at the precise end often still fires (posts the notification).
  restTimeout = setTimeout(() => { if (restEnd && restLeftSec() <= 0) restDone(); }, restEnd - Date.now() + 50);
}
function drawRest() {
  const left = restLeftSec();
  $('#rest-time').textContent = fmtClock(left);
  $('#rest-progress').style.width = (restTotal ? left / restTotal * 100 : 0) + '%';
}
function stopRest(clearPersist = true) {
  if (restInt) clearInterval(restInt);
  if (restTimeout) clearTimeout(restTimeout);
  restInt = null; restTimeout = null;
  restEnd = 0;
  $('#rest-banner').classList.add('hidden');
  if (clearPersist && S.active && S.active.restEnd) { S.active.restEnd = 0; save(); }
}
function restDone() {
  stopRest();
  beep();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  toast('⏰ Rest over — next set!');
  notifyRestOver();
}

// ---- System notifications (home-screen app) ----
function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}
function notifyRestOver() {
  if (!S.settings.notify || !notificationsSupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return; // in-app toast/beep already covers it
  navigator.serviceWorker.ready.then(reg =>
    reg.showNotification('⏰ Rest over — next set!', {
      body: S.active ? S.active.name : 'RepForge',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'repforge-rest',
      vibrate: [200, 100, 200],
    })
  ).catch(() => {});
}
// Swipe guard: the moment the app is backgrounded mid-workout (which includes
// opening the app switcher to swipe it away), drop a silent notification into
// the tray reminding you not to kill it. It self-cleans when you come back.
function showSwipeGuard() {
  if (!S.settings.notify || !notificationsSupported() || Notification.permission !== 'granted') return;
  let title, body;
  if (S.active) {
    title = '💪 Workout in progress — don\'t swipe me!';
    body = restEnd
      ? 'Your rest timer can\'t ring if the app is swiped away. Tap to jump back in (or use ⏰ for a Clock timer).'
      : 'Swiping the app away stops the rest alarms and screen wake lock. Tap to jump back into your workout.';
  } else {
    const pi = planInfo();
    const due = habitsDueNow();
    if (due.length) {
      const h = due[0];
      title = `${h.emoji} Don't forget your ${h.name.toLowerCase()}`;
      body = due.length > 1
        ? `${h.name} and ${due.length - 1} more habit${due.length > 2 ? 's' : ''} still to check off today — tap to log.`
        : `Tap to mark today's ${h.name.toLowerCase()} done and keep your streak alive.`;
    } else if (pi && pi.isDay && !pi.doneToday) {
      title = '🏋️ RepForge';
      body = `Today's ${pi.todayName} workout is still waiting — tap to start it.`;
    } else {
      title = '🏋️ RepForge';
      body = 'Tap to jump back into your training.';
    }
  }
  navigator.serviceWorker.ready.then(reg =>
    reg.showNotification(title, {
      body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'repforge-guard',
      silent: true,
    })
  ).catch(() => {});
}
function closeSwipeGuard() {
  if (!notificationsSupported()) return;
  navigator.serviceWorker.ready.then(async reg => {
    (await reg.getNotifications({ tag: 'repforge-guard' })).forEach(n => n.close());
  }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') showSwipeGuard();
  else closeSwipeGuard();
});

async function enableNotifications() {
  if (!notificationsSupported()) {
    toast('Notifications aren\'t supported here — on iPhone, use the app from your home screen (iOS 16.4+).');
    return false;
  }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notifications are blocked — allow them for this app in your phone settings.');
    return false;
  }
  return true;
}
// Pick the rest timer back up after a reload / reopen mid-rest.
function resumeRestIfNeeded() {
  const a = S.active;
  if (!a || !a.restEnd) return;
  if (a.restEnd > Date.now()) startRest(a.restTotal || S.settings.restSec, a.restEnd);
  else { a.restEnd = 0; save(); }
}
// When the app comes back to the foreground, snap the display to real time.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && restEnd) {
    if (restLeftSec() <= 0) restDone();
    else drawRest();
  }
});
// ---- Phone Clock-app timer bridge ----
// The web can't program the Clock app silently, but it can hand off:
// Android exposes the system SET_TIMER intent; iOS is reachable through a
// user-created Apple Shortcut that starts a real Clock timer.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
function phoneTimerUrl(sec) {
  if (IS_IOS) return 'shortcuts://run-shortcut?name=Rest%20Timer&input=text&text=' + sec;
  return 'intent:#Intent;action=android.intent.action.SET_TIMER;i.android.intent.extra.alarm.LENGTH=' + sec +
    ';S.android.intent.extra.alarm.MESSAGE=RepForge%20rest;B.android.intent.extra.alarm.SKIP_UI=true;end';
}
function launchPhoneTimer() {
  const left = restLeftSec();
  if (left <= 0) return;
  if (IS_IOS && !S.settings.iosShortcutReady) { openIosTimerHelp(); return; }
  location.href = phoneTimerUrl(left);
}
function openIosTimerHelp() {
  openModal(`
    <div class="modal-head"><h2>⏰ Phone timer setup</h2><button class="icon-btn" id="ith-x">✕</button></div>
    <div class="modal-body">
      <p class="subtle" style="margin-bottom:10px">iPhones don't let apps set Clock timers directly — but Apple Shortcuts can. One-time setup (~30 seconds):</p>
      <div class="card hist-sets">
        <div>1. Open the <b>Shortcuts</b> app → tap <b>+</b></div>
        <div>2. Name it exactly: <b>Rest Timer</b></div>
        <div>3. Add the action <b>Start Timer</b> (from the Clock app)</div>
        <div>4. Tap the duration → select <b>Shortcut Input</b>, unit <b>seconds</b></div>
      </div>
      <p class="subtle" style="margin:10px 0">After that, tapping ⏰ starts a real Clock timer for your remaining rest — it rings even if this app is closed.</p>
      <button class="btn primary block" id="ith-done">I've set it up — start my timer</button>
      <button class="btn ghost block mt" id="ith-later">Maybe later</button>
    </div>`, {
    onOpen(root) {
      root.querySelector('#ith-x').onclick = closeModal;
      root.querySelector('#ith-later').onclick = closeModal;
      root.querySelector('#ith-done').onclick = () => {
        S.settings.iosShortcutReady = true;
        save(); closeModal();
        launchPhoneTimer();
      };
    },
  });
}
$('#rest-clock').onclick = launchPhoneTimer;

$('#rest-skip').onclick = () => stopRest();
$('#rest-plus').onclick = () => { restEnd += 15000; restTotal = Math.max(restTotal, restLeftSec()); persistRest(); drawRest(); };
$('#rest-minus').onclick = () => { restEnd = Math.max(Date.now() + 1000, restEnd - 15000); persistRest(); drawRest(); };

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
          ? `<b style="font-size:0.92rem">${esc(S.plan.type === 'weekly' ? S.plan.name : S.plan.groups.join(', '))}</b><div class="subtle">${esc(S.plan.type === 'weekly' ? 'Weekly split' : 'Training ' + (FREQ_LABELS[S.plan.freq] || 'on schedule'))}</div>`
          : '<span class="subtle">No plan yet — pick a schedule and muscle groups.</span>'}</div>
        <button class="btn sm" id="prof-plan">${S.plan?.enabled ? 'Edit' : 'Set up'}</button>
      </div>
    </div>

    <div class="section-label">Daily reminders</div>
    <div class="card">
      ${S.habits && S.habits.items.length ? `
        ${S.habits.items.map(h => `
          <div class="row habit-manage" data-hm="${h.id}" style="gap:8px;padding:6px 0">
            <span class="grow"><b style="font-size:0.9rem">${h.emoji} ${esc(h.name)}</b></span>
            <input type="time" value="${esc(h.time || '21:00')}" data-htime="${h.id}" style="width:118px">
            <button class="icon-btn" data-hdel="${h.id}" title="Remove">✕</button>
          </div>`).join('')}
        <button class="btn sm block mt" id="habit-add">+ Add a habit</button>
        <button class="btn sm block mt" id="habit-alarm">⏰ Set a nightly alarm in my phone's Clock app</button>
        <p class="subtle" style="font-size:0.75rem;margin-top:8px">The in-app checklist works offline. For a ping that fires with the app closed, the phone's own alarm is the reliable way — this sets one up.</p>
      ` : `
        <p class="subtle" style="margin-bottom:10px">Track a nightly habit like creatine — check it off each day, build a streak, and get reminded.</p>
        <button class="btn primary block" id="habit-enable">💊 Track creatine &amp; daily habits</button>
      `}
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
      <div class="divider"></div>
      <div class="row" style="justify-content:space-between">
        <div><span>Rest notifications</span>
          <div class="subtle" style="font-size:0.75rem">Pings you when rest is over and you're in another app</div></div>
        <button class="chip ${S.settings.notify ? 'active' : ''}" id="notif-toggle">${S.settings.notify ? 'On' : 'Off'}</button>
      </div>
      <button class="btn sm block mt" id="notif-test">🔔 Test — close the app, notification in 5s</button>
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

  const habEnable = v.querySelector('#habit-enable');
  if (habEnable) habEnable.onclick = () => { S.habits = defaultHabits(); save(); render(); toast('💊 Daily habits on — check them off on Home'); };
  const habAdd = v.querySelector('#habit-add');
  if (habAdd) habAdd.onclick = () => openHabitAdd();
  v.querySelectorAll('[data-htime]').forEach(inp => inp.onchange = () => {
    const h = S.habits.items.find(x => x.id === inp.dataset.htime);
    if (h) { h.time = inp.value || '21:00'; save(); }
  });
  v.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => {
    const h = S.habits.items.find(x => x.id === b.dataset.hdel);
    confirmModal('Remove habit?', `"${h ? h.name : ''}" and its streak history will be removed.`, 'Remove', () => {
      S.habits.items = S.habits.items.filter(x => x.id !== b.dataset.hdel);
      delete S.habits.log[b.dataset.hdel];
      if (!S.habits.items.length) S.habits = null;
      save(); render();
    });
  });
  const habAlarm = v.querySelector('#habit-alarm');
  if (habAlarm) habAlarm.onclick = () => setupNightlyAlarm();

  v.querySelector('#notif-toggle').onclick = async () => {
    if (S.settings.notify) { S.settings.notify = false; save(); render(); return; }
    if (await enableNotifications()) {
      S.settings.notify = true;
      save(); render();
      toast('🔔 Rest notifications on');
    }
  };
  v.querySelector('#notif-test').onclick = async () => {
    if (!(await enableNotifications())) return;
    toast('🔔 Close the app now — test notification in 5 seconds…');
    setTimeout(() => {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification('🔔 Test notification', {
          body: document.visibilityState === 'visible'
            ? 'Notifications work! (Next time close the app first to test the real scenario.)'
            : 'It works — you\'ll get pinged like this when rest is over.',
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: 'repforge-test',
          vibrate: [200, 100, 200],
        })
      ).catch(() => {});
    }, 5000);
  };
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
      try { indexedDB.deleteDatabase(IDB_NAME); } catch (e) { /* best effort */ }
      S = defaultState();
      obStep = 0; obSel = new Set();
      go('home');
    });
}

// ===================== Boot =====================
// Reopening mid-workout drops you straight back into the active workout —
// everything (sets, weights, the clock, the rest timer) is saved on every tap.
if (S.active && S.onboarded) currentTab = 'workout';
render();
resumeRestIfNeeded();
acquireWakeLock();

// Evening nudge: opening the app after a habit's reminder time, still unchecked.
if (S.onboarded && currentTab === 'home') {
  const due = habitsDueNow();
  if (due.length) setTimeout(() => toast(`${due[0].emoji} Reminder: ${due[0].name} not logged yet today`), 900);
}

// If localStorage came up empty (cleared by the browser or a reinstall) but a
// backup exists in IndexedDB, restore it.
if (!S.onboarded && !S.workouts.length) {
  idbRestore(raw => {
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data && (data.onboarded || (data.workouts && data.workouts.length))) {
        S = Object.assign(defaultState(), data);
        localStorage.setItem(STORE_KEY, raw);
        render();
        toast('Your data was restored ✓');
      }
    } catch (e) { /* corrupt backup — ignore */ }
  });
}
