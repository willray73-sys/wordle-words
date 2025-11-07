// const RAW_BASE = "https://raw.githubusercontent.com/willray73-sys/wordle-words/main";
// New (faster, avoids branch caching):
const RAW_BASE = "https://cdn.jsdelivr.net/gh/willray73-sys/wordle-words@main";

// Keep in-memory caches short; we’ll rely on versioned fetch keys instead
const MEMO_TTL_MS = 60 * 1000; // 1 minute

type Env = { RAW_BASE?: string };

type WordSets = {
  allowedWords: string[];
  usedWords: string[];
  allowedNotUsedWords: string[];
  metadata: { generated: string | null };
};

type DatedEntry = { date: string; number: number | null; word: string };
type DatedResponse = { results: DatedEntry[] };

type UnusedSearchResult = {
  total: number;
  offset: number;
  limit: number;
  results: Array<{ word: string; is_used: boolean }>;
};

const wordsMemo = new Map<string, { timestamp: number; data: WordSets }>();
// Versioned memo for dated history (keyed by version string)
const datedMemo = new Map<string, { timestamp: number; data: DatedResponse | null }>();

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function jsonResponse<T>(obj: T, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

async function fetchText(url: string): Promise<string> {
  const request = new Request(url, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached.text();

  const upstream = await fetch(request, { cf: { cacheTtl: 600, cacheEverything: true } }); // 10m
  if (!upstream.ok) throw new Error(`fetch ${url} -> ${upstream.status} ${upstream.statusText}`);

  const clone = upstream.clone();
  await cache.put(request, clone);
  return upstream.text();
}

// ---------- ET time helpers & versioning ----------
function todayETISO(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function etVersionHalfHour(): string {
  // Version in 30-minute buckets so we never hold stale for a whole day
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = String(d.getHours()).padStart(2, "0");
  const mm = d.getMinutes() < 30 ? "00" : "30";
  return `${todayETISO()}-${h}${mm}`;
}

function etVersionHourly(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = String(d.getHours()).padStart(2, "0");
  return `${todayETISO()}-${h}`;
}

// Fetch JSON with a supplied version string in the query to shape the cache key
async function fetchJSONVersioned<T>(urlBase: string, version: string): Promise<T> {
  const requestUrl = `${urlBase}?v=${encodeURIComponent(version)}`;
  const req = new Request(requestUrl, { method: "GET" });
  const cache = caches.default;

  const hit = await cache.match(req);
  if (hit) return (hit.json() as Promise<T>);

  // Let origin decide its own caching; we store a 10m copy in caches.default via our key
  const upstream = await fetch(req, { cf: { cacheEverything: false } });
  if (!upstream.ok) throw new Error(`fetch ${urlBase} -> ${upstream.status} ${upstream.statusText}`);

  const clone = upstream.clone();
  await cache.put(req, clone);
  return (upstream.json() as Promise<T>);
}

// Version-aware dated fetch. If _bust is provided, we append a unique nonce version.
async function getUsedDated(env: Env, version: string): Promise<DatedResponse | null> {
  const base = env.RAW_BASE || RAW_BASE;
  const now = Date.now();
  const memo = datedMemo.get(version);
  if (memo && now - memo.timestamp < MEMO_TTL_MS) return memo.data;

  try {
    const data = await fetchJSONVersioned<DatedResponse>(`${base}/public/used_dated.json`, version);
    if (Array.isArray(data?.results)) {
      datedMemo.set(version, { timestamp: now, data });
      return data;
    }
  } catch (e) {
    console.warn("getUsedDated failed:", e);
  }
  datedMemo.set(version, { timestamp: now, data: null });
  return null;
}

async function getJSONorCSV(env: Env): Promise<{ allowed: any; used: any; allowedNotUsed: any }> {
  const base = env.RAW_BASE || RAW_BASE;
  try {
    const [allowed, used, allowedNotUsed] = await Promise.all([
      fetchText(`${base}/public/allowed.json`).then((t) => JSON.parse(t)),
      fetchText(`${base}/public/used.json`).then((t) => JSON.parse(t)),
      fetchText(`${base}/public/allowed_not_used.json`).then((t) => JSON.parse(t)),
    ]);
    return { allowed, used, allowedNotUsed };
  } catch {
    const csv = await fetchText(`${base}/data/words.csv`);
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines.shift() ?? "";
    const cols = header.split(",").map((s) => s.trim().toLowerCase());
    const wordIdx = cols.indexOf("word");
    const usedIdx = Math.max(cols.indexOf("is_used"), cols.indexOf("used"));
    if (wordIdx < 0 || usedIdx < 0) throw new Error("words.csv missing word/is_used columns");

    const allowedWords: string[] = [];
    const usedWords: string[] = [];
    for (const line of lines) {
      const cells = line.split(",");
      const w = (cells[wordIdx] || "").trim().toLowerCase();
      const flag = (cells[usedIdx] || "").trim().toLowerCase();
      if (/^[a-z]{5}$/.test(w)) {
        allowedWords.push(w);
        if (["1", "true", "yes", "y", "t"].includes(flag)) usedWords.push(w);
      }
    }
    const allowedSet = new Set(allowedWords);
    const usedSet = new Set(usedWords);
    const allowedNotUsed = [...allowedSet].filter((w) => !usedSet.has(w));
    return {
      allowed: { generated: null, words: [...allowedSet] },
      used: { generated: null, words: [...usedSet] },
      allowedNotUsed: { generated: null, words: allowedNotUsed },
    };
  }
}

async function loadWordSets(env: Env): Promise<WordSets> {
  const key = env.RAW_BASE || RAW_BASE;
  const now = Date.now();
  const memo = wordsMemo.get(key);
  if (memo && now - memo.timestamp < MEMO_TTL_MS) return memo.data;

  const { allowed, used, allowedNotUsed } = await getJSONorCSV(env);
  const toList = (payload: any): string[] => {
    if (!payload) return [];
    if (Array.isArray(payload.words)) return payload.words.map((w) => w.toLowerCase());
    if (Array.isArray(payload.list)) return payload.list.map((w) => w.toLowerCase());
    return [];
  };

  const allowedWordsRaw = toList(allowed);
  const usedWordsRaw = toList(used);
  const allowedNotUsedRaw = toList(allowedNotUsed);

  const allowedSet = new Set(allowedWordsRaw);
  const usedSet = new Set(usedWordsRaw);

  // Ensure allowed set includes every used word
  usedSet.forEach((w) => allowedSet.add(w));

  // Supplement with dated history (up to yesterday ET)
  try {
    const dated = await getUsedDated(env, etVersionHourly());
    if (dated?.results?.length) {
      const today = todayETISO();
      dated.results.forEach((entry) => {
        if (entry.date < today && entry.word) {
          const lower = entry.word.toLowerCase();
          allowedSet.add(lower);
          usedSet.add(lower);
        }
      });
    }
  } catch (e) {
    console.warn("Unable to merge dated answers into word sets", e);
  }

  const unusedList =
    allowedNotUsedRaw.length > 0
      ? Array.from(new Set(allowedNotUsedRaw)).filter((w) => !usedSet.has(w))
      : Array.from(allowedSet).filter((w) => !usedSet.has(w));

  const data: WordSets = {
    allowedWords: Array.from(allowedSet).sort(),
    usedWords: Array.from(usedSet).sort(),
    allowedNotUsedWords: unusedList.sort(),
    metadata: {
      generated: allowed?.generated || allowedNotUsed?.generated || used?.generated || null,
    },
  };

  wordsMemo.set(key, { timestamp: now, data });
  return data;
}

function normalizePattern(pattern: string): string {
  return (pattern || "").trim().toLowerCase();
}
function patternToRegex(pattern: string): RegExp | null {
  const trimmed = normalizePattern(pattern);
  if (!trimmed) return /^[a-z]{5}$/;
  if (/[^a-z?]/.test(trimmed) || trimmed.length !== 5) return null;
  const body = trimmed.replace(/\?/g, ".");
  return new RegExp(`^${body}$`);
}

function scoreStarter(word: string): number {
  const uniqueLetters = new Set(word);
  const vowels = [...word].filter((c) => "aeiou".includes(c)).length;
  return (uniqueLetters.size === 5 ? 2 : 0) + vowels;
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const { allowedWords, usedWords } = await loadWordSets(env);
    return jsonResponse({ ok: true, allowed: allowedWords.length, used: usedWords.length }, 200, {
      "X-Worker-Version": "repo-worker-1",
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
}

async function handleWords(url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  const isUsed = params.get("is_used");
  const q = (params.get("q") || "").toLowerCase();
  const limit = Math.min(parseInt(params.get("limit") || "1000", 10) || 1000, 10000);
  const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);

  const { allowedWords, usedWords } = await loadWordSets(env);
  const allowedSet = new Set(allowedWords);
  const usedSet = new Set(usedWords);

  let results = Array.from(allowedSet);
  if (isUsed === "true") results = results.filter((w) => usedSet.has(w));
  if (isUsed === "false") results = results.filter((w) => !usedSet.has(w));
  if (q) results = results.filter((w) => w.includes(q));

  const total = results.length;
  const slice = results.slice(offset, offset + limit);
  return jsonResponse({ total, offset, limit, results: slice.map((w) => w.toUpperCase()) });
}

async function handleWord(word: string, env: Env): Promise<Response> {
  if (!/^[a-z]{5}$/.test(word)) return jsonResponse({ error: "word must be 5 lowercase letters" }, 400);
  const { allowedWords, usedWords } = await loadWordSets(env);
  const allowedSet = new Set(allowedWords);
  const usedSet = new Set(usedWords);

  return jsonResponse({ word: word.toUpperCase(), allowed: allowedSet.has(word), is_used: usedSet.has(word) });
}

async function handleStats(env: Env): Promise<Response> {
  const { allowedWords, usedWords, allowedNotUsedWords, metadata } = await loadWordSets(env);
  return jsonResponse({
    generated: metadata.generated || null,
    counts: { allowed: allowedWords.length, used: usedWords.length, allowed_not_used: allowedNotUsedWords.length },
  });
}

async function handleStarters(url: URL, env: Env): Promise<Response> {
  const top = Math.max(1, Math.min(parseInt(url.searchParams.get("top") || "50", 10) || 50, 500));
  const { allowedNotUsedWords } = await loadWordSets(env);
  const ranked = allowedNotUsedWords
    .map((w) => ({ word: w, score: scoreStarter(w) }))
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, top);
  return jsonResponse({ results: ranked.map((e) => ({ word: e.word.toUpperCase(), score: e.score })) });
}

async function handleUnusedSearch(url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  const pattern = normalizePattern(params.get("pattern") || params.get("q") || "");
  const includes = (params.get("includes") || "").toLowerCase();
  const excludes = (params.get("excludes") || "").toLowerCase();
  const limit = Math.min(parseInt(params.get("limit") || "100", 10) || 100, 500);
  const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);

  const { allowedWords, usedWords } = await loadWordSets(env);
  const regex = patternToRegex(pattern);
  if (!regex) return jsonResponse<UnusedSearchResult>({ total: 0, offset, limit, results: [] });

  const includeSet = new Set(includes.split("").filter(Boolean));
  const excludeSet = new Set(excludes.split("").filter(Boolean));
  const usedSet = new Set(usedWords);

  const filtered = allowedWords.filter((w) => {
    if (!regex.test(w)) return false;
    for (const l of includeSet) if (!w.includes(l)) return false;
    for (const l of excludeSet) if (w.includes(l)) return false;
    return true;
  });

  const total = filtered.length;
  const results = filtered.slice(offset, offset + limit).map((w) => ({ word: w.toUpperCase(), is_used: usedSet.has(w) }));
  return jsonResponse<UnusedSearchResult>({ total, offset, limit, results });
}

// Central helper to compute version based on query (_bust => unique, else 30min bucket)
function resolveDatedVersionFromQuery(url: URL): string {
  if (url.searchParams.has("_bust")) return `${todayETISO()}-${Date.now()}`; // force fresh
  return etVersionHalfHour(); // otherwise auto-roll every 30min ET
}

async function handleAnswersList(url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  const order = (params.get("order") || "recent").toLowerCase();
  const limit = Math.min(parseInt(params.get("limit") || "50", 10) || 50, 500);
  const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);
  const q = (params.get("q") || "").toLowerCase();

  if (order === "recent") {
    const version = resolveDatedVersionFromQuery(url);
    const dated = await getUsedDated(env, version);
    if (dated) {
      const today = todayETISO();
      const filteredEntries = dated.results
        .filter((e) => e.date < today) // SPOILER GUARD
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

      const words = filteredEntries
        .map((e) => e.word.toUpperCase())
        .filter((w) => (q ? w.toLowerCase().includes(q) : true));

      const total = words.length;
      const slice = words.slice(offset, offset + limit);
      return jsonResponse({ total, offset, limit, results: slice }, 200, {
        "X-Ordering": "recent-dated",
        "X-Version": version,
      });
    }
  }

  // Fallback: build from usedWords
  const { usedWords } = await loadWordSets(env);
  let results = usedWords.map((w) => w.toUpperCase());
  if (q) results = results.filter((w) => w.toLowerCase().includes(q));
  if (order === "alpha") results = [...results].sort();
  else if (order === "recent") results = results.reverse();

  const total = results.length;
  const slice = results.slice(offset, offset + limit);
  return jsonResponse({ total, offset, limit, results: slice }, 200, { "X-Ordering": "alpha-fallback" });
}

async function handleAnswersDates(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const q = (url.searchParams.get("q") || "").toLowerCase();

  const version = resolveDatedVersionFromQuery(url);
  const dated = await getUsedDated(env, version);
  if (!dated) return jsonResponse({ error: "dated history not available" }, 503);

  const today = todayETISO();
  const filteredEntries = dated.results
    .filter((e) => e.date < today)
    .filter((e) => (q ? e.word.toLowerCase().includes(q) : true))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const total = filteredEntries.length;
  const results = filteredEntries.slice(offset, offset + limit).map((e) => ({
    date: e.date,
    number: e.number,
    word: e.word.toUpperCase(),
  }));

  return jsonResponse({ total, offset, limit, results }, 200, { "X-Ordering": "recent-dated", "X-Version": version });
}

// ---- Debug: show raw vs spoiler-safe tails + version currently used
async function handleDebugStatus(url: URL, env: Env): Promise<Response> {
  const version = resolveDatedVersionFromQuery(url);
  const dated = await getUsedDated(env, version);
  const today = todayETISO();
  const rawCount = dated?.results?.length ?? 0;
  const rawTail = rawCount ? dated!.results![rawCount - 1] : null;
  const safe = (dated?.results ?? []).filter((r) => r.date < today);
  const safeCount = safe.length;
  const safeTail = safeCount ? safe[safeCount - 1] : null;

  return jsonResponse(
    { version, todayET: today, rawBase: env.RAW_BASE || RAW_BASE, rawCount, rawTail, safeCount, safeTail },
    200,
    { "X-Debug": "status" }
  );
}

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      // debug first
      if (method === "GET" && path === "/_debug/status") return handleDebugStatus(url, env);

      if (method === "GET" && path === "/v1/health") return handleHealth(env);
      if (method === "GET" && path === "/v1/stats") return handleStats(env);
      if (method === "GET" && path === "/v1/starters") return handleStarters(url, env);
      if (method === "GET" && path === "/v1/unused/search") return handleUnusedSearch(url, env);
      if (method === "GET" && path === "/v1/answers/dates") return handleAnswersDates(url, env);
      if (method === "GET" && path === "/v1/answers") return handleAnswersList(url, env);
      if (method === "GET" && path.startsWith("/v1/answers/")) {
        const word = decodeURIComponent(path.split("/").pop() || "").toLowerCase();
        return handleWord(word, env);
      }
      if (method === "GET" && path === "/v1/words") return handleWords(url, env);
      if (method === "GET" && path.startsWith("/v1/words/")) {
        const word = decodeURIComponent(path.split("/").pop() || "").toLowerCase();
        return handleWord(word, env);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      return jsonResponse({ error: "Server error", detail: String((error as Error)?.message || error) }, 500);
    }
  },
};

export default worker;
