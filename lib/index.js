/**
 * @fileoverview Core search library for Mercado Livre.
 * Provides functions to query ML listing pages, extract structured listing data,
 * and enrich results with full listing details.
 * @module index
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

const MARKETPLACE_DOMAIN = "lista.mercadolivre.com.br";
const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_CONCURRENCY = 5;
const VALID_STATES = new Set(["ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to"]);

const RATE_LIMIT_PAGE_DELAY = 200;
const RATE_LIMIT_DETAIL_DELAY = 100;
const RATE_LIMIT_CONCURRENCY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Known MLB categories with their URL path segments and display names.
 * Used for validation and URL construction when filtering by category.
 *
 * @type {Map<string, {path: string, name: string}>}
 */
const CATEGORIES = new Map([
  ["MLB3813", { path: "celulares-telefones/acessorios-celulares", name: "Acessórios para Celulares" }],
  ["MLB5672", { path: "acessorios-veiculos", name: "Acessórios para Veículos" }],
  ["MLB2818", { path: "mais-categorias/adultos", name: "Adultos" }],
  ["MLB271599", { path: "agro", name: "Agro" }],
  ["MLB1403", { path: "alimentos-bebidas", name: "Alimentos e Bebidas" }],
  ["MLB1368", { path: "arte-papelaria-armarinho", name: "Arte, Papelaria e Armarinho" }],
  ["MLB1613", { path: "casa-moveis-decoracao/banheiros", name: "Banheiros" }],
  ["MLB1384", { path: "bebes", name: "Bebês" }],
  ["MLB1246", { path: "beleza-cuidado-pessoal", name: "Beleza e Cuidado Pessoal" }],
  ["MLB1132", { path: "brinquedos-hobbies", name: "Brinquedos e Hobbies" }],
  ["MLB1430", { path: "calcados-roupas-bolsas", name: "Calçados, Roupas e Bolsas" }],
  ["MLB438928", { path: "casa-moveis-decoracao/camas-colchoes-acessorios", name: "Camas, Colchões e Acessórios" }],
  ["MLB1574", { path: "casa-moveis-decoracao", name: "Casa, Móveis e Decoração" }],
  ["MLB11466", { path: "livros-revistas-comics/catalogos", name: "Catálogos" }],
  ["MLB1055", { path: "celulares-telefones/celulares-smartphones", name: "Celulares e Smartphones" }],
  ["MLB1500", { path: "construcao", name: "Construção" }],
  ["MLB1618", { path: "casa-moveis-decoracao/cozinha", name: "Cozinha" }],
  ["MLB264051", { path: "casa-moveis-decoracao/cuidado-casa-lavanderia", name: "Cuidado da Casa e Lavanderia" }],
  ["MLB1039", { path: "cameras-acessorios", name: "Câmeras e Acessórios" }],
  ["MLB5726", { path: "eletrodomesticos", name: "Eletrodomésticos" }],
  ["MLB1000", { path: "eletronicos-audio-video", name: "Eletrônicos, Áudio e Vídeo" }],
  ["MLB1631", { path: "casa-moveis-decoracao/enfeites-decoracao-casa", name: "Enfeites e Decoração da Casa" }],
  ["MLB1276", { path: "esportes-fitness", name: "Esportes e Fitness" }],
  ["MLB263532", { path: "ferramentas", name: "Ferramentas" }],
  ["MLB12404", { path: "festas-lembrancinhas", name: "Festas e Lembrancinhas" }],
  ["MLB1144", { path: "games", name: "Games" }],
  ["MLB1582", { path: "casa-moveis-decoracao/iluminacao-residencial", name: "Iluminação Residencial" }],
  ["MLB1499", { path: "industria-comercio", name: "Indústria e Comércio" }],
  ["MLB1648", { path: "informatica", name: "Informática" }],
  ["MLB1182", { path: "instrumentos-musicais", name: "Instrumentos Musicais" }],
  ["MLB1621", { path: "casa-moveis-decoracao/jardim-ar-livre", name: "Jardim e Ar Livre" }],
  ["MLB3937", { path: "joias-relogios", name: "Joias e Relógios" }],
  ["MLB437616", { path: "livros-revistas-comics/livros-fisicos", name: "Livros Físicos" }],
  ["MLB436380", { path: "casa-moveis-decoracao/moveis-casa", name: "Móveis para Casa" }],
  ["MLB1168", { path: "musica-filmes-seriados", name: "Música, Filmes e Seriados" }],
  ["MLB7462", { path: "celulares-telefones/pecas-celular", name: "Peças para Celular" }],
  ["MLB1071", { path: "pet-shop", name: "Pet Shop" }],
  ["MLB2908", { path: "celulares-telefones/radio-comunicadores", name: "Rádio Comunicadores" }],
  ["MLB264586", { path: "saude", name: "Saúde" }],
  ["MLB7069", { path: "casa-moveis-decoracao/seguranca-casa", name: "Segurança para Casa" }],
  ["MLB417704", { path: "celulares-telefones/smartwatches-acessorios", name: "Smartwatches e Acessórios" }],
  ["MLB436246", { path: "casa-moveis-decoracao/texteis-casa-decoracao", name: "Têxteis de Casa e Decoração" }],
]);

/**
 * Searches Mercado Livre and returns a structured result set.
 *
 * @param {string} query - The search query string.
 * @param {object} [options={}] - Search options.
 * @param {number} [options.limit=20] - Maximum number of items to return.
 * @param {'new'|'used'} [options.condition] - Filter items by condition.
 * @param {number} [options.timeout=15000] - HTTP request timeout in milliseconds.
 * @param {'price_asc'|'price_desc'|'relevance'} [options.sort] - Sort order.
 * @param {number} [options.concurrency=5] - Max parallel detail requests per batch.
 * @param {string} [options.state] - Filter by Brazilian state(s) — MLB only. Single UF or comma-separated list (e.g. "sp", "sp,rj,mg").
 * @param {boolean} [options.strict=false] - Whether to filter results that don't match all query terms in title, description, or attributes.
 * @returns {Promise<{items: object[], query: object, pagination: object}>} Search result.
 * @throws {Error} If the page structure cannot be parsed.
 */
export async function search(query, options = {}) {
  const { limit = DEFAULT_LIMIT, condition, timeout = DEFAULT_TIMEOUT, sort, concurrency: rawConcurrency = DEFAULT_CONCURRENCY, state, category, strict = false, noRateLimit = false } = options;
  const concurrency = noRateLimit ? rawConcurrency : Math.min(rawConcurrency, RATE_LIMIT_CONCURRENCY);
  log("SEARCH", `search("${query}") called`, { limit, condition, sort, state, category, strict, noRateLimit, concurrency });

  const categoryEntry = category ? resolveCategory(category) : null;

  if (condition && categoryEntry) {
    throw new Error("The --condition and --category flags cannot be used together. Remove one of them.");
  }

  const stateList = state
    ? state
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  for (const s of stateList) {
    if (!VALID_STATES.has(s)) throw new Error(`Unknown state "${s}". Use a valid Brazilian UF (e.g. sp, rj, mg).`);
  }

  if (stateList.length > 1) {
    const settled = await Promise.allSettled(stateList.map((s) => search(query, { ...options, state: s, limit: strict ? limit * 3 : limit, category })));
    const seenIds = new Set();
    let merged = [];
    let totalSum = 0;
    let firstResultUrl = null;
    const stateResults = [];
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      const r = outcome.value;
      if (!firstResultUrl) firstResultUrl = r.query.url;
      totalSum += r.pagination.total || 0;
      stateResults.push(r.items);
    }
    const maxLen = Math.max(0, ...stateResults.map((arr) => arr.length));
    for (let i = 0; i < maxLen; i++) {
      for (const arr of stateResults) {
        if (i >= arr.length) continue;
        const item = arr[i];
        if (item.id && seenIds.has(item.id)) continue;
        if (item.id) seenIds.add(item.id);
        merged.push(item);
      }
    }
    if (strict) merged = merged.filter((item) => matchesQuery(item, query));
    if (sort === "price_asc") merged.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (sort === "price_desc") merged.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    merged = merged.slice(0, limit);
    return {
      items: merged,
      query: { text: query, condition: condition || null, sort: sort || null, state: stateList.join(","), states: stateList, category: categoryEntry?.id || null, strict, url: firstResultUrl },
      pagination: { total: totalSum, offset: 0, limit, resultsLimit: null, capped: merged.length >= limit },
    };
  }

  const singleState = stateList[0] ?? null;
  const MAX_PAGES = 20;
  const baseUrl = buildUrl(query, { condition, sort, domain: MARKETPLACE_DOMAIN, state: singleState, categoryPath: categoryEntry?.path });
  log("SEARCH", `first URL: ${baseUrl}`);
  const firstHtml = await fetchPage(baseUrl, timeout);
  const firstState = extractInitialState(firstHtml);

  if (!firstState || !Array.isArray(firstState.results)) {
    throw new Error("Could not extract search results. The page structure may have changed.");
  }

  const bestSellerIds = extractBestSellerIds(firstState);

  const seenIds = new Set();
  let items = firstState.results.map((r) => parsePolycard(r, { bestSellerIds })).filter(Boolean);
  for (const item of items) if (item.id) seenIds.add(item.id);
  log("SEARCH", `page 1 parsed: ${firstState.results.length} results -> ${items.length} valid items, total=${firstState.pagination?.results_limit ?? "?"}`);

  let nextPageUrl = firstState.pagination?.next_page?.show ? firstState.pagination.next_page.url : null;
  let pagesFetched = 1;
  while (items.length < limit && nextPageUrl && pagesFetched < MAX_PAGES) {
    if (!noRateLimit) await sleep(RATE_LIMIT_PAGE_DELAY);
    const pageHtml = await fetchPage(nextPageUrl, timeout);
    const pageState = extractInitialState(pageHtml);
    if (!pageState || !Array.isArray(pageState.results) || pageState.results.length === 0) break;

    const pageBestSellerIds = extractBestSellerIds(pageState);
    const prevCount = items.length;
    const newItems = pageState.results.map((r) => parsePolycard(r, { bestSellerIds: pageBestSellerIds })).filter(Boolean);
    for (const item of newItems) {
      if (item.id && seenIds.has(item.id)) continue;
      if (item.id) seenIds.add(item.id);
      items.push(item);
    }
    if (items.length === prevCount) break;

    nextPageUrl = pageState.pagination?.next_page?.show ? pageState.pagination.next_page.url : null;
    pagesFetched++;
    log("SEARCH", `page ${pagesFetched} fetched: ${newItems.length} new items, items total=${items.length}`);
  }

  const capped = items.length >= limit || (nextPageUrl != null && pagesFetched >= MAX_PAGES);

  if (strict) {
    const tokens = getQueryTokens(query);
    if (tokens.length > 0) items = items.filter((item) => matchesTokens(item, tokens));
  }

  if (sort === "price_asc") {
    items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  } else if (sort === "price_desc") {
    items.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  }

  items = items.slice(0, limit);

  if (items.length > 0) {
    const queue = items.filter((item) => item.permalink);
    log("SEARCH", `enriching details for ${queue.length} items (concurrency=${concurrency}, rateLimit=${!noRateLimit})`);
    for (let i = 0; i < queue.length; i += concurrency) {
      if (i > 0 && !noRateLimit) await sleep(RATE_LIMIT_DETAIL_DELAY);
      const batch = queue.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          try {
            log("DETAIL", `${item.permalink}`);
            const html = await fetchPage(item.permalink, timeout);
            const state = extractInitialState(html);
            if (!state?.components) return null;
            const c = state.components;

            const pictures = Array.isArray(c.gallery?.pictures)
              ? c.gallery.pictures.map((p) => ({
                  url: `https://http2.mlstatic.com/D_${p.id}-O.jpg`,
                  width: p.width || null,
                  height: p.height || null,
                }))
              : null;

            const description = c.description?.content ? c.description.content.trim() || null : null;

            const ratingRaw = c.reviews_capability_v3?.rating;
            const rating = ratingRaw
              ? {
                  average: ratingRaw.average ?? null,
                  count: ratingRaw.amount ?? null,
                  levels: (ratingRaw.levels || []).map((l) => ({
                    stars: 5 - (l.index || 0),
                    count: l.value || 0,
                    percentage: l.percentage || 0,
                  })),
                }
              : null;

            let attributes = null;
            if (c.highlighted_specs_attrs?.components) {
              const sections = [];
              for (const comp of c.highlighted_specs_attrs.components) {
                if (comp.type === "technical_specifications" && comp.specs) {
                  for (const spec of comp.specs) {
                    const attrs = (spec.attributes || []).map((a) => ({ name: a.id || "", value: a.text || "" }));
                    if (attrs.length > 0) sections.push({ title: spec.title || "", attributes: attrs });
                  }
                }
              }
              attributes = sections.length > 0 ? sections : null;
            }

            log("DETAIL", `  -> ok (pictures=${pictures?.length ?? 0}, desc=${!!description}, rating=${!!rating}, attrs=${attributes?.length ?? 0})`);
            return { pictures: pictures && pictures.length > 0 ? pictures : null, description, rating, attributes };
          } catch (err) {
            log("DETAIL", `  -> error: ${err.message}`);
            return null;
          }
        }),
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled" && result.value) Object.assign(batch[j], result.value);
      }
    }
  }

  log("SEARCH", `search() done: ${items.length} items returned, pages=${pagesFetched}, capped=${capped}`);
  return {
    items,
    query: {
      text: query,
      condition: condition || null,
      sort: sort || null,
      state: singleState,
      states: stateList,
      category: categoryEntry?.id || null,
      strict,
      url: baseUrl,
    },
    pagination: {
      total: firstState.pagination?.results_limit || items.length,
      offset: firstState.pagination?.offset || 0,
      limit,
      resultsLimit: firstState.pagination?.results_limit || null,
      capped,
    },
  };
}

/**
 * Fetches and returns the raw `initialState` object from a Mercado Livre listing
 * page without any normalisation or filtering. Useful for debugging or exploring
 * the raw page data structure.
 *
 * @param {string} query - The search query string.
 * @param {object} [options={}] - Request options.
 * @param {'new'|'used'} [options.condition] - Filter items by condition.
 * @param {number} [options.timeout=15000] - HTTP request timeout in milliseconds.
 * @param {'price_asc'|'price_desc'} [options.sort] - Sort order appended to the URL.
 * @returns {Promise<object>} The raw `initialState` JSON object extracted from the page.
 * @throws {Error} If `initialState` cannot be extracted.
 */
export async function searchRaw(query, options = {}) {
  const { condition, timeout = DEFAULT_TIMEOUT, sort, state, category } = options;
  log("SEARCH", `searchRaw("${query}") called`, { timeout, condition, sort, state, category });

  const categoryEntry = category ? resolveCategory(category) : null;
  if (condition && categoryEntry) {
    throw new Error("The --condition and --category flags cannot be used together. Remove one of them.");
  }

  const url = buildUrl(query, { condition, sort, domain: MARKETPLACE_DOMAIN, state: state || null, categoryPath: categoryEntry?.path });
  const html = await fetchPage(url, timeout);
  const pageState = extractInitialState(html);

  if (!pageState) {
    throw new Error("Could not extract initialState from the page.");
  }

  return pageState;
}

/**
 * Returns the known MLB categories as an array of `{id, path, name}` objects.
 *
 * @returns {{id: string, path: string, name: string}[]} Array of category entries.
 */
export function getCategories() {
  return [...CATEGORIES.entries()].map(([id, v]) => ({ id, ...v }));
}

/**
 * Resolves a category identifier (ID or URL path) to a category entry.
 * Throws if the category is not found.
 *
 * @param {string} input - Category ID (e.g. "MLB1648") or path (e.g. "informatica").
 * @returns {{id: string, path: string, name: string}} Resolved category.
 * @throws {Error} If the category is not recognised.
 */
function resolveCategory(input) {
  const upper = input.toUpperCase();
  if (CATEGORIES.has(upper)) {
    const entry = CATEGORIES.get(upper);
    return { id: upper, ...entry };
  }
  const lower = input.toLowerCase();
  for (const [id, entry] of CATEGORIES) {
    if (entry.path === lower || entry.path.endsWith("/" + lower)) {
      return { id, ...entry };
    }
  }
  const list = [...CATEGORIES.entries()].map(([id, v]) => `  ${id.padEnd(10)} ${v.name}`).join("\n");
  throw new Error(`Unknown category "${input}".\n\nValid categories:\n${list}\n\nUse --list-categories to see all options.`);
}

/**
 * Extracts the set of item IDs marked as best-sellers from the page's melidata
 * tracking payload.
 *
 * @param {object} state - The `initialState` object extracted from the listing page.
 * @returns {Set<string>} A set of best-seller item ID strings.
 */
function extractBestSellerIds(state) {
  const ids = new Set();

  const track = state.melidata_track?.event_data?.highlights_info?.best_seller_info;
  if (track?.selected) {
    for (const id of track.selected) {
      if (typeof id === "string") ids.add(id);
    }
  }

  return ids;
}

/**
 * Constructs the Mercado Livre listing URL for a given query and filters.
 *
 * @param {string} query - The search query.
 * @param {object} params - URL parameters.
 * @param {'new'|'used'|undefined} params.condition - Item condition filter.
 * @param {'price_asc'|'price_desc'|undefined} params.sort - Sort order.
 * @param {string} params.domain - The regional ML domain (e.g. `lista.mercadolivre.com.br`).
 * @returns {string} The fully qualified search URL.
 */
function buildUrl(query, { condition, sort, domain, offset = 0, state, categoryPath }) {
  const slug = encodeURIComponent(query).replace(/%20/g, "-");

  let suffix = "";
  if (!categoryPath) {
    if (condition === "used") suffix = "_Usado";
    else if (condition === "new") suffix = "_Novo";
  }

  const stateParam = state ? `_Estado_${state.toUpperCase()}` : "";

  let sortParam = "";
  if (sort === "price_asc") sortParam = "_OrderId_PRICE";
  else if (sort === "price_desc") sortParam = "_OrderId_PRICE*DESC";

  const fromParam = offset > 0 ? `_Desde_${offset + 1}` : "";

  if (categoryPath) {
    return `https://${domain}/${categoryPath}/${slug}${stateParam}${sortParam}${fromParam}_NoIndex_True`;
  }

  return `https://${domain}/${slug}${suffix}${stateParam}${sortParam}${fromParam}`;
}

/**
 * Fetches the HTML content of a URL using browser-like headers.
 *
 * @param {string} url - The URL to fetch.
 * @param {number} timeout - Request timeout in milliseconds.
 * @returns {Promise<string>} The response body as a UTF-8 string.
 * @throws {Error} If the HTTP response status is not OK.
 */
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const BROWSER_HEADERS_ENTRIES = Object.entries(BROWSER_HEADERS);

async function fetchWithFetch(url, timeout) {
  log("HTTP", `fetch -> ${url} (timeout: ${timeout}ms)`);
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  log("HTTP", `fetch <- ${res.status} ${res.statusText} (content-type: ${res.headers.get("content-type")})`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = await res.text();
  log("HTTP", `fetch body: ${body.length} bytes`);
  return body;
}

async function fetchWithCurl(url, timeout) {
  log("CURL", `curl -> ${url}`);
  const timeoutSec = Math.max(1, Math.ceil(timeout / 1000));
  const args = ["-sS", "-L", "--max-time", String(timeoutSec), "--compressed", "-w", "\n%{http_code}"];
  for (const [key, value] of BROWSER_HEADERS_ENTRIES) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
  const lastNewline = stdout.lastIndexOf("\n");
  const statusCode = parseInt(stdout.slice(lastNewline + 1).trim(), 10);
  const body = stdout.slice(0, lastNewline);
  log("CURL", `curl <- ${statusCode} (${body.length} bytes)`);
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode}`);
  return body;
}

async function fetchPage(url, timeout) {
  try {
    return await fetchWithFetch(url, timeout);
  } catch (err) {
    log("HTTP", `fetch failed, falling back to curl: ${err.message}`);
    return fetchWithCurl(url, timeout);
  }
}

/**
 * Extracts the `initialState` JSON object embedded in a Mercado Livre HTML page.
 * Locates the `"initialState":` marker and counts brace depth to find the
 * matching closing brace, then parses the extracted substring.
 *
 * @param {string} html - Raw HTML string of the page.
 * @returns {object|null} Parsed `initialState` object, or `null` if not found or malformed.
 */
export function extractInitialState(html) {
  const marker = '"initialState":';
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const idx = html.indexOf(marker, searchFrom);
    if (idx < 0) return null;

    const jsonStart = idx + marker.length;
    let depth = 0;
    let jsonEnd = jsonStart;
    let found = false;

    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") {
        depth--;
        if (depth === 0) {
          jsonEnd = i;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      searchFrom = jsonStart;
      continue;
    }

    try {
      const state = JSON.parse(html.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(state.results) && state.results.length > 0) {
        return state;
      }
      searchFrom = jsonEnd + 1;
    } catch {
      searchFrom = jsonStart + 1;
    }
  }

  return null;
}

/**
 * Normalises a string for fuzzy matching: lowercases, strips accents and
 * collapses whitespace.
 *
 * @param {string} str - Input string.
 * @returns {string} Normalised string.
 */
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words too common to be meaningful query filters. */
const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "ou", "em", "com", "para", "por", "um", "uma", "o", "a", "os", "as", "no", "na", "nos", "nas", "the", "and", "or", "for", "in", "of", "to", "with"]);

/**
 * Checks whether an item matches ALL significant terms in the search query.
 * Builds a text corpus from title, description and attributes, then verifies
 * that every non-stop-word query token appears in the corpus.
 *
 * @param {object} item - A normalised item object.
 * @param {string} query - The original search query string.
 * @returns {boolean} `true` if the item matches all query terms.
 */
function getQueryTokens(query) {
  return normalize(query)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function matchesTokens(item, tokens) {
  if (tokens.length === 0) return true;

  let corpus = normalize(item.title || "");
  if (item.description) corpus += " " + normalize(item.description);
  if (item.attributes) {
    for (const section of item.attributes) {
      for (const attr of section.attributes || []) {
        corpus += " " + normalize(attr.value || "");
      }
    }
  }

  return tokens.every((token) => corpus.includes(token));
}

function matchesQuery(item, query) {
  return matchesTokens(item, getQueryTokens(query));
}

/**
 * Extracts a full numeric price from a polycard price object, combining the
 * integer `value` with the separate `cents` field when present.
 *
 * @param {object|undefined} priceObj - A polycard price entry (e.g. `current_price`).
 * @returns {number} The price as a floating-point number.
 */
function extractPrice(priceObj) {
  if (!priceObj) return 0;
  let price = priceObj.value || 0;
  const raw = priceObj.cents ?? priceObj.fraction ?? null;
  if (raw != null && raw !== "") {
    const cents = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (!isNaN(cents) && Number.isInteger(price)) {
      price = price + cents / 100;
    }
  }
  return Math.round(price * 100) / 100;
}

/**
 * Normalises a single raw search result (polycard) into a structured item object.
 *
 * @param {object} result - A raw result entry from `state.results`.
 * @param {object} [options={}] - Parsing options.
 * @param {Set<string>} [options.bestSellerIds=new Set()] - Best-seller item IDs from melidata.
 * @returns {object|null} Normalised item object, or `null` if the entry should be skipped.
 */
function parsePolycard(result, { bestSellerIds = new Set() } = {}) {
  const pc = result?.polycard;
  if (!pc) return null;

  const meta = pc.metadata || {};
  const comps = pc.components || [];
  const isAd = meta.is_pad === "true";

  if (isAd) return null;

  const comp = (type) => comps.find((c) => c.type === type) || {};

  const title = comp("title").title?.text || "";
  if (!title) return null;

  const priceComp = comp("price").price || {};
  const price = extractPrice(priceComp.current_price);
  const currency = priceComp.current_price?.currency || "BRL";
  const originalPrice = priceComp.previous_price?.value != null ? extractPrice(priceComp.previous_price) : null;

  let discountPercent = null;
  const discountLabel = priceComp.discount_label?.text || "";
  const discountMatch = discountLabel.match(/(\d{1,3})\s*%/);
  if (discountMatch) {
    discountPercent = Number(discountMatch[1]);
  } else if (originalPrice && originalPrice > price) {
    discountPercent = Math.round(((originalPrice - price) / originalPrice) * 100);
  }

  const installments = priceComp.installments || null;
  let installmentText = null;
  if (installments?.text) {
    installmentText = installments.text;
    for (const v of installments.values || []) {
      if (v.type === "price" && v.price?.value) {
        installmentText = installmentText.replace(`{${v.key}}`, `${v.price.currency || ""} ${v.price.value}`);
      }
    }
    installmentText = installmentText.replace(/\s*\{[^}]+\}\s*/g, " ").trim();
  }

  const shippingComp = comp("shipping").shipping || {};
  const shippingText = shippingComp.text || "";
  const freeShipping = /gr[aá]tis/i.test(shippingText);

  const sellerRaw = comp("seller").seller?.text || "";
  const seller = sellerRaw.replace(/\s*\{[^}]+\}\s*/g, "").trim() || null;

  const highlightRaw = comp("highlight").highlight?.text || null;
  const highlight = highlightRaw ? highlightRaw.replace(/\s*\{[^}]+\}\s*/g, " ").trim() || null : null;

  const bestSeller = (highlight ? /mais\s+vendido|m[aá]s\s+vendido|best\s*seller/i.test(highlight) : false) || bestSellerIds.has(meta.id);

  const promos = (comp("promotions").promotions || []).map((p) => {
    let text = p.text || "";
    for (const v of p.values || []) {
      text = text.replace(`{${v.key}}`, "").trim();
    }
    return { type: p.type, text };
  });

  const rawUrl = meta.url || "";
  let permalink = "";
  if (rawUrl && !isAd) {
    permalink = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  } else if (meta.id) {
    const numId = meta.id.replace(/^MLB/, "");
    permalink = `https://produto.mercadolivre.com.br/MLB-${numId}`;
  }

  const picId = pc.pictures?.pictures?.[0]?.id || "";
  const thumbnail = picId ? `https://http2.mlstatic.com/D_${picId}-O.jpg` : null;

  const reviewComp = comp("review_compacted").review_compacted || {};
  let ratingAverage = null;
  let ratingSales = null;
  if (reviewComp.values) {
    const labelVal = reviewComp.values.find((v) => v.key === "label");
    if (labelVal?.label?.text) ratingAverage = parseFloat(labelVal.label.text) || null;
    const label2Val = reviewComp.values.find((v) => v.key === "label2");
    if (label2Val?.label?.text) ratingSales = label2Val.label.text.replace(/^\|\s*/, "").trim() || null;
  }

  return {
    id: meta.id || null,
    title,
    price,
    currency,
    originalPrice,
    discountPercent,
    installments: installmentText,
    freeShipping,
    shipping: shippingText || null,
    seller,
    bestSeller,
    highlight,
    promotions: promos.length > 0 ? promos : null,
    thumbnail,
    permalink,
    categoryId: meta.category_id || null,
    isAd,
    rating: ratingAverage ? { average: ratingAverage, sales: ratingSales } : null,
    pictures: null,
    description: null,
    attributes: null,
  };
}
