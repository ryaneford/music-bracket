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

function processTimedReveal(tournament) {
  if (tournament.reveal_mode !== 'timed' || !tournament.next_reveal_at) return tournament;
  const totalMatches = db.prepare('SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?').get(tournament.id).count;
  if (tournament.revealed_match_count >= totalMatches) return tournament;
  const nextTime = new Date(tournament.next_reveal_at + 'Z');
  if (nextTime <= new Date()) {
    const allMatches = db.prepare('SELECT id, round, position FROM matches WHERE tournament_id = ? ORDER BY round, position').all(tournament.id);
    let revealCount = tournament.revealed_match_count;
    while (revealCount < totalMatches) {
      const nextTime2 = new Date(tournament.next_reveal_at + 'Z');
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Music Bracket running on http://0.0.0.0:${PORT}`);
});