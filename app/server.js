const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'brackets.db'));

const secretPath = path.join(dataDir, 'secret.key');
let SESSION_SECRET;
if (fs.existsSync(secretPath)) {
  SESSION_SECRET = fs.readFileSync(secretPath, 'utf8').trim();
} else {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, SESSION_SECRET);
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    admin_password_hash TEXT,
    revealed_match_count INTEGER DEFAULT 0,
    reveal_mode TEXT DEFAULT 'manual',
    reveal_interval_hours INTEGER DEFAULT 24,
    next_reveal_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    youtube_url TEXT DEFAULT '',
    seed INTEGER DEFAULT 0,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    position INTEGER NOT NULL,
    entry1_id INTEGER,
    entry2_id INTEGER,
    winner_id INTEGER,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_entries_tournament ON entries(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
`);

const migrateCols = [
  ['admin_password_hash', 'TEXT'],
  ['revealed_match_count', 'INTEGER DEFAULT 0'],
  ['reveal_mode', "TEXT DEFAULT 'manual'"],
  ['reveal_interval_hours', 'INTEGER DEFAULT 24'],
  ['next_reveal_at', 'DATETIME'],
  ['code', 'TEXT'],
];
const existingCols = db.prepare("PRAGMA table_info(tournaments)").all().map(c => c.name);
for (const [col, type] of migrateCols) {
  if (!existingCols.includes(col)) {
    db.exec(`ALTER TABLE tournaments ADD COLUMN ${col} ${type}`);
  }
}

try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_code ON tournaments(code)'); } catch(e) {}

const tournamentsWithoutCode = db.prepare('SELECT id FROM tournaments WHERE code IS NULL').all();
for (const t of tournamentsWithoutCode) {
  let code;
  do { code = generateCode(); } while (db.prepare('SELECT id FROM tournaments WHERE code = ?').get(code));
  db.prepare('UPDATE tournaments SET code = ? WHERE id = ?').run(code, t.id);
}

function generateCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateToken(tournamentId) {
  const payload = `${tournamentId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

function verifyToken(token, tournamentId) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [tid, ts, sig] = decoded.split(':');
    if (parseInt(tid) !== tournamentId) return false;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${tid}:${ts}`).digest('hex');
    if (sig !== expected) return false;
    if (Date.now() - parseInt(ts) > 7 * 24 * 60 * 60 * 1000) return false;
    return true;
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  let tid;
  if (req.params.tournamentId) {
    tid = parseInt(req.params.tournamentId);
  } else {
    const match = db.prepare('SELECT tournament_id FROM matches WHERE id = ?').get(req.params.id);
    if (match) tid = match.tournament_id;
    else tid = parseInt(req.params.id);
  }
  const tournament = db.prepare('SELECT admin_password_hash FROM tournaments WHERE id = ?').get(tid);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (!tournament.admin_password_hash) { req.tournamentId = tid; return next(); }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Admin password required' });
  const token = auth.slice(7);
  if (!verifyToken(token, tid)) return res.status(401).json({ error: 'Invalid or expired admin session' });
  req.tournamentId = tid;
  next();
}

function parseDate(s) {
  if (!s) return null;
  return s.endsWith('Z') ? new Date(s) : new Date(s + 'Z');
}

function processTimedReveal(tournament) {
  if (tournament.reveal_mode !== 'timed' || !tournament.next_reveal_at) return tournament;
  const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
  if (tournament.revealed_match_count >= totalMatches) return tournament;
  const nextTime = parseDate(tournament.next_reveal_at);
  if (!nextTime || nextTime <= new Date()) {
    const allMatches = db.prepare('SELECT id, round, position FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id);
    let revealCount = tournament.revealed_match_count;
    while (revealCount < totalMatches) {
      const nextTime2 = parseDate(tournament.next_reveal_at);
      if (nextTime2 > new Date()) break;
      const m = allMatches[revealCount];
      if (m.round === 0) {
        revealCount++;
      } else {
        revealCount++;
      }
      if (revealCount < totalMatches) {
        const newNext = new Date(nextTime2.getTime() + tournament.reveal_interval_hours * 60 * 60 * 1000);
        tournament.next_reveal_at = newNext.toISOString().replace('Z', '');
      }
    }
    db.prepare('UPDATE tournaments SET revealed_match_count = ?, next_reveal_at = ? WHERE id = ?').run(revealCount, tournament.next_reveal_at, tournament.id);
    tournament.revealed_match_count = revealCount;
  }
  return tournament;
}

function sanitizeTournament(t, isAdm) {
  return { id: t.id, code: t.code, title: t.title, description: t.description, status: t.status, created_at: t.created_at, revealed_match_count: t.revealed_match_count, reveal_mode: t.reveal_mode, reveal_interval_hours: t.reveal_interval_hours, next_reveal_at: t.next_reveal_at, has_password: !!t.admin_password_hash, is_admin: isAdm !== undefined ? isAdm : false };
}

function blurTournament(data, isAdmin) {
  if (isAdmin || !data.has_password) return data;
  const matchesOrdered = data.matches.slice().sort((a, b) => a.round - b.round || a.position - b.position);
  const revealedSet = new Set();
  for (let i = 0; i < data.revealed_match_count && i < matchesOrdered.length; i++) {
    revealedSet.add(matchesOrdered[i].id);
  }
  const revealedEntryIds = new Set();
  for (const match of data.matches) {
    if (match.winner_id || revealedSet.has(match.id)) {
      if (match.entry1_id) revealedEntryIds.add(match.entry1_id);
      if (match.entry2_id) revealedEntryIds.add(match.entry2_id);
      if (match.winner_id) revealedEntryIds.add(match.winner_id);
    }
  }
  const blurred = new Set();
  for (const match of data.matches) {
    if (!match.winner_id && !revealedSet.has(match.id)) {
      if (match.entry1_id && !revealedEntryIds.has(match.entry1_id) && !blurred.has(match.entry1_id)) {
        const e1 = data.entries.find(e => e.id === match.entry1_id);
        if (e1) { e1.name = '???'; e1.youtube_url = ''; blurred.add(match.entry1_id); }
      }
      if (match.entry2_id && !revealedEntryIds.has(match.entry2_id) && !blurred.has(match.entry2_id)) {
        const e2 = data.entries.find(e => e.id === match.entry2_id);
        if (e2) { e2.name = '???'; e2.youtube_url = ''; blurred.add(match.entry2_id); }
      }
    }
  }
  return data;
}

function getSeedingOrder(size) {
  const order = [];
  for (let i = 1; i <= size; i++) order.push(i);
  return order;
}

function nextPowerOf2(n) { let p = 1; while (p < n) p *= 2; return p; }

function isDeadSlot(match, nullSlot, tournamentId) {
  if (match.round === 0) return true;
  const sourcePos = nullSlot === 'entry1_id' ? match.position * 2 : match.position * 2 + 1;
  const sourceMatch = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ? AND position = ?').get(tournamentId, match.round - 1, sourcePos);
  if (!sourceMatch) return true;
  if (sourceMatch.entry1_id === null && sourceMatch.entry2_id === null) return true;
  if (sourceMatch.winner_id === null && sourceMatch.entry1_id === null) return true;
  if (sourceMatch.winner_id === null && sourceMatch.entry2_id === null) return true;
  return false;
}

function propagateSlot(matchId, winnerId, tournamentId) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  const nextRound = match.round + 1;
  const nextPosition = Math.floor(match.position / 2);
  const slot = match.position % 2 === 0 ? 'entry1_id' : 'entry2_id';
  const nextMatch = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ? AND position = ?').get(tournamentId, nextRound, nextPosition);
  if (!nextMatch) return;
  db.prepare(`UPDATE matches SET ${slot} = ? WHERE id = ?`).run(winnerId, nextMatch.id);
}

function addRevealFlags(matches, revealedMatchCount, isAdmin) {
  const ordered = matches.slice().sort((a, b) => a.round - b.round || a.position - b.position);
  const idToIndex = new Map();
  for (let i = 0; i < ordered.length; i++) idToIndex.set(ordered[i].id, i);
  return matches.map(m => {
    if (isAdmin) return { ...m, revealed: true };
    const idx = idToIndex.get(m.id);
    const revealed = m.winner_id !== null || (idx !== undefined && idx < revealedMatchCount);
    return { ...m, revealed };
  });
}

// --- PUBLIC ENDPOINTS ---

app.get('/api/tournaments/code/:code', (req, res) => {
  let tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(req.params.code);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  tournament = processTimedReveal(tournament);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id);
  const auth = req.headers.authorization;
  const isAdm = !tournament.admin_password_hash || (auth && auth.startsWith('Bearer ') && verifyToken(auth.slice(7), tournament.id));
  const matchesWithReveal = addRevealFlags(matches, tournament.revealed_match_count, isAdm);
  const data = { ...sanitizeTournament(tournament, isAdm), entries, matches: matchesWithReveal };
  blurTournament(data, isAdm);
res.json(data);
});

app.get('/api/tournaments/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  const tournaments = db.prepare(`
    SELECT id, code, title, description, status, created_at,
           (SELECT COUNT(*) FROM entries WHERE tournament_id = t.id) as entry_count
    FROM tournaments t
    WHERE status IN ('active', 'completed')
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  res.json(tournaments);
});

app.get('/api/tournaments/:id', (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  tournament = processTimedReveal(tournament);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id);
  const auth = req.headers.authorization;
  const isAdm = !tournament.admin_password_hash || (auth && auth.startsWith('Bearer ') && verifyToken(auth.slice(7), tournament.id));
  const matchesWithReveal = addRevealFlags(matches, tournament.revealed_match_count, isAdm);
  const data = { ...sanitizeTournament(tournament, isAdm), entries, matches: matchesWithReveal };
  blurTournament(data, isAdm);
  res.json(data);
});

app.get('/api/tournaments/code/:code/share', (req, res) => {
  let tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(req.params.code);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  tournament = processTimedReveal(tournament);
  const entryCount = db.prepare('SELECT COUNT(*) as count FROM entries WHERE tournament_id = ?').get(tournament.id).count;
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.protocol || 'http';
  const baseUrl = `${proto}://${host}`;
  const url = `${baseUrl}/${tournament.code}`;
  let message;
  if (tournament.status === 'draft') {
    message = `\u{1F3A7} ${tournament.title} \u2014 ${entryCount} entries seeded! Check it out.\n\n${url}`;
  } else if (tournament.status === 'completed') {
    const maxRound = db.prepare('SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?').get(tournament.id).max_round;
    const finalMatch = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ?').get(tournament.id, maxRound);
    let championName = '';
    if (finalMatch && finalMatch.winner_id) {
      const champion = db.prepare('SELECT * FROM entries WHERE id = ?').get(finalMatch.winner_id);
      if (champion) championName = champion.name;
    }
    message = `\u{1F3C6} ${tournament.title} \u2014 Champion: ${championName}!\n\nSee the full bracket:\n${url}`;
  } else {
    const revealedCount = tournament.revealed_match_count;
    const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
    message = `\u{1F5F3}\uFE0F ${tournament.title} \u2014 Match ${revealedCount}/${totalMatches} revealed! Listen & vote.\n\n${url}`;
  }
  res.json({ code: tournament.code, url, message, whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}` });
});

app.get('/api/tournaments/code/:code/share', (req, res) => {
  let tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(req.params.code);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  tournament = processTimedReveal(tournament);
  const entryCount = db.prepare('SELECT COUNT(*) as count FROM entries WHERE tournament_id = ?').get(tournament.id).count;
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.protocol || 'http';
  const baseUrl = `${proto}://${host}`;
  const url = `${baseUrl}/${tournament.code}`;
  let message;
  if (tournament.status === 'draft') {
    message = `\u{1F3A7} ${tournament.title} \u2014 ${entryCount} entries seeded! Check it out.\n\n${url}`;
  } else if (tournament.status === 'completed') {
    const maxRound = db.prepare('SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?').get(tournament.id).max_round;
    const finalMatch = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ?').get(tournament.id, maxRound);
    let championName = '';
    if (finalMatch && finalMatch.winner_id) {
      const champion = db.prepare('SELECT * FROM entries WHERE id = ?').get(finalMatch.winner_id);
      if (champion) championName = champion.name;
    }
    message = `\u{1F3C6} ${tournament.title} \u2014 Champion: ${championName}!\n\nSee the full bracket:\n${url}`;
  } else {
    const revealedCount = tournament.revealed_match_count;
    const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
    message = `\u{1F5F3}\uFE0F ${tournament.title} \u2014 Match ${revealedCount}/${totalMatches} revealed! Listen & vote.\n\n${url}`;
  }
  res.json({ code: tournament.code, url, message, whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}` });
});

// --- AUTH ENDPOINT ---

app.post('/api/tournaments/:id/auth', (req, res) => {
  const { password } = req.body;
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (!tournament.admin_password_hash) return res.status(400).json({ error: 'No password set' });
  if (!bcrypt.compareSync(password, tournament.admin_password_hash)) return res.status(401).json({ error: 'Invalid password' });
  const token = generateToken(tournament.id);
  res.json({ token, id: tournament.id });
});

// --- TOURNAMENT MANAGEMENT ---

app.post('/api/tournaments', (req, res) => {
  const { title, description, admin_password } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const passwordHash = admin_password ? bcrypt.hashSync(admin_password, 10) : null;
  let code;
  do { code = generateCode(); } while (db.prepare('SELECT id FROM tournaments WHERE code = ?').get(code));
  const result = db.prepare('INSERT INTO tournaments (title, description, admin_password_hash, code) VALUES (?, ?, ?, ?)').run(title.trim(), (description || '').trim(), passwordHash, code);
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(result.lastInsertRowid);
  res.json(sanitizeTournament(tournament, true));
});

app.post('/api/tournaments/:id/start', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status !== 'draft') return res.status(400).json({ error: 'Tournament already started' });
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  if (entries.length < 2) return res.status(400).json({ error: 'Need at least 2 entries to start' });
  const size = nextPowerOf2(entries.length);
  const numRounds = Math.log2(size);
  const seeding = getSeedingOrder(size);
  const insertMatch = db.prepare('INSERT INTO matches (tournament_id, round, position, entry1_id, entry2_id) VALUES (?, ?, ?, ?, ?)');
  for (let pos = 0; pos < size / 2; pos++) {
    const seed1 = seeding[pos * 2];
    const seed2 = seeding[pos * 2 + 1];
    const e1 = seed1 <= entries.length ? entries[seed1 - 1].id : null;
    const e2 = seed2 <= entries.length ? entries[seed2 - 1].id : null;
    insertMatch.run(tournament.id, 0, pos, e1, e2);
  }
  for (let round = 1; round <= numRounds; round++) {
    const matchesInRound = size / Math.pow(2, round + 1);
    for (let pos = 0; pos < matchesInRound; pos++) {
      insertMatch.run(tournament.id, round, pos, null, null);
    }
  }
  db.prepare('UPDATE tournaments SET status = ? WHERE id = ?').run('active', tournament.id);
  tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const updatedEntries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id);
  res.json({ ...sanitizeTournament(tournament, true), entries: updatedEntries, matches });
});

app.post('/api/tournaments/:id/entries', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status !== 'draft') return res.status(400).json({ error: 'Cannot add entries after tournament has started' });
  const { name, youtube_url } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const count = db.prepare('SELECT COUNT(*) as count FROM entries WHERE tournament_id = ?').get(tournament.id).count;
  const result = db.prepare('INSERT INTO entries (tournament_id, name, youtube_url, seed) VALUES (?, ?, ?, ?)').run(tournament.id, name.trim(), youtube_url || '', count + 1);
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(result.lastInsertRowid);
  res.json(entry);
});

app.post('/api/tournaments/:id/entries/bulk', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status !== 'draft') return res.status(400).json({ error: 'Cannot add entries after tournament has started' });
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
  let count = db.prepare('SELECT COUNT(*) as count FROM entries WHERE tournament_id = ?').get(tournament.id).count;
  const added = [];
  const insertStmt = db.prepare('INSERT INTO entries (tournament_id, name, youtube_url, seed) VALUES (?, ?, ?, ?)');
  for (const e of entries) {
    const name = (e.name || '').trim();
    if (!name) continue;
    count++;
    const result = insertStmt.run(tournament.id, name, e.youtube_url || '', count);
    added.push(db.prepare('SELECT * FROM entries WHERE id = ?').get(result.lastInsertRowid));
  }
  res.json({ added: added.length, entries: added });
});

app.delete('/api/tournaments/:id/entries/:entryId', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status !== 'draft') return res.status(400).json({ error: 'Cannot remove entries after tournament has started' });
  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND tournament_id = ?').get(req.params.entryId, tournament.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const updateSeed = db.prepare('UPDATE entries SET seed = ? WHERE id = ?');
  db.transaction((ents) => { for (let i = 0; i < ents.length; i++) updateSeed.run(i + 1, ents[i].id); })(entries);
  res.json({ success: true });
});

app.put('/api/tournaments/:id/entries/reorder', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status !== 'draft') return res.status(400).json({ error: 'Cannot reorder entries after tournament has started' });
  const { entries: entryOrder } = req.body;
  if (!Array.isArray(entryOrder)) return res.status(400).json({ error: 'entries must be an array' });
  const updateSeed = db.prepare('UPDATE entries SET seed = ? WHERE id = ?');
  db.transaction((order) => { for (let i = 0; i < order.length; i++) updateSeed.run(i + 1, order[i].id); })(entryOrder);
  const updated = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const updatedEntries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  res.json({ ...sanitizeTournament(updated, true), entries: updatedEntries, matches: [] });
});

app.post('/api/tournaments/:id/shuffle', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status !== 'draft') return res.status(400).json({ error: 'Cannot shuffle after tournament has started' });
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  const updateSeed = db.prepare('UPDATE entries SET seed = ? WHERE id = ?');
  db.transaction((ents) => { for (let i = 0; i < ents.length; i++) updateSeed.run(i + 1, ents[i].id); })(entries);
  const updated = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const updatedEntries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  res.json({ ...sanitizeTournament(updated, true), entries: updatedEntries, matches: [] });
});

app.put('/api/tournaments/:id/entries/:entryId', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND tournament_id = ?').get(req.params.entryId, tournament.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const { name, youtube_url } = req.body;
  if (name !== undefined) db.prepare('UPDATE entries SET name = ? WHERE id = ?').run(name.trim(), entry.id);
  if (youtube_url !== undefined) db.prepare('UPDATE entries SET youtube_url = ? WHERE id = ?').run(youtube_url || '', entry.id);
  const updatedEntry = db.prepare('SELECT * FROM entries WHERE id = ?').get(entry.id);
  res.json(updatedEntry);
});

// --- VOTING ---

app.post('/api/matches/:id/vote', requireAdmin, (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(match.tournament_id);
  const { winner_id } = req.body;
  if (!winner_id) return res.status(400).json({ error: 'winner_id is required' });
  if (winner_id !== match.entry1_id && winner_id !== match.entry2_id) return res.status(400).json({ error: 'winner_id must be one of the match entries' });
  if (match.winner_id !== null) return res.status(400).json({ error: 'Match already decided' });
  db.prepare('UPDATE matches SET winner_id = ? WHERE id = ?').run(winner_id, match.id);
  propagateSlot(match.id, winner_id, match.tournament_id);
  const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
  const decidedMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND winner_id IS NOT NULL').get(tournament.id).count;
  if (decidedMatches === totalMatches) {
    db.prepare('UPDATE tournaments SET status = ? WHERE id = ?').run('completed', tournament.id);
  }
  const updatedTournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = addRevealFlags(db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id), updatedTournament.revealed_match_count, true);
  res.json({ ...sanitizeTournament(updatedTournament, true), entries, matches });
});

// --- REVEAL ENDPOINTS ---

app.post('/api/tournaments/:id/reveal', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status === 'draft') return res.status(400).json({ error: 'Start the tournament first' });
  const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
  if (tournament.revealed_match_count >= totalMatches) return res.status(400).json({ error: 'All matches already revealed' });
  if (tournament.revealed_match_count > 0) {
    const allMatches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id);
    const lastRevealed = allMatches[tournament.revealed_match_count - 1];
    if (lastRevealed && lastRevealed.winner_id === null && lastRevealed.entry1_id !== null && lastRevealed.entry2_id !== null) {
      return res.status(400).json({ error: 'Pick a winner for the current match before revealing the next one' });
    }
  }
  const newCount = tournament.revealed_match_count + 1;
  db.prepare('UPDATE tournaments SET revealed_match_count = ? WHERE id = ?').run(newCount, tournament.id);
  if (tournament.reveal_mode === 'timed' && tournament.reveal_interval_hours) {
    const nextAt = tournament.next_reveal_at || new Date(Date.now() + tournament.reveal_interval_hours * 60 * 60 * 1000).toISOString().replace('Z', '');
    db.prepare('UPDATE tournaments SET next_reveal_at = ? WHERE id = ?').run(nextAt, tournament.id);
  }
  tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = addRevealFlags(db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id), tournament.revealed_match_count, true);
  res.json({ ...sanitizeTournament(tournament, true), entries, matches });
});

app.post('/api/tournaments/:id/reveal-all', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  if (tournament.status === 'draft') return res.status(400).json({ error: 'Start the tournament first' });
  const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
  db.prepare('UPDATE tournaments SET revealed_match_count = ?, next_reveal_at = NULL WHERE id = ?').run(totalMatches, tournament.id);
  tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = addRevealFlags(db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id), tournament.revealed_match_count, true);
  res.json({ ...sanitizeTournament(tournament, true), entries, matches });
});

app.post('/api/tournaments/:id/reset-reveals', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  db.prepare('UPDATE tournaments SET revealed_match_count = 0, next_reveal_at = NULL WHERE id = ?').run(tournament.id);
  tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = addRevealFlags(db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id), 0, true);
  res.json({ ...sanitizeTournament(tournament, true), entries, matches });
});

app.put('/api/tournaments/:id/reveal-settings', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  const { reveal_mode, reveal_interval_hours, next_reveal_at } = req.body;
  if (reveal_mode && !['manual', 'timed'].includes(reveal_mode)) return res.status(400).json({ error: 'Invalid reveal_mode' });
  const interval = parseInt(reveal_interval_hours) || 24;
  let nextAt = null;
  if (reveal_mode === 'timed') {
    if (next_reveal_at) {
      nextAt = next_reveal_at;
    } else {
      nextAt = new Date(Date.now() + interval * 60 * 60 * 1000).toISOString().replace('Z', '');
    }
  }
  db.prepare('UPDATE tournaments SET reveal_mode = ?, reveal_interval_hours = ?, next_reveal_at = ? WHERE id = ?').run(
    reveal_mode || tournament.reveal_mode, interval, nextAt, tournament.id
  );
  tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  const matches = addRevealFlags(db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id), tournament.revealed_match_count, true);
  res.json({ ...sanitizeTournament(tournament, true), entries, matches });
});

// --- DELETE ---

app.delete('/api/tournaments/:id', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tournament.id);
  db.prepare('DELETE FROM entries WHERE tournament_id = ?').run(tournament.id);
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(tournament.id);
  res.json({ success: true });
});

app.post('/api/tournaments/:id/restart', requireAdmin, (req, res) => {
  let tournament;
  const idParam = req.params.id;
  if (/^\d+$/.test(idParam)) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(parseInt(idParam));
  } else {
    tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(idParam);
  }
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tournament.id);
  db.prepare('UPDATE tournaments SET status = ?, revealed_match_count = 0, reveal_mode = ?, next_reveal_at = NULL WHERE id = ?').run('draft', tournament.reveal_mode, tournament.id);
  tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament.id);
  const entries = db.prepare('SELECT * FROM entries WHERE tournament_id = ? ORDER BY seed').all(tournament.id);
  res.json({ ...sanitizeTournament(tournament, true), entries, matches: [] });
});

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

function buildOgHtml(tournament) {
  const title = tournament.title || 'Music Bracket';
  const desc = tournament.description || 'Vote for the best song in a head-to-head music bracket tournament!';
  const url = `https://deathmatch.buis2.net/${tournament.code}`;
  const ogBlock = `  <!-- OG-PREVIEW-START -->
  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}">
  <meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}">
  <meta name="twitter:description" content="${desc.replace(/"/g, '&quot;')}">
  <!-- OG-PREVIEW-END -->`;
  return indexHtml.replace(/  <!-- OG-PREVIEW-START -->[\s\S]*?<!-- OG-PREVIEW-END -->/, ogBlock).replace(/<title>.*?<\/title>/, `<title>${title.replace(/</g, '&lt;')}</title>`);
}

app.get('*', (req, res) => {
  const codeMatch = req.path.match(/^\/([a-zA-Z0-9]{6})$/);
  if (codeMatch) {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE code = ?').get(codeMatch[1]);
    if (tournament) {
      processTimedReveal(tournament);
      return res.send(buildOgHtml(tournament));
    }
  }
  res.send(indexHtml);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Music Bracket running on http://0.0.0.0:${PORT}`);
});