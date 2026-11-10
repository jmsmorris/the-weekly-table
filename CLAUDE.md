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
- **Doc paths** inside a household: `recipes/<id>`, `planner/state` (`plan[7]`, `weekStart`, `history[]`), `planner/weather` (manual forecast override), `planner/settings` (weather location), `ratings/<recipeId>` (`{v: 1|-1, at}`, one doc per rated recipe), `meta/seed` (seed version).
- **Sync**: no realtime. Poll `wt_list` every ~20 s (and when the tab regains focus), fetch only changed paths. Writes are optimistic and serialized through a promise chain; local cache in `localStorage` (`wt-cache-v1`).
- **Recipes** ship in `recipes.json` (`{version, recipes[]}`, 112 recipes). On load, if `meta/seed.version` is lower than the file's `version`, missing recipes are added to the household (existing ones are never overwritten). To ship new recipes: add them and bump `version`. The same pass also adds `servings`/`sides` to existing non-custom recipes that lack them (this is how version 2 reached households seeded at version 1); it never changes anything else.
- **Recipe fields**: `id, name, category (meat|dairy|pareve), minutes, kidFriendly, emoji, style ('' | slow-cooker | instant-pot | one-pot), warmth (1 light, 2 mid, 3 hearty), shabbat, ingredients[], instructions[], servings, sides[], custom, sourceUrl?`. `servings` is an approximate whole number (shown as “serves ~4”); `sides` is 1–2 short suggestions that round the dish out into a full meal (protein, carbs, fibre, veg) and keep the kosher rules (dairy-free next to meat, meat-free next to dairy and fish). Recipes you add or import have no `sides`, so `suggestSides()` in `app.js` suggests meat- and dairy-free ones from what the ingredients lack. The add form has an optional “Serves” field; the import function returns `servings` from the page’s `recipeYield`. Photos are emoji on category gradients (no images).
- **Weather**: Open-Meteo (no key) for daily highs. The target week is the coming Mon to Sun if today is Thu to Sun, otherwise the current week. Priority: manual override for that week, then live forecast, then a seasonal average. Weights per weather band are in `BANDS` in `app.js`.
- **Import from URL**: `supabase/functions/import-recipe/index.ts` (Deno edge function) fetches a page server-side and reads schema.org Recipe JSON-LD. It requires a valid household code (so it is not an open proxy) and blocks private and local addresses, including through redirects. The client (`runImport` in `app.js`) guesses category, flags meat+dairy mixes and non-kosher ingredients, and prefills the add-recipe form.
- **Ratings** (`setRating`, `pickOne`, `LIKE_BOOST` in `app.js`): thumbs up/down buttons on day cards, recipe-box cards and the recipe view; tap again to clear. Ratings are shared by the household, one small doc per recipe so two phones never overwrite each other. Week generation treats a thumbs-up recipe as `LIKE_BOOST` (3×) as likely and drops thumbs-down recipes. Order of preference for a slot: not disliked and not used in the last 4 weeks, then not disliked (a repeat), then anything, so the Friday Shabbat rule and the 3 meat nights always hold even if every candidate is disliked. The swap picker hides disliked recipes (unless that would leave nothing) and lists liked ones first. A recipe already in this week’s plan stays when rated.
- **Switch days** (`openMove`/`doMove` in `app.js`): each day card has a “Switch day” button; the two dinners trade places (no recipe leaves the plan, meat count unchanged). The only rule enforced is Friday: it can only receive a `shabbat: true` recipe (when the box has any), same as the swap picker. Meat is not forced back onto Mon/Wed/Fri after a manual switch, same as a manual swap.
- **Kosher swaps on import** (`FIX_BAD`, `FIX_DAIRY`, `FIX_MEAT` in `app.js`): when an import is flagged, each simple swap (butter → margarine, milk → soy milk, ground beef → plant-based ground meat, bacon → kosher turkey bacon, shellfish → cod…) is shown as a tick box with a before/after preview of the ingredient lines it changes. For meat+dairy mixes the cook first picks a route (keep it a meat dish and swap the dairy, or keep it a dairy dish and swap the meat). **Apply** rewrites the ingredients and the steps for the ticked swaps (Undo restores them); amounts are not converted. Each rule has a regex and the exact replacement text; add new swaps there and add a test in `tests/site.test.js`.

## Status
Live and smoke-tested on 2026-11-08 (two real browsers against the live site and Supabase): household create, week build, invite-link join, swap sync, and recipe import all work.

- Repo pushed to `main`; GitHub Pages serves it from `main`, root.
- `supabase/schema.sql` has been run on project `gitrtnnpmouqulgdejtd`. The `docs` table is closed to the publishable key; only the `wt_*` functions work, and they work with just the `apikey` header.
- The import edge function is deployed under the dashboard-generated slug **`rapid-action`** (not `import-recipe`), with Verify JWT off. `config.js` sets `importFunction: "rapid-action"`. To redeploy from the CLI: `supabase functions deploy rapid-action --no-verify-jwt --project-ref gitrtnnpmouqulgdejtd` (copy `supabase/functions/import-recipe` to `supabase/functions/rapid-action` first, or redeploy by pasting into the dashboard editor).
- The deployed `rapid-action` function was last deployed before it learned to return `servings`; imports still work and just leave “Serves” empty until `supabase/functions/import-recipe/index.ts` is redeployed.
- Some recipe sites (e.g. Allrecipes, Serious Eats) refuse server-side fetches with 403; the app shows a clear message. BBC Good Food imports fine.
- Open-Meteo rate-limits shared IPs (429); the app then falls back to the seasonal average and labels it.
- Optional ideas the owner has not asked for: a service worker for offline use; real recipe photos.

## Commands
- `npm install` then `npm test` runs the edge function tests and the full end-to-end site test (two simulated devices sharing a fake database). All must pass before pushing.
- `npm run serve` serves the site locally.

## Conventions
- Keep it dependency-free in the browser (no framework, no bundler). Use plain ES2017+ and relative URLs (the site lives under `/the-weekly-table/`).
- Escape every value from shared data with `esc()` before putting it in HTML.
- Typographic apostrophes and quotes in visible text (’ “ ”); use °C for temperatures.
- Do not commit secrets. The Supabase secret and service_role keys must never appear in this repo.
