const RAW_BASE = "https://raw.githubusercontent.com/willray73-sys/wordle-words/main";
const MEMO_TTL_MS = 5 * 60 * 1000;

type Env = {
  RAW_BASE?: string;
};

type WordSets = {
  allowedWords: string[];
  usedWords: string[];
  allowedNotUsedWords: string[];
  metadata: { generated: string | null };
};

type DatedEntry = {
  date: string;
  number: number | null;
  word: string;
};

type DatedResponse = {
  results: DatedEntry[];
};

type UnusedSearchResult = {
  total: number;
  offset: number;
  limit: number;
  results: Array<{ word: string; is_used: boolean }>;
};

const wordsMemo = new Map<string, { timestamp: number; data: WordSets }>();
let datedMemo: { timestamp: number; data: DatedResponse | null } = {
  timestamp: 0,
  data: null,
};

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
  if (cached) {
    return cached.text();
  }

  const upstream = await fetch(request, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!upstream.ok) {
    throw new Error(`fetch ${url} -> ${upstream.status} ${upstream.statusText}`);
  }
  const clone = upstream.clone();
  await cache.put(request, clone);
  return upstream.text();
}

function todayETISO(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

async function fetchJSONDaily<T>(url: string): Promise<T> {
  const version = todayETISO();
  const requestUrl = `${url}?v=${encodeURIComponent(version)}`;
  const request = new Request(requestUrl, { method: "GET" });
  const cache = caches.default;

  const cached = await cache.match(request);
  if (cached) {
    return cached.json() as Promise<T>;
  }

  const upstream = await fetch(request, { cf: { cacheEverything: false } });
  if (!upstream.ok) {
    throw new Error(`fetch ${url} -> ${upstream.status} ${upstream.statusText}`);
  }
  const clone = upstream.clone();
  await cache.put(request, clone);
  return upstream.json() as Promise<T>;
}

async function getUsedDated(env: Env): Promise<DatedResponse | null> {
  const base = env.RAW_BASE || RAW_BASE;
  const now = Date.now();
  if (datedMemo.data && now - datedMemo.timestamp < MEMO_TTL_MS) {
    return datedMemo.data;
  }
  try {
    const data = await fetchJSONDaily<DatedResponse>(`${base}/public/used_dated.json`);
    if (Array.isArray(data?.results)) {
      datedMemo = { timestamp: now, data };
      return data;
    }
  } catch (error) {
    console.warn("getUsedDated failed:", error);
  }
  datedMemo = { timestamp: now, data: null };
  return null;
}

async function getJSONorCSV(env: Env): Promise<{
  allowed: any;
  used: any;
  allowedNotUsed: any;
}> {
  const base = env.RAW_BASE || RAW_BASE;
  try {
    const [allowed, used, allowedNotUsed] = await Promise.all([
      fetchText(`${base}/public/allowed.json`).then((text) => JSON.parse(text)),
      fetchText(`${base}/public/used.json`).then((text) => JSON.parse(text)),
      fetchText(`${base}/public/allowed_not_used.json`).then((text) => JSON.parse(text)),
    ]);
    return { allowed, used, allowedNotUsed };
  } catch (error) {
    const csv = await fetchText(`${base}/data/words.csv`);
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines.shift() ?? "";
    const cols = header.split(",").map((s) => s.trim().toLowerCase());
    const wordIdx = cols.indexOf("word");
    const usedIdx = Math.max(cols.indexOf("is_used"), cols.indexOf("used"));

    if (wordIdx < 0 || usedIdx < 0) {
      throw new Error("words.csv missing word/is_used columns");
    }

    const allowedWords: string[] = [];
    const usedWords: string[] = [];

    for (const line of lines) {
      const cells = line.split(",");
      const word = (cells[wordIdx] || "").trim().toLowerCase();
      const flag = (cells[usedIdx] || "").trim().toLowerCase();
      if (/^[a-z]{5}$/.test(word)) {
        allowedWords.push(word);
        if (["1", "true", "yes", "y", "t"].includes(flag)) {
          usedWords.push(word);
        }
      }
    }

    const allowedSet = new Set(allowedWords);
    const usedSet = new Set(usedWords);
    const allowedNotUsed = [...allowedSet].filter((word) => !usedSet.has(word));

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
  const memoEntry = wordsMemo.get(key);
  if (memoEntry && now - memoEntry.timestamp < MEMO_TTL_MS) {
    return memoEntry.data;
  }

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
  usedSet.forEach((word) => allowedSet.add(word));

  // Supplement with dated history, which is updated earlier than used.json
  try {
    const dated = await getUsedDated(env);
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
  } catch (error) {
    console.warn("Unable to merge dated answers into word sets", error);
  }

  const unusedList =
    allowedNotUsedRaw.length > 0
      ? Array.from(new Set(allowedNotUsedRaw)).filter((word) => !usedSet.has(word))
      : Array.from(allowedSet).filter((word) => !usedSet.has(word));

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
  if (!trimmed) {
    return /^[a-z]{5}$/;
  }
  if (/[^a-z?]/.test(trimmed) || trimmed.length !== 5) {
    return null;
  }
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
    return jsonResponse({
      ok: true,
      allowed: allowedWords.length,
      used: usedWords.length,
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
  if (isUsed === "true") results = results.filter((word) => usedSet.has(word));
  if (isUsed === "false") results = results.filter((word) => !usedSet.has(word));
  if (q) results = results.filter((word) => word.includes(q));

  const total = results.length;
  const slice = results.slice(offset, offset + limit);
  return jsonResponse({ total, offset, limit, results: slice.map((word) => word.toUpperCase()) });
}

async function handleWord(word: string, env: Env): Promise<Response> {
  if (!/^[a-z]{5}$/.test(word)) {
    return jsonResponse({ error: "word must be 5 lowercase letters" }, 400);
  }
  const { allowedWords, usedWords } = await loadWordSets(env);
  const allowedSet = new Set(allowedWords);
  const usedSet = new Set(usedWords);

  return jsonResponse({
    word: word.toUpperCase(),
    allowed: allowedSet.has(word),
    is_used: usedSet.has(word),
  });
}

async function handleStats(env: Env): Promise<Response> {
  const { allowedWords, usedWords, allowedNotUsedWords, metadata } = await loadWordSets(env);
  return jsonResponse({
    generated: metadata.generated || null,
    counts: {
      allowed: allowedWords.length,
      used: usedWords.length,
      allowed_not_used: allowedNotUsedWords.length,
    },
  });
}

async function handleStarters(url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  const top = Math.max(1, Math.min(parseInt(params.get("top") || "50", 10) || 50, 500));
  const { allowedNotUsedWords } = await loadWordSets(env);
  const ranked = allowedNotUsedWords
    .map((word) => ({ word, score: scoreStarter(word) }))
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, top);
  return jsonResponse({ results: ranked.map((entry) => ({ word: entry.word.toUpperCase(), score: entry.score })) });
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
  if (!regex) {
    return jsonResponse<UnusedSearchResult>({ total: 0, offset, limit, results: [] });
  }
  const includeSet = new Set(includes.split("").filter(Boolean));
  const excludeSet = new Set(excludes.split("").filter(Boolean));
  const usedSet = new Set(usedWords);

  const filtered = allowedWords.filter((word) => {
    if (!regex.test(word)) return false;
    for (const letter of includeSet) if (!word.includes(letter)) return false;
    for (const letter of excludeSet) if (word.includes(letter)) return false;
    return true;
  });

  const total = filtered.length;
  const results = filtered.slice(offset, offset + limit).map((word) => ({
    word: word.toUpperCase(),
    is_used: usedSet.has(word),
  }));
  return jsonResponse<UnusedSearchResult>({ total, offset, limit, results });
}

async function handleAnswersList(url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  const order = (params.get("order") || "recent").toLowerCase();
  const limit = Math.min(parseInt(params.get("limit") || "50", 10) || 50, 500);
  const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);
  const q = (params.get("q") || "").toLowerCase();

  if (order === "recent") {
    const dated = await getUsedDated(env);
    if (dated) {
      const today = todayETISO();
      const filteredEntries = dated.results
        .filter((entry) => entry.date < today)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

      const words = filteredEntries
        .map((entry) => entry.word.toUpperCase())
        .filter((word) => (q ? word.toLowerCase().includes(q) : true));

      const total = words.length;
      const slice = words.slice(offset, offset + limit);
      return jsonResponse(
        { total, offset, limit, results: slice },
        200,
        { "X-Ordering": "recent-dated" }
      );
    }
  }

  const { usedWords } = await loadWordSets(env);
  let results = usedWords.map((word) => word.toUpperCase());
  if (q) {
    results = results.filter((word) => word.toLowerCase().includes(q));
  }
  if (order === "alpha") {
    results = [...results].sort();
  } else if (order === "recent") {
    results = results.reverse();
  }

  const total = results.length;
  const slice = results.slice(offset, offset + limit);
  return jsonResponse({ total, offset, limit, results: slice });
}

async function handleAnswersDates(url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  const limit = Math.min(parseInt(params.get("limit") || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);
  const q = (params.get("q") || "").toLowerCase();

  const dated = await getUsedDated(env);
  if (!dated) {
    return jsonResponse({ error: "dated history not available" }, 503);
  }

  const today = todayETISO();
  const filteredEntries = dated.results
    .filter((entry) => entry.date < today)
    .filter((entry) => (q ? entry.word.toLowerCase().includes(q) : true))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const total = filteredEntries.length;
  const results = filteredEntries.slice(offset, offset + limit).map((entry) => ({
    date: entry.date,
    number: entry.number,
    word: entry.word.toUpperCase(),
  }));

  return jsonResponse({ total, offset, limit, results }, 200, { "X-Ordering": "recent-dated" });
}

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
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
      return jsonResponse(
        { error: "Server error", detail: String((error as Error)?.message || error) },
        500
      );
    }
  },
};

export default worker;
