# Virtual Fridge

A local-only web app that keeps track of what is in your fridge, tells you what to eat first, and asks an AI for recipes that only use what you have. Everything runs on this computer; data is stored in a file here.

Requirements: [PRD.md](PRD.md) · Development plan: [DEV_PLAN.md](DEV_PLAN.md) · Image credits: [CREDITS.md](CREDITS.md)

## Start the app

1. Install [Node.js](https://nodejs.org) 24 or newer (once).
2. Double-click **`start.bat`**.
   - The first time, it installs what it needs (takes a minute).
   - It builds the app and opens <http://localhost:5178> in your browser.
3. Keep the black window open while you use the app. Close it to stop the app.

Opening `start.bat` again while the app is running just opens the browser.

## Where your data is

| What | Where |
|---|---|
| Fridge, seasonings, favorites, cart, To cook, History | `data/fridge.db` |
| AI model settings and API key | `data/config.json` (only on this computer) |
| Safety copies made before each restore | `data/auto-backups/` |

The data does not depend on the browser, so clearing browser data, restarting the browser or the computer keeps everything. The `data/` folder is not uploaded to git.

## Backup and restore

Settings → Backup:

- **Export backup** saves a `fridge-backup-YYYYMMDD-HHMMSS.json` file. Your API key is never included.
- **Import backup…** checks the file, shows what it contains and asks before replacing your data. A copy of your current data is saved to `data/auto-backups/` first. A broken file is refused and nothing changes.

## AI setup (optional)

The fridge works fully offline. Recipes, shelf-life suggestions and receipt scanning need an AI model:

1. Get an API key from Alibaba Cloud Model Studio (DashScope / 百炼).
2. Settings → AI model: paste the key, keep the defaults (`qwen-plus`, vision model `qwen-vl-plus`, web search on), **Save**, then **Test connection**.

Any OpenAI-compatible provider works: change the provider address and model name. Web search with source links is only available with Qwen; with other models, shelf-life suggestions are marked as having no web sources, and receipt scanning needs a vision model.

## For developers

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

`dev:server` runs the API on port 5178; `dev:web` runs Vite on <http://localhost:5173> with hot reload. Set `AI_MOCK=1` before `dev:server` to use the built-in test AI without a key.

Project layout:

- `packages/core` – business rules with no UI or database code (units, dates, batches, deduction, search, favorites, serving estimate, recipe checker, backup format). Reusable for a future mobile app.
- `server` – Fastify server: SQLite database (`node:sqlite`), JSON API, AI client and the background shelf-life worker. Also serves the built web app.
- `web` – React app (Fridge, AI cook, Settings).
- `e2e` – Playwright end-to-end tests (run in Microsoft Edge against a real server with a temporary data folder).

### Tests

Run everything (type check, lint, unit and API tests, build, end-to-end tests):

```bash
npm run test:all
```

Or individually: `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run test:e2e` (Playwright; run `npm run build` first).

### Food images

Photos in `web/public/foods/` are freely licensed images from Wikimedia Commons, listed with author and license in [CREDITS.md](CREDITS.md). To replace one, put a new file in `web/public/foods/` and point `web/src/foodImages.json` at it. Foods without a photo show a category icon.
