// Supabase Edge Function: import-recipe
// Fetches a recipe web page on the server (browsers can't read other sites) and
// returns the recipe from the page's structured data (schema.org/Recipe, JSON-LD).
// Only callers who know a real household code can use it, so it is not an open proxy.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_BYTES = 2_500_000;
const MAX_REDIRECTS = 4;

function blockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff")) return true;
  }
  return !h.includes(".") && !h.includes(":");
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", frac12: "½", frac14: "¼", frac34: "¾", deg: "°", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…" };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}
const clean = (s: unknown, max = 600): string =>
  decodeEntities(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);

function isRecipeNode(n: any): boolean {
  const t = n?.["@type"];
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
}
function findRecipe(node: any, depth = 0): any | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const x of node) { const r = findRecipe(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof node === "object") {
    if (isRecipeNode(node)) return node;
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement"]) {
      if (node[key]) { const r = findRecipe(node[key], depth + 1); if (r) return r; }
    }
  }
  return null;
}
function flattenSteps(x: any): string[] {
  if (!x) return [];
  if (typeof x === "string") return x.split(/\r?\n+/).map((s) => clean(s)).filter(Boolean);
  if (Array.isArray(x)) return x.flatMap(flattenSteps);
  if (typeof x === "object") {
    if (x.itemListElement) return flattenSteps(x.itemListElement);
    if (x.text) return flattenSteps(x.text);
    if (x.name) return flattenSteps(x.name);
  }
  return [];
}
function isoMinutes(d: unknown): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(String(d ?? ""));
  if (!m) return 0;
  return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}
function extractRecipe(html: string): any | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const raw = m[1].trim().replace(/^<!--|-->$/g, "");
      const r = findRecipe(JSON.parse(raw));
      if (r) return r;
    } catch { /* try the next block */ }
  }
  return null;
}

async function fetchPage(startUrl: URL): Promise<string> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!/^https?:$/.test(url.protocol) || blockedHost(url.hostname)) throw new Error("That address can’t be imported.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: ctl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WeeklyTableImporter/1.0)", Accept: "text/html,application/xhtml+xml" },
      });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error("That site didn’t let us read the page (" + res.status + ").");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("The page was empty.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(Math.min(total, MAX_BYTES));
    let off = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.max(0, buf.length - off)), off); off += c.length; if (off >= buf.length) break; }
    return new TextDecoder().decode(buf);
  }
  throw new Error("Too many redirects.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { url, code } = body ?? {};

  // Only household members may use this.
  if (typeof code !== "string" || code.length < 8) return json({ error: "Missing household code." }, 403);
  const supa = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supa || !key) return json({ error: "Server isn’t configured." }, 500);
  const chk = await fetch(`${supa}/rest/v1/rpc/wt_list`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code: code }),
  });
  const rows = chk.ok ? await chk.json() : [];
  if (!Array.isArray(rows) || rows.length === 0) return json({ error: "Unknown household." }, 403);

  let target: URL;
  try { target = new URL(String(url)); } catch { return json({ error: "That doesn’t look like a web address." }, 400); }

  let html: string;
  try { html = await fetchPage(target); }
  catch (e) { return json({ error: e instanceof Error ? e.message : "Couldn’t read that page." }, 502); }

  const r = extractRecipe(html);
  if (!r) return json({ error: "No recipe data found on that page. Try the recipe’s own page, or paste it into the form." }, 422);

  const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : [r.recipeIngredient]).map((s: unknown) => clean(s)).filter(Boolean).slice(0, 60);
  const instructions = flattenSteps(r.recipeInstructions).slice(0, 40);
  const minutes = isoMinutes(r.totalTime) || (isoMinutes(r.prepTime) + isoMinutes(r.cookTime));
  const keywords = Array.isArray(r.keywords) ? r.keywords.join(", ") : String(r.keywords ?? "");

  return json({
    name: clean(r.name, 140),
    minutes,
    ingredients,
    instructions,
    keywords: clean(keywords, 300),
    source: target.hostname.replace(/^www\./, ""),
  });
});
