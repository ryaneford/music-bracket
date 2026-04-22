# Music Bracket

A self-hosted single-elimination bracket tournament app for music — run "Best Song" style competitions in WhatsApp groups with YouTube audio playback, match-by-match reveals, and admin-controlled voting.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Single-elimination brackets** — 4, 8, 16, or 32 entries with sequential seeding
- **YouTube audio playback** — play songs head-to-head with embedded player
- **Match-by-match reveals** — admin reveals one matchup at a time; entries stay hidden until revealed
- **Auto-reveal timer** — set a daily time (e.g. 12:00 PM) and matches reveal automatically on schedule
- **Admin password protection** — restrict voting, reveals, and editing to authenticated admins
- **Share links** — WhatsApp and copy-link buttons with pre-written messages
- **Edit entries** — admins can rename songs and update YouTube URLs at any time
- **No accounts needed** — anyone with the link can view; password is optional

## Quick Start

### Docker Compose (recommended)

```yaml
services:
  music-bracket:
    image: ryaneford/music-bracket:latest
    container_name: music-bracket
    ports:
      - "3211:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open `http://localhost:3211` and start creating brackets.

### Docker Run

```bash
docker run -d \
  --name music-bracket \
  -p 3211:3000 \
  -v ./data:/app/data \
  --restart unless-stopped \
  ryaneford/music-bracket:latest
```

### From Source

```bash
git clone https://github.com/ryaneford/music-bracket.git
cd music-bracket/app
npm install
node server.js
```

The app runs on port 3000 by default. Set `PORT` environment variable to change.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |

Data is stored in `./data/brackets.db` (SQLite). Mount the `data` directory as a volume to persist tournaments across container restarts.

## Usage

### Creating a Tournament

1. Enter a title and optional description
2. Optionally set an admin password to control who can vote and reveal matches
3. Click **Create Tournament** — you'll get a shareable link and room code

### Adding Entries

1. On the setup page, add song names and YouTube URLs
2. Entries can be dragged to reorder seeding (or auto-seeded by entry order)
3. Click **Start Tournament** when ready

### Running a Bracket

- **Admins** reveal matches one at a time — each reveal shows two songs and their audio players
- Pick a winner before revealing the next match
- **Auto-reveal** can be set to a daily time (e.g. 12:00 PM) so matches reveal on schedule
- Non-admin users see the bracket read-only — hidden matches show as "???"

### Sharing

- Use the **WhatsApp** or **Copy Link** buttons on the bracket page
- Anyone with the link can view — no account needed
- If a password is set, non-admins see the bracket but cannot vote or reveal matches

## FAQ

### What is a music bracket?

A single-elimination tournament where songs go head-to-head in matchups. You listen to two tracks, vote for your favorite, and the winner advances to the next round until only one song remains.

### How do I create a tournament?

Fill in a title, add songs with optional YouTube links, then hit **Start Tournament**. You'll get a shareable link and room code to send to your group.

### What does the admin password do?

Setting a password makes you the admin. Only admins can vote (pick winners), reveal matchups one at a time, and edit entries. Without a password, anyone can vote and all matches are visible immediately.

### How do match reveals work?

If you set a password, matches start hidden. The admin reveals one matchup at a time — each reveals two songs and their audio. You must pick a winner before revealing the next match. This is great for running a group listening session where everyone discovers each pairing together.

### Does auto-reveal work?

Yes — set a daily time (e.g. 12:00 PM) and one match will reveal automatically each day at that time. You still need to pick winners before the next match reveals.

### How do I share the bracket?

Use the **WhatsApp** or **Copy Link** button on the bracket page. Anyone with the link can view it — no account needed. If you set a password, non-admins see the bracket read-only.

### Can I edit songs after starting?

Yes — admins can edit song names and YouTube links at any time by clicking the pen icon next to an entry.

### Can I log out of admin mode?

Yes — click the **Logout** button in the bracket header. You'll be returned to the home page and can log back in with the password at any time.

## Reverse Proxy

To use with a custom domain (e.g. `deathmatch.buis2.net`), add a reverse proxy like Caddy or Nginx:

**Caddy example:**

```
deathmatch.buis2.net {
    reverse_proxy localhost:3211
}
```

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name deathmatch.buis2.net;

    location / {
        proxy_pass http://127.0.0.1:3211;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Tech Stack

- **Backend:** Express.js + SQLite (better-sqlite3)
- **Frontend:** Vanilla JS, no framework
- **Audio:** YouTube IFrame API
- **Auth:** HMAC-SHA256 tokens stored in localStorage

## License

MIT