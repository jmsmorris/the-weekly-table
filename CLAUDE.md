# CLAUDE.md: project handoff

This file is for Claude Code (or any coding agent) picking this project up. Read it first.

## What this is
**The Weekly Table**: a shared kosher dinner planner for a family of three (one toddler), hosted as a static site on GitHub Pages at https://jmsmorris.github.io/the-weekly-table/ with shared data in Supabase.

It was designed and built in a Claude chat; this repo is the result. There is no build step: `index.html`, `styles.css`, `app.js`, `config.js` are served as is. `package.json` exists only to run tests.

## Hard rules from the owner (do not change without asking)
- **Weather is in °C.** Recipes stay exactly as written (imperial measures, °F oven temperatures). Do not convert recipes to metric.
- **Meat is capped at 3 nights a week**, placed Mon, Wed, Fri.
- **Friday is always a Shabbat-style dinner**: a meat protein with vegetables, chosen only from recipes flagged `shabbat: true`. Friday swaps offer only those recipes.
- **No recipe repeats within 4 weeks** (history of the last 4 weeks is excluded when choosing).
- **Menus follow the weather**: cold days lean to hearty/warming dishes, warm days to lighter ones.
- Kosher: never mix meat and dairy in a recipe; fish and eggs are pareve. Recipes should be toddler-adaptable.
- Recipe time limits do not apply to slow-cooker, Instant Pot and one-pot recipes.

## Architecture
- **`app.js`**: the whole app (vanilla JS, no framework). State object `S`; renders by rebuilding HTML strings into fixed containers; one delegated click handler keyed on `data-action`.
- **Data lives in Supabase** (project URL and public key are in `config.js`; the publishable key is meant to be public). The table `docs(code, path, data jsonb, updated_at)` is locked by row-level security. The browser can only call four `security definer` functions: `wt_list`, `wt_get`, `wt_put`, `wt_del` (see `supabase/schema.sql`), each of which requires the **household code**.
- **Household code** = 10 random characters, the only secret. Stored in `localStorage` (`wt-household`). Invite link is `site#join=CODE`.
- **Doc paths** inside a household: `recipes/<id>`, `planner/state` (`plan[7]`, `weekStart`, `history[]`), `planner/weather` (manual forecast override), `planner/settings` (weather location), `meta/seed` (seed version).
- **Sync**: no realtime. Poll `wt_list` every ~20 s (and when the tab regains focus), fetch only changed paths. Writes are optimistic and serialized through a promise chain; local cache in `localStorage` (`wt-cache-v1`).
- **Recipes** ship in `recipes.json` (`{version, recipes[]}`, 112 recipes). On load, if `meta/seed.version` is lower than the file's `version`, missing recipes are added to the household (existing ones are never overwritten). To ship new recipes: add them and bump `version`.
- **Recipe fields**: `id, name, category (meat|dairy|pareve), minutes, kidFriendly, emoji, style ('' | slow-cooker | instant-pot | one-pot), warmth (1 light, 2 mid, 3 hearty), shabbat, ingredients[], instructions[], custom, sourceUrl?`. Photos are emoji on category gradients (no images).
- **Weather**: Open-Meteo (no key) for daily highs. The target week is the coming Mon to Sun if today is Thu to Sun, otherwise the current week. Priority: manual override for that week, then live forecast, then a seasonal average. Weights per weather band are in `BANDS` in `app.js`.
- **Import from URL**: `supabase/functions/import-recipe/index.ts` (Deno edge function) fetches a page server-side and reads schema.org Recipe JSON-LD. It requires a valid household code (so it is not an open proxy) and blocks private and local addresses, including through redirects. The client (`runImport` in `app.js`) guesses category, flags meat+dairy mixes and non-kosher ingredients, and prefills the add-recipe form.

## Status when handed off
Done and tested (simulated Supabase and weather; `npm test` passes): everything above.

**Not yet done or never verified against live services:**
1. The repo has a local commit but **has not been pushed** to https://github.com/jmsmorris/the-weekly-table.git (the chat session had no GitHub login). First task: `git push -u origin main`.
2. **Run `supabase/schema.sql`** in the Supabase SQL editor for project `gitrtnnpmouqulgdejtd` (the owner must do this or give you the Supabase CLI login).
3. **Enable GitHub Pages** (Settings, Pages, branch `main`, root). Needs a public repo on a free plan.
4. **Deploy the edge function**: `supabase functions deploy import-recipe --no-verify-jwt --project-ref gitrtnnpmouqulgdejtd` (or paste into the dashboard editor with "Verify JWT" off).
5. **Smoke-test the live site**: create a household, build a week, join from a second browser with the invite link, swap on one and confirm it appears on the other, import a real recipe URL. Check the `sb_publishable_` key works with only the `apikey` header (the app sends `Authorization` only for legacy JWT keys that start with `eyJ`).
6. Optional ideas the owner has not asked for: a service worker for offline use; real recipe photos.

## Commands
- `npm install` then `npm test` runs the edge function tests and the full end-to-end site test (two simulated devices sharing a fake database). All must pass before pushing.
- `npm run serve` serves the site locally.

## Conventions
- Keep it dependency-free in the browser (no framework, no bundler). Use plain ES2017+ and relative URLs (the site lives under `/the-weekly-table/`).
- Escape every value from shared data with `esc()` before putting it in HTML.
- Typographic apostrophes and quotes in visible text (’ “ ”); use °C for temperatures.
- Do not commit secrets. The Supabase secret and service_role keys must never appear in this repo.
