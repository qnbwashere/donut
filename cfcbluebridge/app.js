(() => {
  'use strict';

  const FEEDS = [
    { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/teams/chelsea/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/football/chelsea/rss' },
  ];

  const HASHTAGS = '#CFC #Chelsea #ChelseaFC #PremierLeague #StamfordBridge #cfcbluebridge';

  // ---------- tiny IndexedDB queue store ----------
  const DB_NAME = 'cfc-bluebridge';
  const STORE = 'queue';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbAdd(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbUpdate(id, patch) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (!getReq.result) return resolve();
        store.put(Object.assign(getReq.result, patch));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- toast ----------
  function toast(msg) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ---------- tabs ----------
  const panels = {
    news: document.getElementById('panel-news'),
    poster: document.getElementById('panel-poster'),
    queue: document.getElementById('panel-queue'),
  };
  const tabs = [...document.querySelectorAll('.tab')];

  function showTab(name) {
    for (const key of Object.keys(panels)) {
      panels[key].classList.toggle('hidden', key !== name);
    }
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === name);
    if (name === 'queue') renderQueue();
  }

  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- news ----------
  function stripHtml(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function extractImage(itemEl, descRaw) {
    const thumb = itemEl.getElementsByTagNameNS('*', 'thumbnail')[0];
    if (thumb && thumb.getAttribute('url')) return thumb.getAttribute('url');
    const media = itemEl.getElementsByTagNameNS('*', 'content')[0];
    if (media && media.getAttribute('url')) return media.getAttribute('url');
    const enclosure = itemEl.querySelector('enclosure');
    if (enclosure && (enclosure.getAttribute('type') || '').startsWith('image')) {
      return enclosure.getAttribute('url');
    }
    const m = descRaw.match(/<img[^>]+src="([^"]+)"/i);
    return m ? m[1] : '';
  }

  function parseRSS(xmlText, sourceName) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    return [...doc.querySelectorAll('item')].map((el) => {
      const title = (el.querySelector('title')?.textContent || '').trim();
      const link = (el.querySelector('link')?.textContent || '').trim();
      const pubDate = (el.querySelector('pubDate')?.textContent || '').trim();
      const descRaw = el.querySelector('description')?.textContent || '';
      return {
        title,
        link,
        desc: stripHtml(descRaw),
        image: extractImage(el, descRaw),
        source: sourceName,
        date: pubDate ? new Date(pubDate) : new Date(0),
      };
    }).filter((item) => item.title);
  }

  function guessCategory(title, desc) {
    const t = `${title} ${desc}`.toLowerCase();
    if (/sign|transfer|loan deal|medical|fee agreed|move to|deal agreed/.test(t)) return 'Transfer News';
    if (/injur|surgery|sidelined|return from|fitness test/.test(t)) return 'Injury Update';
    if (/\d+-\d+|beat |win |draw |defeat|full-time|full time|victory|thrash/.test(t)) return 'Match Report';
    if (/line-?up|starting xi|team news|squad named/.test(t)) return 'Team News';
    return 'Club News';
  }

  async function fetchNews() {
    const statusEl = document.getElementById('news-status');
    const listEl = document.getElementById('news-list');
    statusEl.textContent = 'Loading latest headlines…';
    listEl.innerHTML = '';

    const results = await Promise.allSettled(
      FEEDS.map(async (feed) => {
        const res = await fetch(`/api/rss?url=${encodeURIComponent(feed.url)}`);
        if (!res.ok) throw new Error(feed.name);
        const text = await res.text();
        return parseRSS(text, feed.name);
      })
    );

    let items = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') items = items.concat(r.value);
      else failed.push(FEEDS[i].name);
    });

    // de-dupe by normalized title, sort newest first
    const seen = new Set();
    items = items
      .filter((it) => {
        const key = it.title.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.date - a.date)
      .slice(0, 30);

    if (items.length === 0) {
      statusEl.textContent = failed.length
        ? `Couldn't load news right now (${failed.join(', ')} unavailable). You can still build a poster manually.`
        : 'No headlines found.';
      listEl.innerHTML = '<div class="empty-state">No news to show yet. Head to the Poster tab to create one from your own photos.</div>';
      return;
    }

    statusEl.textContent = failed.length
      ? `Loaded ${items.length} headlines (${failed.join(', ')} unavailable).`
      : `Loaded ${items.length} headlines.`;

    for (const item of items) {
      const card = document.createElement('button');
      card.className = 'news-card';
      card.type = 'button';
      const category = guessCategory(item.title, item.desc);
      const imgSrc = item.image ? `/api/image?url=${encodeURIComponent(item.image)}` : '';
      card.innerHTML = `
        ${imgSrc ? `<img src="${imgSrc}" alt="" loading="lazy">` : '<img alt="" loading="lazy">'}
        <div class="news-card-body">
          <span class="news-card-tag">${category} · ${item.source}</span>
          <span class="news-card-title">${escapeHtml(item.title)}</span>
          <span class="news-card-meta">${item.date && !isNaN(item.date) ? item.date.toLocaleDateString() : ''}</span>
        </div>`;
      card.addEventListener('click', () => useNewsItem(item, category, imgSrc));
      listEl.appendChild(card);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function useNewsItem(item, category, imgSrc) {
    document.getElementById('ctl-template').value = 'headline';
    applyTemplateVisibility();
    document.getElementById('ctl-headline').value = item.title;
    document.getElementById('ctl-category').value = category;
    document.getElementById('ctl-source').value = item.source;
    document.getElementById('ctl-caption').value = buildCaption(item.title, category);
    if (imgSrc) {
      poster.selectedPhoto = imgSrc;
      poster.selectedPhotoIsUrl = true;
    }
    showTab('poster');
    redrawPoster();
  }

  document.getElementById('news-refresh').addEventListener('click', fetchNews);

  // ---------- caption ----------
  function buildCaption(headline, category) {
    return `${headline}\n\n${category} 🔵\n\n${HASHTAGS}`;
  }

  function buildMatchdayCaption() {
    const opp = document.getElementById('ctl-opponent').value.trim().toUpperCase() || 'TBC';
    const side = document.getElementById('ctl-homeaway').value === 'H' ? '(H)' : '(A)';
    const comp = document.getElementById('ctl-competition').value;
    const date = document.getElementById('ctl-date').value.trim();
    const ko = document.getElementById('ctl-kickoff').value.trim();
    const venue = document.getElementById('ctl-venue').value.trim();
    return `MATCHDAY 🔵\nCFC vs ${opp} ${side}\n${comp}${date ? ` — ${date}` : ''}${ko ? ` — ${ko}` : ''}${venue ? `\n📍 ${venue}` : ''}\n\n${HASHTAGS}`;
  }

  function buildLineupCaption() {
    const opp = document.getElementById('ctl-opponent').value.trim().toUpperCase() || 'TBC';
    const starters = document.getElementById('ctl-starters').value.trim();
    return `STARTING XI vs ${opp} 🔵\n\n${starters}\n\n${HASHTAGS}`;
  }

  // ---------- template switching ----------
  const TEMPLATE_GROUPS = {
    headline: ['group-headline'],
    matchday: ['group-fixture', 'group-matchday'],
    lineup: ['group-fixture', 'group-lineup'],
  };

  function applyTemplateVisibility() {
    const tpl = document.getElementById('ctl-template').value;
    for (const groupId of ['group-headline', 'group-fixture', 'group-matchday', 'group-lineup']) {
      document.getElementById(groupId).classList.toggle('hidden', !TEMPLATE_GROUPS[tpl].includes(groupId));
    }
  }

  function refreshCaption() {
    const tpl = document.getElementById('ctl-template').value;
    const captionEl = document.getElementById('ctl-caption');
    if (tpl === 'matchday') {
      captionEl.value = buildMatchdayCaption();
    } else if (tpl === 'lineup') {
      captionEl.value = buildLineupCaption();
    } else {
      const headline = document.getElementById('ctl-headline').value.trim();
      if (headline) captionEl.value = buildCaption(headline, document.getElementById('ctl-category').value);
    }
  }

  document.getElementById('ctl-template').addEventListener('change', () => {
    applyTemplateVisibility();
    refreshCaption();
    redrawPoster();
  });

  document.getElementById('ctl-headline').addEventListener('input', () => {
    redrawPoster();
  });
  document.getElementById('ctl-category').addEventListener('change', () => {
    const headline = document.getElementById('ctl-headline').value.trim();
    if (headline) {
      document.getElementById('ctl-caption').value = buildCaption(headline, document.getElementById('ctl-category').value);
    }
    redrawPoster();
  });
  document.getElementById('ctl-source').addEventListener('input', redrawPoster);

  for (const id of ['ctl-opponent', 'ctl-homeaway', 'ctl-competition', 'ctl-date', 'ctl-kickoff', 'ctl-venue']) {
    document.getElementById(id).addEventListener('input', () => { refreshCaption(); redrawPoster(); });
    document.getElementById(id).addEventListener('change', () => { refreshCaption(); redrawPoster(); });
  }
  for (const id of ['ctl-starters', 'ctl-subs']) {
    document.getElementById(id).addEventListener('input', () => { refreshCaption(); redrawPoster(); });
  }

  applyTemplateVisibility();

  // ---------- photos ----------
  const poster = {
    photos: [], // { id, src }
    selectedPhoto: null,
    selectedPhotoIsUrl: false,
  };

  document.getElementById('photo-pick-btn').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });

  document.getElementById('photo-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    for (const file of files) {
      const src = await fileToDataUrl(file);
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      poster.photos.push({ id, src });
    }
    if (poster.photos.length && !poster.selectedPhoto) {
      poster.selectedPhoto = poster.photos[poster.photos.length - 1].src;
      poster.selectedPhotoIsUrl = false;
    }
    renderGallery();
    redrawPoster();
    e.target.value = '';
  });

  document.getElementById('photo-clear-btn').addEventListener('click', () => {
    poster.selectedPhoto = null;
    renderGallery();
    redrawPoster();
  });

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderGallery() {
    const gallery = document.getElementById('photo-gallery');
    gallery.innerHTML = '';
    for (const photo of poster.photos) {
      const img = document.createElement('img');
      img.src = photo.src;
      img.className = poster.selectedPhoto === photo.src ? 'selected' : '';
      img.addEventListener('click', () => {
        poster.selectedPhoto = photo.src;
        poster.selectedPhotoIsUrl = false;
        renderGallery();
        redrawPoster();
      });
      gallery.appendChild(img);
    }
  }

  // ---------- canvas drawing ----------
  const canvas = document.getElementById('poster-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const BLUE = '#03122b';
  const YELLOW = '#fce432';

  let currentImage = null;
  let currentImageSrc = null;
  let redrawQueued = false;

  function redrawPoster() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      doDraw();
    });
  }

  function doDraw() {
    const template = document.getElementById('ctl-template').value;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BLUE;
    ctx.fillRect(0, 0, W, H);

    const finish = () => {
      drawOverlayAndFrame();
      if (template === 'matchday') {
        drawMatchday();
      } else if (template === 'lineup') {
        drawLineup();
      } else {
        const headline = document.getElementById('ctl-headline').value.trim() || 'YOUR HEADLINE HERE';
        const category = document.getElementById('ctl-category').value;
        const sourceLabel = document.getElementById('ctl-source').value.trim();
        drawTopTag(category);
        drawHeadline(headline);
        drawFooter(sourceLabel);
      }
    };

    if (poster.selectedPhoto) {
      if (currentImageSrc === poster.selectedPhoto && currentImage) {
        drawCover(currentImage);
        finish();
      } else {
        const img = new Image();
        if (poster.selectedPhotoIsUrl) img.crossOrigin = 'anonymous';
        img.onload = () => {
          currentImage = img;
          currentImageSrc = poster.selectedPhoto;
          drawCover(img);
          finish();
        };
        img.onerror = () => {
          currentImage = null;
          currentImageSrc = null;
          finish();
        };
        img.src = poster.selectedPhoto;
      }
    } else {
      currentImage = null;
      currentImageSrc = null;
      finish();
    }
  }

  function drawCover(img) {
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function drawOverlayAndFrame() {
    // bottom gradient for legibility
    const grad = ctx.createLinearGradient(0, H * 0.35, 0, H);
    grad.addColorStop(0, 'rgba(3,18,43,0)');
    grad.addColorStop(1, 'rgba(3,18,43,0.96)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // top gradient so the category tag reads
    const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.22);
    topGrad.addColorStop(0, 'rgba(3,18,43,0.75)');
    topGrad.addColorStop(1, 'rgba(3,18,43,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, H * 0.22);

    drawOrnateFrame(40);
  }

  function drawDiamond(cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.stroke();
  }

  function drawPlusCluster(cx, cy) {
    ctx.save();
    ctx.font = '20px sans-serif';
    ctx.fillStyle = YELLOW;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const gap = 16;
    ctx.fillText('+', cx - gap, cy);
    ctx.fillText('+', cx, cy);
    ctx.fillText('+', cx + gap, cy);
    ctx.fillText('+', cx - gap / 2, cy + gap);
    ctx.fillText('+', cx + gap / 2, cy + gap);
    ctx.restore();
  }

  // A shallow chevron with a diamond node at its centre — the flourish
  // used both as the frame corners and as a horizontal section divider.
  function drawFlourishDivider(y, inset) {
    const dip = 16;
    ctx.save();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(inset, y);
    ctx.quadraticCurveTo(W / 2, y + dip * 2, W - inset, y);
    ctx.stroke();
    drawDiamond(W / 2, y + dip, 10);
    ctx.restore();
  }

  function drawOrnateFrame(inset) {
    const x = inset, y = inset, w = W - inset * 2, h = H - inset * 2;
    ctx.save();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (const [cx, cy] of corners) drawDiamond(cx, cy, 14);

    drawPlusCluster(x + 40, y + 40);
    drawPlusCluster(x + w - 40, y + 40);
    ctx.restore();
  }

  // Generic shield placeholder crest — deliberately not a copy of any
  // club's actual badge artwork, just initials in a shield outline.
  function drawShieldBadge(cx, cy, r, code) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.7);
    ctx.lineTo(cx + r, cy - r * 0.7);
    ctx.lineTo(cx + r, cy + r * 0.15);
    ctx.quadraticCurveTo(cx + r, cy + r * 0.9, cx, cy + r * 1.15);
    ctx.quadraticCurveTo(cx - r, cy + r * 0.9, cx - r, cy + r * 0.15);
    ctx.closePath();
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = YELLOW;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(r * 0.62)}px Anton`;
    ctx.fillText(code, cx, cy + r * 0.1);
    ctx.restore();
  }

  function drawTopTag(category) {
    ctx.save();
    ctx.textAlign = 'center';
    const cx = W / 2;
    const cy = 148;

    ctx.font = '600 30px Caveat, cursive';
    ctx.fillStyle = YELLOW;
    ctx.fillText(category, cx, cy);

    // swash underline
    ctx.beginPath();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 3;
    const halfW = Math.max(90, ctx.measureText(category).width / 2 + 20);
    ctx.ellipse(cx, cy + 20, halfW, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function wrapLines(text, maxWidth, font) {
    ctx.font = font;
    const words = text.toUpperCase().split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawHeadline(headline) {
    const maxWidth = W - 160;
    let fontSize = 84;
    let lines;
    do {
      lines = wrapLines(headline, maxWidth, `${fontSize}px Anton`);
      if (lines.length <= 4) break;
      fontSize -= 6;
    } while (fontSize > 40);

    const lineHeight = fontSize * 1.08;
    const blockHeight = lines.length * lineHeight;
    const startY = H - 240 - blockHeight;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${fontSize}px Anton`;
    ctx.fillStyle = '#ffffff';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = fontSize * 0.09;
      ctx.strokeText(line, W / 2, y);
      ctx.fillStyle = YELLOW;
      ctx.fillText(line, W / 2, y);
    });
    ctx.restore();
  }

  function drawFooter(sourceLabel) {
    const barY = H - 96;
    ctx.save();
    ctx.fillStyle = 'rgba(3,18,43,0.92)';
    ctx.fillRect(40, barY, W - 80, 56);
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, barY);
    ctx.lineTo(W - 40, barY);
    ctx.stroke();

    // crest monogram
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px Anton';
    ctx.fillStyle = YELLOW;
    ctx.fillText('CFC', 60, barY + 28);

    ctx.textAlign = 'right';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('@cfcbluebridge', W - 60, barY + 28);

    if (sourceLabel) {
      ctx.textAlign = 'center';
      ctx.font = '400 15px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`Source: ${sourceLabel}`, W / 2, H - 24);
    }
    ctx.restore();
  }

  function getFixtureInfo() {
    const opponent = document.getElementById('ctl-opponent').value.trim().toUpperCase() || 'TBC';
    const side = document.getElementById('ctl-homeaway').value;
    return { opponent, side };
  }

  function drawMatchday() {
    const { opponent, side } = getFixtureInfo();
    const competition = document.getElementById('ctl-competition').value;
    const date = document.getElementById('ctl-date').value.trim();
    const kickoff = document.getElementById('ctl-kickoff').value.trim();
    const venue = document.getElementById('ctl-venue').value.trim();

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '112px Anton';
    ctx.fillStyle = YELLOW;
    ctx.fillText('MATCHDAY', 70, 100);
    ctx.restore();

    drawShieldBadge(112, 300, 44, 'CFC');
    drawShieldBadge(210, 300, 44, opponent.slice(0, 3));

    drawFlourishDivider(H - 150, 60);

    const barY = H - 110;
    ctx.save();
    ctx.fillStyle = 'rgba(3,18,43,0.92)';
    ctx.fillRect(40, barY, W - 80, 70);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 20px Inter, sans-serif';
    ctx.fillStyle = YELLOW;
    ctx.fillText(competition, 60, barY + 22);
    ctx.font = '400 16px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`CFC vs ${opponent} (${side})${venue ? ` · ${venue}` : ''}`, 60, barY + 48);

    ctx.textAlign = 'right';
    ctx.font = 'bold 26px Anton';
    ctx.fillStyle = YELLOW;
    ctx.fillText(kickoff || '--:--', W - 60, barY + 22);
    ctx.font = '400 15px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(date || '', W - 60, barY + 48);
    ctx.restore();
  }

  function drawLineup() {
    const { opponent } = getFixtureInfo();
    const starters = document.getElementById('ctl-starters').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const subs = document.getElementById('ctl-subs').value.split(',').map((s) => s.trim()).filter(Boolean);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '92px Anton';
    ctx.fillStyle = YELLOW;
    ctx.fillText('STARTING', 70, 90);
    ctx.fillText('XI', 70, 180);
    ctx.restore();

    drawShieldBadge(96, 380, 40, 'CFC');
    drawShieldBadge(96, 470, 40, opponent.slice(0, 3));

    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = '500 34px Inter, sans-serif';
    ctx.fillStyle = YELLOW;
    ctx.textBaseline = 'top';
    let y = 330;
    const lineGap = 56;
    starters.slice(0, 11).forEach((name) => {
      ctx.fillText(name, W - 70, y);
      y += lineGap;
    });
    ctx.restore();

    drawFlourishDivider(H - 150, 60);

    if (subs.length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = YELLOW;
      ctx.font = '600 20px Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('Substitutes', W / 2, H - 116);
      ctx.font = '400 16px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(subs.join('  ·  '), W / 2, H - 86);
      ctx.restore();
    }
  }

  // ---------- queue actions ----------
  document.getElementById('btn-add-queue').addEventListener('click', async () => {
    const template = document.getElementById('ctl-template').value;
    let headline;
    if (template === 'matchday') {
      const { opponent, side } = getFixtureInfo();
      headline = `Matchday: CFC vs ${opponent} (${side})`;
    } else if (template === 'lineup') {
      const { opponent } = getFixtureInfo();
      headline = `Starting XI vs ${opponent}`;
    } else {
      headline = document.getElementById('ctl-headline').value.trim();
      if (!headline) {
        toast('Add a headline first');
        return;
      }
    }
    const caption = document.getElementById('ctl-caption').value.trim() || buildCaption(headline, document.getElementById('ctl-category').value);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const item = {
      id: `post-${Date.now()}`,
      dataUrl,
      caption,
      headline,
      createdAt: Date.now(),
      posted: false,
    };
    try {
      await dbAdd(item);
      toast('Added to queue');
      renderQueue();
    } catch (err) {
      toast('Could not save — storage may be full');
    }
  });

  document.getElementById('btn-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'cfcbluebridge-post.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    link.click();
  });

  async function renderQueue() {
    const listEl = document.getElementById('queue-list');
    const countEl = document.getElementById('queue-count');
    const items = await dbGetAll();
    countEl.textContent = items.length ? `${items.length} draft${items.length === 1 ? '' : 's'}` : '';

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state">No drafts yet. Build one in the Poster tab and add it to the queue.</div>';
      return;
    }

    listEl.innerHTML = '';
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'queue-card' + (item.posted ? ' posted' : '');
      card.innerHTML = `
        <img src="${item.dataUrl}" alt="">
        <div class="queue-card-body">
          <div class="queue-caption">${escapeHtml(item.caption)}</div>
          <div class="queue-card-actions">
            <button class="btn-secondary" data-act="copy">Copy caption</button>
            <a class="btn-secondary" download="cfcbluebridge-post.jpg" href="${item.dataUrl}">Download</a>
            <button class="btn-ghost" data-act="delete">Delete</button>
          </div>
          <label class="posted-toggle">
            <input type="checkbox" data-act="toggle" ${item.posted ? 'checked' : ''}>
            Posted to Instagram
          </label>
        </div>`;

      card.querySelector('[data-act="copy"]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.caption);
          toast('Caption copied');
        } catch {
          toast('Could not copy — select the text manually');
        }
      });
      card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        await dbDelete(item.id);
        renderQueue();
      });
      card.querySelector('[data-act="toggle"]').addEventListener('change', async (e) => {
        await dbUpdate(item.id, { posted: e.target.checked });
        renderQueue();
      });

      listEl.appendChild(card);
    }
  }

  // ---------- init ----------
  document.getElementById('ctl-caption').value = '';
  redrawPoster();
  fetchNews();
})();
