const API = '/api';

let currentTournament = null;
let activeModal = null;
let ytPlayers = {};
let ytReady = false;
let ytQueue = [];
let adminTokens = {};

function onYouTubeIframeAPIReady() {
  ytReady = true;
  for (const item of ytQueue) { pendingPlay[item.id] = true; createYTPlayer(item.id, item.videoId, true); }
  ytQueue = [];
}

let pendingPlay = {};

function createYTPlayer(playerId, videoId, autoPlay) {
  const container = document.getElementById('yt-host-' + playerId);
  if (!container || ytPlayers[playerId]) return;
  setBtnState(playerId, 'loading');
  ytPlayers[playerId] = new YT.Player('yt-host-' + playerId, {
    height: '1', width: '1', videoId, playerVars: { autoplay: 0, controls: 0 },
    events: {
      onReady: () => {
        if (pendingPlay[playerId]) {
          try { ytPlayers[playerId].playVideo(); } catch (e) {}
          delete pendingPlay[playerId];
}

function exportBracket() {
  const el = document.getElementById('bracket-container');
  if (!el) { showToast('No bracket to export', 'error'); return; }
  showToast('Generating image...', 'info');
  html2canvas(el, { backgroundColor: '#0a0a0f', scale: 2 }).then(canvas => {
    const link = document.createElement('a');
    link.download = (currentTournament?.title || 'bracket').replace(/[^a-zA-Z0-9]/g, '_') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Image saved!', 'success');
  }).catch(() => { showToast('Export failed', 'error'); });
}
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) { setBtnState(playerId, 'playing'); updateProgress(playerId); }
        else if (event.data === YT.PlayerState.BUFFERING) setBtnState(playerId, 'loading');
        else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) setBtnState(playerId, 'paused');
      },
      onError: (event) => {
        console.warn('YT player error', playerId, event.data);
        setBtnState(playerId, 'error');
      }
    }
  });
}

function setBtnState(playerId, state) {
  const btn = document.querySelector(`[data-player-id="${playerId}"]`);
  if (!btn) return;
  btn.classList.remove('playing', 'loading', 'error');
  const spinner = btn.querySelector('.audio-spinner');
  if (spinner) spinner.remove();
  if (state === 'playing') { btn.innerHTML = '&#9646;&#9646;'; btn.classList.add('playing'); }
  else if (state === 'loading') { btn.innerHTML = ''; btn.classList.add('loading'); const s = document.createElement('span'); s.className = 'audio-spinner'; btn.appendChild(s); }
  else if (state === 'error') { btn.innerHTML = '&#10007;'; btn.classList.add('error'); }
  else { btn.innerHTML = '&#9654;'; }
}

function updateProgress(playerId) {
  const player = ytPlayers[playerId];
  if (!player || typeof player.getCurrentTime !== 'function') return;
  if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;
  const current = player.getCurrentTime(), duration = player.getDuration();
  const playerEl = document.querySelector(`[data-player-id="${playerId}"]`);
  if (!playerEl) return;
  const progress = playerEl.closest('.audio-player')?.querySelector('.audio-progress-fill');
  const timeEl = playerEl.closest('.audio-player')?.querySelector('.audio-time');
  if (duration > 0 && progress) progress.style.width = (current / duration * 100) + '%';
  if (timeEl) timeEl.textContent = formatTime(current) + ' / ' + formatTime(duration);
  requestAnimationFrame(() => updateProgress(playerId));
}

function formatTime(seconds) { const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

function toggleYTPlay(playerId, videoId) {
  stopAllPlayers(playerId);
  if (!ytPlayers[playerId]) {
    const container = document.getElementById('yt-host-' + playerId);
    if (container) {
      pendingPlay[playerId] = true;
      if (ytReady) createYTPlayer(playerId, videoId, true);
      else { setBtnState(playerId, 'loading'); ytQueue.push({ id: playerId, videoId }); }
    }
    return;
  }
  const player = ytPlayers[playerId];
  if (typeof player.getPlayerState !== 'function') return;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
  else { setBtnState(playerId, 'loading'); player.playVideo(); }
}

function stopAllPlayers(exceptId) {
  for (const id of Object.keys(ytPlayers)) {
    if (id !== exceptId && typeof ytPlayers[id].pauseVideo === 'function') ytPlayers[id].pauseVideo();
  }
}

function getAdminToken(tournamentId) { return adminTokens[tournamentId] || localStorage.getItem('mb_admin_' + tournamentId); }
function setAdminToken(tournamentId, token) { adminTokens[tournamentId] = token; if (token) localStorage.setItem('mb_admin_' + tournamentId, token); else localStorage.removeItem('mb_admin_' + tournamentId); }
function isAdmin(tournament) { return !tournament.has_password || tournament.is_admin; }

function doAdminLogout(tournamentId) {
  setAdminToken(tournamentId, null);
  delete adminTokens[tournamentId];
  navigate('/');
  showToast('Logged out', 'success');
}

async function apiAuth(method, path, body, tournamentId) {
  const token = getAdminToken(tournamentId);
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (res.status === 401 && token) { setAdminToken(tournamentId, null); delete adminTokens[tournamentId]; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function audioPlayerHTML(entry, suffix) {
  const playerId = 'yt-' + entry.id + '-' + suffix;
  const ytId = extractYouTubeId(entry.youtube_url);
  if (entry.name === '???' || !ytId) {
    if (!entry.youtube_url) return '<span class="audio-unavailable">No audio</span>';
    return `<a href="${esc(entry.youtube_url)}" target="_blank" rel="noopener" class="audio-link" onclick="event.stopPropagation()">&#9654; Listen</a>`;
  }
  return `<div class="audio-player">
    <button class="audio-play-btn" data-player-id="${playerId}" onclick="event.stopPropagation(); toggleYTPlay('${playerId}', '${ytId}')">&#9654;</button>
    <div class="audio-progress"><div class="audio-progress-fill"></div></div>
    <span class="audio-time"></span>
  </div>
  <div class="yt-host-hidden" id="yt-host-${playerId}"></div>`;
}

function init() {
  if (window.location.hash && window.location.hash.startsWith('#/')) {
    const path = window.location.hash.slice(1);
    history.replaceState(null, '', path);
  }
  window.addEventListener('popstate', route);
  route();
}

function route() {
  const path = window.location.pathname || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) renderHome();
  else if (parts[0] === 'new') renderNewTournament();
  else if (parts.length >= 2 && parts[0] === 'tournament') {
    const idOrCode = parts[1];
    if (parts[2] === 'bracket') renderBracket(idOrCode);
    else renderTournament(idOrCode);
  } else {
    resolveAndRender(parts[0]);
  }
}

async function resolveAndResolve(code) {
  try {
    const data = await api('GET', `/tournaments/code/${code}`);
    return { ...data, _resolvedBy: 'code' };
  } catch (e) { return null; }
}

async function loadTournament(idOrCode) {
  let res = await fetch(API + `/tournaments/${idOrCode}`);
  if (!res.ok) {
    res = await fetch(API + `/tournaments/code/${idOrCode}`);
  }
  if (!res.ok) return null;
  let data = await res.json();
  const token = getAdminToken(data.id);
  if (token && !data.is_admin) {
    const authRes = await fetch(API + `/tournaments/${data.id}`, { headers: { Authorization: 'Bearer ' + token } });
    if (authRes.ok) data = await authRes.json();
  }
  return data;
}

async function resolveAndRender(code) {
  const data = await loadTournament(code);
  if (!data) { navigate('/'); return; }
  if (data.status === 'draft' || !data.matches || data.matches.length === 0) renderTournamentByData(data);
  else renderBracketByData(data);
}

function navigate(path) { history.pushState(null, '', path); route(); }

// --- HOME ---

function renderHome() {
  currentTournament = null;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="header"><div class="header-inner">
      <a class="logo" onclick="event.preventDefault(); navigate('/')">
        <div class="logo-icon">&#9835;</div><div class="logo-text">Music<span>Bracket</span></div>
      </a>
      <button class="btn btn-secondary btn-small" onclick="showFaq()">&#9432; How It Works</button>
    </div></div>
    <div class="container" style="max-width:600px;">
      <div style="text-align:center;padding:24px 0 16px;">
        <div style="font-size:48px;margin-bottom:8px;">&#9835;</div>
        <h1 class="page-title" style="margin-bottom:4px;">Music Bracket</h1>
        <p class="page-subtitle" style="margin-bottom:16px;">Create a bracket tournament for your favorite music. Share the link and let people vote.</p>
      </div>
      <div class="panel">
        <div class="form-group"><label>Title</label>
          <input type="text" id="inp-title" placeholder="e.g. Best Smashing Pumpkins B-Side" autofocus></div>
        <div class="form-group"><label>Description (optional)</label>
          <textarea id="inp-desc" placeholder="Describe what this bracket is about..." rows="2"></textarea></div>
        <div class="form-group"><label>Admin Password (optional)</label>
          <input type="password" id="inp-password" placeholder="Leave empty for open access">
          <div class="form-hint">Set a password to restrict who can vote and reveal matches. Without it, anyone can vote.</div></div>
        <div class="btn-row"><button class="btn btn-primary" onclick="createTournament()">Create Tournament</button></div>
        <div style="text-align:center;margin-top:24px;padding-top:24px;border-top:1px solid var(--border);">
          <p style="color:var(--text-dim);font-size:14px;margin-bottom:12px;">Have a room code?</p>
          <div class="join-row">
            <input type="text" id="inp-join-code" placeholder="e.g. k3x9mf">
            <button class="btn btn-secondary" onclick="joinByCode()">Join</button>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px;">
        <div class="panel-title">Recent Tournaments</div>
        <div id="recent-list" class="recent-list">Loading...</div>
      </div>
    </div>`;
  loadRecentTournaments();
  document.getElementById('inp-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') createTournament(); });
  document.getElementById('inp-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
}

async function loadRecentTournaments() {
  const list = document.getElementById('recent-list');
  if (!list) return;
  try {
    const data = await api('GET', '/tournaments/recent');
    if (!data || data.length === 0) {
      list.innerHTML = '<div class="recent-empty">No tournaments yet</div>';
      return;
    }
    list.innerHTML = data.map(t => `
      <a class="recent-item" href="/${t.code}" onclick="event.preventDefault(); navigate('/${t.code}')">
        <div class="recent-title">${esc(t.title)}</div>
        <div class="recent-meta">${t.entry_count} songs &middot; ${t.status}</div>
      </a>`).join('');
  } catch (e) {
    list.innerHTML = '<div class="recent-empty">Could not load</div>';
  }
}

function joinByCode() {
  const code = document.getElementById('inp-join-code').value.trim().toLowerCase();
  if (!code) return;
  navigate('/' + code);
}

async function createTournament() {
  const title = document.getElementById('inp-title').value.trim();
  const desc = document.getElementById('inp-desc').value.trim();
  const password = document.getElementById('inp-password').value;
  if (!title) { showToast('Title is required', 'error'); return; }
  try {
    const t = await api('POST', '/tournaments', { title, description: desc, admin_password: password || undefined });
    if (password) setAdminToken(t.id, null);
    navigate(`/tournament/${t.id}`);
  } catch (e) { showToast(e.message, 'error'); }
}

// --- TOURNAMENT SETUP ---

async function renderTournament(idOrCode) {
  const data = await loadTournament(idOrCode);
  if (!data) { showToast('Tournament not found', 'error'); navigate('/'); return; }
  renderTournamentByData(data);
}

function renderTournamentByData(data) {
  currentTournament = data;
  const id = data.id;
  const code = data.code;
  const isDraft = data.status === 'draft';
  const isAdm = isAdmin(data);
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="header"><div class="header-inner">
      <a class="logo" onclick="event.preventDefault(); navigate('/')">
        <div class="logo-icon">&#9835;</div><div class="logo-text">Music<span>Bracket</span></div>
      </a>
    </div></div>
    <div class="container">
      <div class="action-bar">
        <div class="action-bar-left">
          <span class="badge badge-${data.status}">${data.status}</span>
          ${data.has_password ? (isAdm ? '<span class="badge badge-admin">&#128274; Admin</span>' : '<span class="badge badge-locked">&#128274; Read Only</span>') : ''}
        </div>
        <div class="action-bar-right">
          ${data.has_password && isAdm ? '<button class="btn btn-secondary btn-small" onclick="doAdminLogout(' + id + ')">Logout</button>' : ''}
          ${data.has_password && !isAdm ? '<button class="btn btn-secondary btn-small" onclick="showAdminLogin(' + id + ')">Admin Login</button>' : ''}
          ${isAdm ? '<button class="btn btn-danger btn-small" onclick="deleteTournament(' + id + ')">Delete</button>' : ''}
        </div>
      </div>
      <h1 class="page-title">${esc(data.title)}</h1>
      ${data.description ? `<p class="page-subtitle">${esc(data.description)}</p>` : '<p class="page-subtitle">No description</p>'}
      ${!isDraft ? `
        <div style="margin-bottom:24px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="navigate('/${code}')">&#9835; View Bracket</button>
          <button class="btn btn-share-wa" onclick="shareWhatsApp('${code}')">&#128172; WhatsApp</button>
          <button class="btn btn-share-copy" onclick="copyLink('${code}')">&#128203; Copy Link</button>
          ${isAdm ? '<button class="btn btn-secondary" onclick="resetTournament(' + id + ')">Reset to Draft</button>' : ''}
        </div>
        <div class="panel">
          <div class="panel-title">&#9835; Entries (${data.entries.length})</div>
          ${renderEntryList(data.entries, isAdm, false)}
        </div>
      ` : `
        ${isAdm ? `
        <div class="setup-layout">
          <div>
            <div class="panel">
              <div class="panel-title">&#9835; Entries (${data.entries.length})</div>
              ${data.entries.length === 0 ? '<p style="color:var(--text-dim);font-size:14px;">Add entries to get started</p>' : ''}
              ${renderEntryList(data.entries, true, true)}
            </div>
          </div>
          <div>
            <div class="panel" style="margin-bottom:16px;">
              <div class="panel-title">&#43; Add Entry</div>
              <div id="add-entry-form">
                <div class="form-group"><label>Name</label>
                  <input type="text" id="inp-entry-name" placeholder="Song or track name"></div>
                <div class="form-group"><label>YouTube URL (optional)</label>
                  <input type="text" id="inp-entry-youtube" placeholder="https://youtube.com/watch?v=..."></div>
                <button class="btn btn-primary" onclick="addEntry(${id})">Add Entry</button>
              </div>
              <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
                <details class="faq-item">
                  <summary class="faq-question">Bulk Import</summary>
                  <div class="faq-answer" style="padding:12px 16px;">
                    <p style="margin-bottom:8px;">One entry per line. Format: <code>Song Name | YouTube URL</code> (URL is optional)</p>
                    <textarea id="inp-bulk-entries" rows="6" placeholder="Artist - Song Title&#10;Another Song | https://youtube.com/watch?v=...&#10;Third Track"></textarea>
                    <button class="btn btn-secondary" style="margin-top:8px;" onclick="bulkImport(${id})">Import All</button>
                  </div>
                </details>
              </div>
            </div>
            <div class="panel">
              <div class="panel-title">&#9881; Actions</div>
              <div class="start-info">
                ${data.entries.length < 2 ? `Need at least <strong>2 entries</strong> to start` : ''}
                ${data.entries.length >= 2 && (data.entries.length & (data.entries.length - 1)) !== 0 ? `You have <strong>${data.entries.length} entries</strong>. Top seeds will get byes to fill the ${nextPowerOf2(data.entries.length)}-entry bracket.` : ''}
                ${data.entries.length >= 2 && (data.entries.length & (data.entries.length - 1)) === 0 ? `Ready to start with <strong>${data.entries.length} entries</strong>!` : ''}
              </div>
              ${data.entries.length >= 2 ? `<div class="start-actions">
                <button class="btn btn-primary" onclick="startTournament(${id})">&#9654; Start Tournament</button>
                <button class="btn btn-secondary" onclick="shuffleEntries(${id})" title="Randomize seed order">&#128256; Shuffle</button>
              </div>` : ''}
              <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
                <div class="form-group"><label>Admin Password (optional)</label>
                  <input type="password" id="inp-setup-password" placeholder="Set password to restrict voting" value="">
                  <div class="form-hint">Leave empty to allow anyone to vote</div></div>
              </div>
            </div>
          </div>
        </div>` : `<div class="panel"><p>A password is required to manage this tournament. <button class="btn btn-secondary btn-small" onclick="showAdminLogin(${id})">Admin Login</button></p></div>`}
      `}
    </div>`;
  const nameInput = document.getElementById('inp-entry-name');
  if (nameInput) { nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addEntry(id); }); nameInput.focus(); }
}

function renderEntryList(entries, canEdit, canRemove) {
  if (entries.length === 0) return '';
  return `<ul class="entry-list">${entries.map(e => `
    <li class="entry-item${e.name === '???' ? ' entry-hidden' : ''}">
      <div class="entry-seed">${e.seed}</div>
      <div class="entry-info">
        <div class="entry-name${e.name === '???' ? ' entry-name-blurred' : ''}">${esc(e.name)}</div>
        ${e.youtube_url && e.name !== '???' ? `<div class="entry-youtube">${audioPlayerHTML(e, 'entry')}</div>` : ''}
      </div>
      ${canEdit && e.name !== '???' ? `<button class="entry-edit" onclick="showEditEntry(${e.tournament_id}, ${e.id})" title="Edit">&#9998;</button>` : ''}
      ${canRemove ? `<button class="entry-remove" onclick="removeEntry(${e.tournament_id}, ${e.id})" title="Remove">&#10005;</button>` : ''}
    </li>`).join('')}</ul>`;
}

async function addEntry(id) {
  const name = document.getElementById('inp-entry-name').value.trim();
  const youtube = document.getElementById('inp-entry-youtube').value.trim();
  if (!name) { showToast('Entry name is required', 'error'); return; }
  if (currentTournament?.entries?.some(e => e.name.toLowerCase() === name.toLowerCase())) {
    showToast('"' + name + '" already exists', 'error'); return;
  }
  try {
    await apiAuth('POST', `/tournaments/${id}/entries`, { name, youtube_url: youtube }, id);
    document.getElementById('inp-entry-name').value = '';
    document.getElementById('inp-entry-youtube').value = '';
    document.getElementById('inp-entry-name').focus();
    renderTournament(id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function bulkImport(id) {
  const text = document.getElementById('inp-bulk-entries').value.trim();
  if (!text) { showToast('Paste entries to import', 'error'); return; }
  const lines = text.split('\n').filter(l => l.trim());
  const entries = [];
  const existingNames = new Set((currentTournament?.entries || []).map(e => e.name.toLowerCase()));
  const duplicateNames = [];
  for (const line of lines) {
    const parts = line.split('|');
    const name = parts[0].trim();
    const youtube_url = (parts[1] || '').trim();
    if (!name) continue;
    if (existingNames.has(name.toLowerCase())) { duplicateNames.push(name); continue; }
    entries.push({ name, youtube_url });
    existingNames.add(name.toLowerCase());
  }
  if (duplicateNames.length > 0) {
    showToast('Skipped duplicates: ' + duplicateNames.join(', '), 'error');
  }
  if (entries.length === 0) { showToast('No new entries to import', 'error'); return; }
  try {
    const result = await apiAuth('POST', `/tournaments/${id}/entries/bulk`, { entries }, id);
    document.getElementById('inp-bulk-entries').value = '';
    showToast('Added ' + result.added + ' entries', 'success');
    renderTournament(id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function removeEntry(tournamentId, entryId) {
  try { await apiAuth('DELETE', `/tournaments/${tournamentId}/entries/${entryId}`, null, tournamentId); renderTournament(tournamentId); }
  catch (e) { showToast(e.message, 'error'); }
}

function showEditEntry(tournamentId, entryId) {
  const entry = currentTournament?.entries?.find(e => e.id === entryId);
  if (!entry) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (ev) => { if (ev.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><div class="modal-title">&#9998; Edit Entry</div><button class="modal-close" onclick="closeModal()">&#10005;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Name</label><input type="text" id="inp-edit-name" value="${esc(entry.name)}"></div>
      <div class="form-group"><label>YouTube URL</label><input type="text" id="inp-edit-youtube" value="${esc(entry.youtube_url || '')}" placeholder="https://youtube.com/watch?v=..."></div>
      <button class="btn btn-primary" onclick="doEditEntry(${tournamentId}, ${entryId})">Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  activeModal = overlay;
  document.addEventListener('keydown', modalKeyHandler);
  document.getElementById('inp-edit-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doEditEntry(tournamentId, entryId); });
}

async function doEditEntry(tournamentId, entryId) {
  const name = document.getElementById('inp-edit-name').value.trim();
  const youtube_url = document.getElementById('inp-edit-youtube').value.trim();
  if (!name) { showToast('Entry name is required', 'error'); return; }
  try {
    await apiAuth('PUT', `/tournaments/${tournamentId}/entries/${entryId}`, { name, youtube_url }, tournamentId);
    closeModal();
    renderTournament(tournamentId);
    showToast('Entry updated', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function startTournament(id) {
  const pwField = document.getElementById('inp-setup-password');
  const password = pwField ? pwField.value : '';
  try {
    if (password) {
      const pwData = await apiAuth('PUT', `/tournaments/${id}/password`, { admin_password: password }, id);
      if (pwData.token) setAdminToken(id, pwData.token);
    }
    await apiAuth('POST', `/tournaments/${id}/start`, null, id);
    const data = await loadTournament(id);
    navigate('/' + data.code);
  } catch (e) { showToast(e.message, 'error'); }
}

async function resetTournament(id) {
  if (!confirm('Reset this tournament to draft? All bracket progress will be lost.')) return;
  try { await apiAuth('POST', `/tournaments/${id}/reset`, null, id); renderTournament(id); }
  catch (e) { showToast(e.message, 'error'); }
}

async function deleteTournament(id) {
  if (!confirm('Delete this tournament permanently?')) return;
  try { await apiAuth('DELETE', `/tournaments/${id}`, null, id); navigate('/'); }
  catch (e) { showToast(e.message, 'error'); }
}

async function restartTournament(id) {
  if (!confirm('Restart this bracket? All match results will be cleared. Entries will be kept.')) return;
  try {
    const data = await apiAuth('POST', `/tournaments/${id}/restart`, null, id);
    currentTournament = data;
    renderTournamentByData(data);
    showToast('Bracket restarted — entries kept', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function shuffleEntries(id) {
  try { await apiAuth('POST', `/tournaments/${id}/shuffle`, null, id); renderTournament(id); }
  catch (e) { showToast(e.message, 'error'); }
}

function showAdminLogin(id) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (ev) => { if (ev.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><div class="modal-title">&#128274; Admin Login</div><button class="modal-close" onclick="closeModal()">&#10005;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Password</label><input type="password" id="inp-admin-pw" placeholder="Enter admin password" autofocus></div>
      <button class="btn btn-primary" onclick="doAdminLogin(${id})">Login</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  activeModal = overlay;
  document.addEventListener('keydown', modalKeyHandler);
  document.getElementById('inp-admin-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdminLogin(id); });
}

async function doAdminLogin(id) {
  const password = document.getElementById('inp-admin-pw').value;
  if (!password) { showToast('Password is required', 'error'); return; }
  try {
    const data = await api('POST', `/tournaments/${id}/auth`, { password });
    if (data.token) { setAdminToken(id, data.token); }
    closeModal();
    if (window.location.pathname.includes('/bracket') || currentTournament?.status !== 'draft') renderBracket(id);
    else renderTournament(id);
    showToast('Admin access granted', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// --- SHARE ---

async function shareWhatsApp(code) {
  try {
    const data = await api('GET', `/tournaments/code/${code}/share`);
    window.open(data.whatsapp, '_blank');
  } catch (e) {
    const url = window.location.origin + '/' + code;
    window.open(`https://wa.me/?text=${encodeURIComponent('Check out this bracket!\\n\\n' + url)}`, '_blank');
  }
}

function copyLink(code) {
  const url = window.location.origin + '/' + code;
  const textarea = document.createElement('textarea');
  textarea.value = url;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); showToast('Link copied!', 'success'); }
  catch (e) { showToast('Failed to copy', 'error'); }
  document.body.removeChild(textarea);
}

// --- BRACKET ---

function nextPowerOf2(n) { let p = 1; while (p < n) p *= 2; return p; }

async function renderBracket(idOrCode) {
  const data = await loadTournament(idOrCode);
  if (!data) { showToast('Tournament not found', 'error'); navigate('/'); return; }
  renderBracketByData(data);
}

function renderBracketByData(data) {
  currentTournament = data;
  const id = data.id;
  const code = data.code;

  const entryMap = {};
  data.entries.forEach(e => { entryMap[e.id] = e; });
  const isAdm = isAdmin(data);
  const allRounds = [];
  const maxRound = data.matches.length > 0 ? Math.max(...data.matches.map(m => m.round)) : 0;
  for (let r = 0; r <= maxRound; r++) allRounds.push(data.matches.filter(m => m.round === r).sort((a, b) => a.position - b.position));
  const visibleRounds = isAdm ? allRounds : allRounds.filter(round => round.some(m => m.revealed));
  const roundLabels = getRoundLabels(allRounds.length, allRounds[0] ? allRounds[0].length : 0);
  const isCompleted = data.status === 'completed';
  const champion = isCompleted ? getChampion(data, entryMap) : null;
  const totalMatches = data.matches.length;
  const revealedMatchCount = data.revealed_match_count || 0;
  const canRevealNext = isAdm && data.has_password && revealedMatchCount < totalMatches;
  const lastRevealedMatch = revealedMatchCount > 0 ? data.matches.slice().sort((a, b) => a.round - b.round || a.position - b.position)[revealedMatchCount - 1] : null;
  const canRevealNextMatch = canRevealNext && (revealedMatchCount === 0 || !lastRevealedMatch || lastRevealedMatch.winner_id !== null || lastRevealedMatch.entry1_id === null || lastRevealedMatch.entry2_id === null);
  const allMatchesRevealed = revealedMatchCount >= totalMatches;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="header"><div class="header-inner">
      <a class="logo" onclick="event.preventDefault(); navigate('/')">
        <div class="logo-icon">&#9835;</div><div class="logo-text">Music<span>Bracket</span></div>
      </a>
    </div></div>
    <div class="container">
      <div class="action-bar">
        <div class="action-bar-left">
          <button class="btn btn-secondary btn-small" onclick="navigate('/tournament/${id}')">&#8592; Setup</button>
          <span class="badge badge-${data.status}">${data.status}</span>
          ${data.has_password ? (isAdm ? '<span class="badge badge-admin">&#128274; Admin</span>' : '<span class="badge badge-locked">&#128274; Read Only</span>') : ''}
        </div>
        <div class="action-bar-right" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-share-wa btn-small" onclick="shareWhatsApp('${code}')">&#128172; WhatsApp</button>
          <button class="btn btn-share-copy btn-small" onclick="copyLink('${code}')">&#128203; Copy Link</button>
          <button class="btn btn-secondary btn-small" onclick="exportBracket()">&#128247; Export</button>
          ${isAdm ? '<button class="btn btn-secondary btn-small" onclick="restartTournament(' + id + ')">Restart</button>' : ''}
          ${data.has_password && isAdm ? '<button class="btn btn-secondary btn-small" onclick="doAdminLogout(' + id + ')">Logout</button>' : ''}
          ${isAdm ? '<button class="btn btn-danger btn-small" onclick="deleteTournament(' + id + ')">Delete</button>' : ''}
        </div>
      </div>
      <h1 class="page-title">${esc(data.title)}</h1>
      ${data.description ? `<p class="page-subtitle">${esc(data.description)}</p>` : ''}
      ${isAdm ? `<div class="panel" style="margin-bottom:16px;"><details><summary class="panel-title" style="cursor:pointer;">&#9835; Entries (${data.entries.length}) — click to edit</summary>${renderEntryList(data.entries, true, false)}</details></div>` : ''}
      ${isAdm && data.has_password ? renderRevealPanel(data, totalMatches, revealedMatchCount, canRevealNext, canRevealNextMatch, allMatchesRevealed) : ''}
      ${!isAdm && data.has_password ? '<div class="admin-prompt"><button class="btn btn-secondary" onclick="showAdminLogin(' + id + ')">&#128274; Admin Login</button><span class="admin-prompt-text">Login to vote and manage the bracket</span></div>' : ''}
      ${champion ? `<div class="champion-banner"><div class="champion-label">&#127942; Champion</div><div class="champion-name">${esc(champion.name)}</div><div class="champion-seed">Seed #${champion.seed}</div></div>` : ''}
      ${visibleRounds.length === 0 ? '<div class="empty-state"><div class="empty-state-icon">&#128065;</div><div class="empty-state-title">Matches not yet revealed</div><div class="empty-state-text">Check back later or ask the admin to reveal matches.</div></div>' : ''}
      <div class="bracket-view">
        <div id="bracket-container">
          ${renderBracketRounds(visibleRounds, roundLabels, entryMap, data, isAdm, allRounds)}
        </div>
      </div>
    </div>`;
}

function renderRevealPanel(data, totalMatches, revealedMatchCount, canRevealNext, canRevealNextMatch, allMatchesRevealed) {
  const progressPct = totalMatches > 0 ? Math.round(revealedMatchCount / totalMatches * 100) : 0;
  let revealBtnLabel = revealedMatchCount === 0 ? '&#9654; Reveal First Match' : '&#9654; Reveal Next Match';
  let revealBtnDisabled = '';
  if (!canRevealNextMatch) revealBtnDisabled = ' disabled title=&quot;Pick a winner for the current match first&quot;';
  return `<div class="reveal-panel">
    <div class="reveal-panel-title">&#128065; Match Reveals</div>
    <div class="reveal-progress">
      <div class="reveal-progress-bar"><div class="reveal-progress-fill" style="width:${progressPct}%"></div></div>
      <div class="reveal-progress-text">${revealedMatchCount} / ${totalMatches} matches revealed</div>
    </div>
    <div class="reveal-actions">
      ${canRevealNext ? `<button class="btn btn-primary btn-small"${revealBtnDisabled} onclick="${revealBtnDisabled ? '' : 'revealNextMatch(' + data.id + ')'}">${revealBtnLabel}</button>` : ''}
      ${!allMatchesRevealed ? `<button class="btn btn-secondary btn-small" onclick="revealAllMatches(${data.id})">Reveal All</button>` : ''}
      ${revealedMatchCount > 0 ? `<button class="btn btn-danger btn-small" onclick="resetReveals(${data.id})">Hide All</button>` : ''}
    </div>
    ${!canRevealNextMatch && canRevealNext ? '<div style="font-size:13px;color:var(--accent);margin-bottom:8px;">Pick a winner for the current match before revealing the next one.</div>' : ''}
<div class="reveal-timer">
      <label class="reveal-mode-label">Auto-reveal:</label>
      <select id="reveal-mode-select" onchange="updateRevealMode(${data.id})">
        <option value="manual" ${data.reveal_mode === 'manual' ? 'selected' : ''}>Manual (click to reveal)</option>
        <option value="timed" ${data.reveal_mode === 'timed' ? 'selected' : ''}>Daily at set time</option>
      </select>
      ${data.reveal_mode === 'timed' ? `
        <div style="display:inline-flex;align-items:center;gap:8px;margin-top:4px;">
          <input type="time" id="reveal-time" value="${data.next_reveal_at ? localTimeFromUTC(data.next_reveal_at) : '12:00'}">
          <button class="btn btn-secondary btn-small" onclick="updateRevealTime(${data.id})">Set</button>
        </div>` : ''}
      ${data.next_reveal_at ? `<div class="reveal-next">Next auto-reveal: ${formatDate(data.next_reveal_at)}</div>` : ''}
    </div>
    </div>`;
}

init();

function getRoundLabels(numRounds, firstRoundMatches) {
  const labels = [];
  if (numRounds === 1) { labels.push('Final'); return labels; }
  if (numRounds === 2) { labels.push('Semifinals', 'Final'); return labels; }
  if (numRounds === 3) { labels.push('Quarterfinals', 'Semifinals', 'Final'); return labels; }
  if (numRounds === 4) { labels.push('Round of 16', 'Quarterfinals', 'Semifinals', 'Final'); return labels; }
  if (numRounds === 5) { labels.push('Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'); return labels; }
  for (let i = 0; i < numRounds - 1; i++) labels.push(`Round ${i + 1}`);
  labels.push('Final');
  return labels;
}

function getChampion(data, entryMap) {
  const finalMatch = data.matches.filter(m => m.round === Math.max(...data.matches.map(m2 => m2.round)));
  if (finalMatch.length === 1 && finalMatch[0].winner_id) return entryMap[finalMatch[0].winner_id];
  return null;
}

function renderBracketRounds(rounds, roundLabels, entryMap, tournament, isAdm, allRounds) {
  const roundIndices = rounds.map(round => round.length > 0 ? round[0].round : 0);
  let html = '';
  html += '<div class="bracket-header">';
  for (let i = 0; i < rounds.length; i++) {
    if (i > 0) html += '<div class="bracket-header-conn"></div>';
    html += `<div class="bracket-header-cell">${roundLabels[roundIndices[i]] || `Round ${roundIndices[i] + 1}`}</div>`;
  }
  html += '</div><div class="bracket-body">';
  for (let i = 0; i < rounds.length; i++) {
    const r = roundIndices[i];
    const flexVal = Math.pow(2, r);
    if (i > 0) {
      const prevR = roundIndices[i - 1];
      const prevFlex = Math.pow(2, prevR - 1);
      const connCount = rounds[i - 1].length / 2 > 0 ? Math.floor(rounds[i - 1].length / 2) : 1;
      html += '<div class="bracket-conn-col">';
      for (let p = 0; p < connCount; p++) {
        html += `<div class="connector-group" style="flex: ${prevFlex * 2};">`;
        html += '<div class="connector-top"></div><div class="connector-bottom"></div></div>';
      }
      html += '</div>';
    }
    html += `<div class="bracket-round-col" data-round="${r}">`;
    for (const match of rounds[i]) {
      html += `<div class="bracket-match-slot" style="flex: ${flexVal};">`;
      html += renderMatchCard(match, entryMap, tournament, r, isAdm);
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderMatchCard(match, entryMap, tournament, round, isAdm) {
  const isRevealed = match.revealed;
  const e1 = match.entry1_id ? entryMap[match.entry1_id] : null;
  const e2 = match.entry2_id ? entryMap[match.entry2_id] : null;
  const canVote = isAdm && tournament.status === 'active' && e1 && e2 && !match.winner_id && isRevealed;
  const isVotable = canVote;
  let classes = 'match-card';
  if (match.winner_id && isRevealed) classes += ' decided';
  if (isVotable) classes += ' clickable';
  if (!isRevealed) classes += ' match-hidden';

  let html = `<div class="${classes}" ${isVotable ? `onclick="openVoteModal(${match.id})"` : ''}>`;
  if (!isRevealed) {
    html += `<div class="match-entry match-entry-hidden"><span class="entry-seed-match">${e1 ? e1.seed : '?'}</span><span class="match-entry-name match-name-blurred">???</span></div>`;
    html += `<div class="match-entry match-entry-hidden">${e2 ? `<span class="entry-seed-match">${e2.seed}</span>` : ''}<span class="match-entry-name match-name-blurred">???</span></div>`;
  } else {
    if (e1) {
      const isWinner = match.winner_id === e1.id;
      const isLoser = match.winner_id && match.winner_id !== e1.id;
      html += `<div class="match-entry ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''} ${isVotable ? 'votable' : ''}">`;
      html += `<span class="entry-seed-match">${e1.seed}</span>`;
      html += `<span class="match-entry-name">${esc(e1.name)}</span>`;
      if (isWinner) html += `<span class="winner-check">&#10003;</span>`;
      if (e1.youtube_url && e1.name !== '???') html += `<span class="match-entry-play">${audioPlayerHTML(e1, 'bracket-m' + match.id + 'e1')}</span>`;
      html += '</div>';
    } else if (match.entry1_id === null && round === 0) {
      html += '<div class="match-bye">Bye</div>';
    } else {
      html += '<div class="match-tbd">TBD</div>';
    }
    if (e2) {
      const isWinner = match.winner_id === e2.id;
      const isLoser = match.winner_id && match.winner_id !== e2.id;
      html += `<div class="match-entry ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''} ${isVotable ? 'votable' : ''}">`;
      html += `<span class="entry-seed-match">${e2.seed}</span>`;
      html += `<span class="match-entry-name">${esc(e2.name)}</span>`;
      if (isWinner) html += `<span class="winner-check">&#10003;</span>`;
      if (e2.youtube_url && e2.name !== '???') html += `<span class="match-entry-play">${audioPlayerHTML(e2, 'bracket-m' + match.id + 'e2')}</span>`;
      html += '</div>';
    } else if (match.entry2_id === null && round === 0) {
      html += '<div class="match-bye">Bye</div>';
    } else {
      html += '<div class="match-tbd">TBD</div>';
    }
  }
  html += '</div>';
  return html;
}

// --- VOTE MODAL ---

async function openVoteModal(matchId) {
  const data = currentTournament;
  if (!data) return;
  const match = data.matches.find(m => m.id === matchId);
  if (!match || !match.revealed) return;
  const entryMap = {};
  data.entries.forEach(e => { entryMap[e.id] = e; });
  const e1 = match.entry1_id ? entryMap[match.entry1_id] : null;
  const e2 = match.entry2_id ? entryMap[match.entry2_id] : null;
  if (!e1 || !e2 || match.winner_id) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (ev) => { if (ev.target === overlay) closeModal(); };
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">&#9835; Vote: ${esc(e1.name)} vs ${esc(e2.name)}</div>
        <button class="modal-close" onclick="closeModal()">&#10005;</button>
      </div>
      <div class="modal-body">
        <div class="vote-instructions">Click your winner to advance them to the next round</div>
        <div class="vote-cards">
          <div class="vote-card" onclick="vote(${matchId}, ${e1.id})">
            <div class="vote-card-seed">Seed #${e1.seed}</div>
            <div class="vote-card-name">${esc(e1.name)}</div>
            ${e1.youtube_url ? `<div class="vote-card-audio">${audioPlayerHTML(e1, 'modal')}</div>` : '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:13px;">No audio available</div>'}
          </div>
          <div class="vote-card" onclick="vote(${matchId}, ${e2.id})">
            <div class="vote-card-seed">Seed #${e2.seed}</div>
            <div class="vote-card-name">${esc(e2.name)}</div>
            ${e2.youtube_url ? `<div class="vote-card-audio">${audioPlayerHTML(e2, 'modal2')}</div>` : '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:13px;">No audio available</div>'}
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  activeModal = overlay;
  document.addEventListener('keydown', modalKeyHandler);
}

function modalKeyHandler(e) { if (e.key === 'Escape') closeModal(); }

function closeModal() {
  stopAllPlayers();
  if (activeModal) { activeModal.remove(); activeModal = null; }
  document.removeEventListener('keydown', modalKeyHandler);
}

async function vote(matchId, winnerId) {
  closeModal();
  try {
    const tid = currentTournament.id;
    const data = await apiAuth('POST', `/matches/${matchId}/vote`, { winner_id: winnerId }, tid);
    currentTournament = data;
    renderBracket(data.id);
    showToast('Vote recorded!', 'success');
  } catch (e) {
    if (e.message.includes('Admin password') || e.message.includes('Invalid')) {
      showToast('Admin login required to vote', 'error');
      showAdminLogin(currentTournament.id);
    } else {
      showToast(e.message, 'error');
    }
  }
}

// --- REVEAL ACTIONS ---

async function revealNextMatch(id) {
  try {
    const data = await apiAuth('POST', `/tournaments/${id}/reveal`, null, id);
    currentTournament = data;
    renderBracket(data.id);
    showToast('Match revealed!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function revealAllMatches(id) {
  try {
    const data = await apiAuth('POST', `/tournaments/${id}/reveal-all`, null, id);
    currentTournament = data;
    renderBracket(data.id);
    showToast('All matches revealed!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function resetReveals(id) {
  if (!confirm('Hide all matches? Only decided results will remain visible.')) return;
  try {
    const data = await apiAuth('POST', `/tournaments/${id}/reset-reveals`, null, id);
    currentTournament = data;
    renderBracket(data.id);
    showToast('Matches hidden', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

function formatDate(s) {
  if (!s) return '';
  const d = s.endsWith('Z') ? new Date(s) : new Date(s + 'Z');
  return isNaN(d) ? s : d.toLocaleString();
}

function localTimeFromUTC(utcStr) {
  if (!utcStr) return '12:00';
  const d = utcStr.endsWith('Z') ? new Date(utcStr) : new Date(utcStr + 'Z');
  if (isNaN(d)) return '12:00';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function nextOccurrenceUTC(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

async function updateRevealMode(id) {
  const modeEl = document.getElementById('reveal-mode-select');
  const reveal_mode = modeEl.value === 'timed' ? 'timed' : 'manual';
  let body = { reveal_mode, reveal_interval_hours: 24 };
  if (reveal_mode === 'timed') {
    const timeEl = document.getElementById('reveal-time');
    const timeVal = timeEl?.value || '12:00';
    body.reveal_time = timeVal;
    body.next_reveal_at = nextOccurrenceUTC(timeVal);
  }
  try {
    const data = await apiAuth('PUT', `/tournaments/${id}/reveal-settings`, body, id);
    currentTournament = data;
    renderBracket(data.id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function updateRevealTime(id) {
  const timeEl = document.getElementById('reveal-time');
  if (!timeEl || !timeEl.value) { showToast('Pick a time first', 'error'); return; }
  const timeVal = timeEl.value;
  const nextAt = nextOccurrenceUTC(timeVal);
  try {
    const data = await apiAuth('PUT', `/tournaments/${id}/reveal-settings`, { reveal_mode: 'timed', reveal_interval_hours: 24, reveal_time: timeVal, next_reveal_at: nextAt }, id);
    currentTournament = data;
    renderBracket(data.id);
    showToast('Auto-reveal set to ' + new Date(nextAt).toLocaleString(), 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) { const match = url.match(pattern); if (match) return match[1]; }
  return null;
}

function esc(str) { if (!str) return ''; const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

const faqContent = `
  <details class="faq-item">
    <summary class="faq-question">What is a music bracket?</summary>
    <div class="faq-answer">A single-elimination tournament where songs go head-to-head in matchups. You listen to two tracks, vote for your favorite, and the winner advances to the next round until only one song remains.</div>
  </details>
  <details class="faq-item">
    <summary class="faq-question">How do I create a tournament?</summary>
    <div class="faq-answer">Fill in a title, add songs with optional YouTube links, then hit Start Tournament. You'll get a shareable link and room code to send to your group.</div>
  </details>
  <details class="faq-item">
    <summary class="faq-question">What does the admin password do?</summary>
    <div class="faq-answer">Setting a password makes you the admin. Only admins can vote (pick winners), reveal matchups one at a time, and edit entries. Without a password, anyone can vote and all matches are visible immediately.</div>
  </details>
  <details class="faq-item">
    <summary class="faq-question">How do match reveals work?</summary>
    <div class="faq-answer">If you set a password, matches start hidden. The admin reveals one matchup at a time — each reveals two songs and their audio. You must pick a winner before revealing the next match. This is great for running a group listening session where everyone discovers each pairing together.</div>
  </details>
  <details class="faq-item">
    <summary class="faq-question">Does auto-reveal work?</summary>
    <div class="faq-answer">Yes — set a daily time (e.g. 12:00 PM) and one match will reveal automatically each day at that time. You still need to pick winners before the next match reveals.</div>
  </details>
  <details class="faq-item">
    <summary class="faq-question">How do I share the bracket?</summary>
    <div class="faq-answer">Use the WhatsApp or Copy Link button on the bracket page. Anyone with the link can view it — no account needed. If you set a password, non-admins see the bracket read-only.</div>
  </details>
  <details class="faq-item">
    <summary class="faq-question">Can I edit songs after starting?</summary>
    <div class="faq-answer">Yes — admins can edit song names and YouTube links at any time by clicking the pen icon next to an entry.</div>
  </details>`;

function showFaq() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">How It Works</div>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&#10005;</button>
      </div>
      <div class="modal-body">${faqContent}</div>
    </div>`;
  document.body.appendChild(overlay);
}