# Changelog

## v1.3.0

- **Auto-generated passwords** — passwords are now auto-generated on tournament creation (e.g. `bold-track-47`) and shown once in a copyable modal; no more picking your own password
- **Password modal on creation** — after creating a bracket, a modal shows the password and share link with Copy Link + Password and Copy Password Only buttons that close the modal and navigate to the bracket
- **Simplified login UX** — "Admin Login" renamed to "Enter Password" with friendlier messaging; badges updated to "Logged In" / "Enter Password to Vote"
- **Duplicate share endpoint removed** — cleaned up duplicate `/api/tournaments/code/:code/share` route
- **FAQ and README updated** — reflects password changes throughout

## v1.2.0

- **Link previews** — Open Graph and Twitter Card meta tags are injected server-side so shared URLs (WhatsApp, Discord, iMessage, etc.) show the tournament name and description as the link preview
- **Shuffle entries** — re-add the missing shuffle endpoint for randomizing entry seeding in draft mode
- **FAQ modal fix** — "How It Works" modal now opens as an overlay instead of replacing the page content, preventing the black-screen issue when closed

## v1.1.0

- **Bulk import** — paste multiple songs at once with `Song Name | YouTube URL` per line
- **Duplicate detection** — warns when adding an entry with a name that already exists
- **Bracket restart** — admin can reset all matches, returning to draft while keeping entries
- **PNG export** — export the bracket view as a screenshot image using html2canvas
- **Admin logout** — logout button in the bracket header that returns to the home page

## v1.0.0

- Initial release
- Single-elimination brackets (4, 8, 16, 32 entries) with sequential seeding
- YouTube audio playback with match-by-match reveals
- Admin password auth (HMAC-SHA256 tokens, 7-day expiry)
- Auto-reveal timer with daily time picker
- WhatsApp share and copy-link buttons
- Entry editing (rename, update YouTube URL)
- Recent tournaments on homepage
- Docker and Docker Compose support