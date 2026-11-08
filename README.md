# The Weekly Table

A shared kosher dinner planner for a family of three.

- 112 recipes: meat, dairy and pareve; quick, slow-cooker, Instant Pot and one-pot.
- Menus follow the week's **live weather forecast** (°C): hearty, warming dishes when it's cold, lighter ones when it's warm.
- **Friday is always a Shabbat-style meat-and-veggies dinner.**
- Meat is capped at 3 nights (Monday, Wednesday, Friday). Nothing repeats inside 4 weeks.
- Swap any night, search and filter the recipe box, build a shopping list.
- **Import a recipe from a web link**, with a kosher check (flags meat + dairy mixes and non-kosher ingredients).
- Shared between devices through a household code. Works on iPhone as a Home Screen app.

It is a plain static site (no build step), so GitHub Pages can host it as is.

## Set-up (about 15 minutes, one time)

### 1. Create the database tables (Supabase)
1. Open your Supabase project, then **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. It's safe to run again.

This locks the table so nobody can read or write it directly. The site can only reach a household's data by presenting that household's long random code.

### 2. Add the public key
1. In Supabase go to **Project Settings → API Keys**.
2. Copy the **anon / publishable** key (never the *secret* or *service_role* key).
3. Open `config.js` and replace `PASTE_YOUR_ANON_PUBLIC_KEY_HERE` with it. The project URL is already filled in.

The public key is meant to be visible in a public repo. Commit the change.

### 3. Turn on GitHub Pages
1. In the repo: **Settings → Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main`, folder `/ (root)`. Save.
3. After a minute your site is live at **https://jmsmorris.github.io/the-weekly-table/**

(GitHub Pages on a free account requires a public repo.)

### 4. Turn on recipe import from links (optional)
Browsers can't read other websites' pages, so a small Supabase function does it.
1. Supabase → **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `import-recipe`.
3. Paste the contents of `supabase/functions/import-recipe/index.ts`.
4. Turn **off** "Verify JWT" (the function checks the household code itself).
5. Deploy.

Without this step everything else works; the Import button just says it isn't set up yet.
Import works on pages that include standard recipe data (most big recipe sites do). If a site blocks it, paste the recipe into the form instead.

### 5. First use
1. Open the site and tap **Create a new household**.
2. In the Settings window that opens, tap **Copy invite link** and send it to your spouse. Opening the link joins them automatically.
3. Tap **Build the first week**.
4. iPhone: open the site in Safari → Share → **Add to Home Screen**.

## Adding recipes for everyone later
Edit `recipes.json`, add recipes, and raise `"version"` by 1. Every household automatically receives the new recipes the next time anyone opens the site (existing recipes are never overwritten).

## How access works
- Anyone with the household code or invite link can see and edit that household's plan and recipes. Treat it like a shared password and send it only to family.
- The site files and the recipe list are public (they're in a public repo). The plan and any recipes you save are private to your household.
- The household code can't be guessed (10 random characters), and the database refuses requests without it.

## Notes
- Weather comes from Open-Meteo (free, no account). Change the city in Settings. You can also override any week's temperatures with **Set forecast**.
- Temperatures are in °C. Recipe measurements are left exactly as written.
- The old "Discover new recipes" button isn't part of this version because it needed Claude. To add recipes in bulk, ask Claude for a batch and add it to `recipes.json`, or use link import.
- Changes sync every ~20 seconds and whenever you return to the page.
