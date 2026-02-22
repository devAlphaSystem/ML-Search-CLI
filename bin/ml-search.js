#!/usr/bin/env node

/**
 * @fileoverview CLI entry point for ml-search.
 * Parses command-line arguments and delegates to the search library,
 * then formats and prints results to stdout.
 * @module ml-search
 */

import { parseArgs } from "node:util";
import { search, searchRaw, getCategories } from "../lib/index.js";

const HELP = `
  \x1b[1mml-search\x1b[0m — Search Mercado Livre from the terminal.

  \x1b[1mUsage:\x1b[0m
    ml-search <query> [options]

  \x1b[1mArguments:\x1b[0m
    query                  Search query (required)

  \x1b[1mOptions:\x1b[0m
    -l, --limit <n>        Max results to return (default: 20)
    -c, --condition <type> Filter: "new" or "used"
    --sort <order>         Sort: "price_asc", "price_desc", or "relevance"
    --category <id>        Filter by category ID (e.g. "MLB1648") or slug (e.g. "informatica")
    --list-categories      List all valid categories and exit
    --timeout <ms>         HTTP timeout in ms (default: 15000)
    --concurrency <n>      Max parallel detail requests (default: 5)
    --state <uf>           Filter by Brazilian state(s) — MLB only (e.g. "sp", "rj,mg,sp")
    --strict               Only show results where ALL search terms appear in the title, description or attributes

  \x1b[1mOutput:\x1b[0m
    -f, --format <type>    Output format: "json", "table", "jsonl", "csv" (default: json)
    --pretty               Pretty-print JSON output
    --raw                  Output the full raw initialState object
    --fields <list>        Comma-separated fields to include (e.g. "title,price,permalink")
    -w, --web              Open results as a web page in the browser

  \x1b[1mExamples:\x1b[0m
    ml-search "bateria Samsung Galaxy S22"
    ml-search "notebook Dell" -l 5 -c used -f table
    ml-search "tela lcd" --fields title,price,permalink --format csv
    ml-search "webcam" --raw > raw-state.json
    ml-search "notebook Dell" --web

    ml-search "iPhone 15" --state sp -f table
    ml-search "moto g" --state sp,rj,mg --sort price_asc
    ml-search "celular" --category MLB1648 --sort price_asc
    ml-search "notebook" --category informatica -f table
    ml-search --list-categories
    ml-search "Samsung S20" --strict -f table
    ml-search "iPhone 15" --strict --pretty -l 10
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: "string", short: "l" },
      condition: { type: "string", short: "c" },
      sort: { type: "string" },
      timeout: { type: "string" },
      concurrency: { type: "string" },
      state: { type: "string" },
      category: { type: "string" },
      "list-categories": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      format: { type: "string", short: "f" },
      pretty: { type: "boolean", default: false },
      raw: { type: "boolean", default: false },
      fields: { type: "string" },
      web: { type: "boolean", short: "w", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
} catch (e) {
  error(e.message);
}

const { values: opts, positionals } = parsed;

if (opts.help) {
  process.stdout.write(HELP + "\n");
  process.exit(0);
}

if (opts["list-categories"]) {
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const cats = getCategories();
  console.log(bold("\nCategorias disponíveis no Mercado Livre (MLB):\n"));
  console.log(`  ${bold("ID".padEnd(12))} ${bold("Nome")}`);
  console.log(dim(`  ${"-".repeat(11)} ${"-".repeat(40)}`));
  for (const cat of cats) {
    console.log(`  ${cat.id.padEnd(12)} ${cat.name}`);
  }
  console.log(dim(`\n  Total: ${cats.length} categorias`));
  console.log(dim(`  Uso: ml-search "query" --category MLB1648`));
  console.log();
  process.exit(0);
}

if (opts.version) {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}

const query = positionals.join(" ").trim();
if (!query) {
  error("No search query provided. Use --help for usage info.");
}

const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 15000;
const concurrency = opts.concurrency ? parseInt(opts.concurrency, 10) : 5;
const format = (opts.format || "json").toLowerCase();
const fields = opts.fields
  ? opts.fields
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
  : null;

if (!["json", "table", "jsonl", "csv"].includes(format)) {
  error(`Unknown format "${format}". Supported: json, table, jsonl, csv`);
}

if (!Number.isInteger(concurrency) || concurrency < 1) {
  error(`Invalid --concurrency "${opts.concurrency}". It must be a positive integer.`);
}

if (!Number.isInteger(limit) || limit < 1) {
  error(`Invalid --limit "${opts.limit}". It must be a positive integer.`);
}

if (!Number.isInteger(timeout) || timeout < 1) {
  error(`Invalid --timeout "${opts.timeout}". It must be a positive integer.`);
}

try {
  if (opts.raw) {
    const raw = await searchRaw(query, {
      condition: opts.condition,
      timeout,
      sort: opts.sort,
      state: opts.state,
      category: opts.category,
    });
    console.log(JSON.stringify(raw, null, 2));
    process.exit(0);
  }

  const result = await search(query, {
    limit,
    condition: opts.condition,
    timeout,
    sort: opts.sort,
    concurrency,
    state: opts.state,
    category: opts.category,
    strict: opts.strict,
  });

  let items = result.items;

  if (fields) {
    items = items.map((item) => {
      const filtered = {};
      for (const f of fields) {
        if (f in item) filtered[f] = item[f];
      }
      return filtered;
    });
  }

  if (opts.web) {
    await openInBrowser(result, items);
  } else {
    output(items, result, format, opts.pretty);
  }

  const got = result.items.length;
  const platformMax = result.pagination.resultsLimit;
  if (got < limit) {
    if (result.pagination.capped) {
      process.stderr.write(`\x1b[33mNote:\x1b[0m Returned ${got} of ${limit} requested.`);
      if (platformMax && limit > platformMax) {
        process.stderr.write(` The platform limits browsable results to ${platformMax.toLocaleString("pt-BR")}.`);
      } else {
        const total = result.pagination.total;
        if (total > got) {
          process.stderr.write(` ${total.toLocaleString("pt-BR")} total results available on Mercado Livre.`);
        }
      }
      process.stderr.write("\n");
    }
  } else if (platformMax && limit > platformMax) {
    process.stderr.write(`\x1b[33mNote:\x1b[0m The platform limits browsable results to ${platformMax.toLocaleString("pt-BR")}. Requested: ${limit}.\n`);
  }
} catch (e) {
  error(e.message);
}

/**
 * Prints search results to stdout in the requested format.
 *
 * @param {object[]} items - The (possibly field-filtered) result items to display.
 * @param {object} result - The full search result object returned by {@link search}.
 * @param {'json'|'jsonl'|'csv'|'table'} fmt - Output format.
 * @param {boolean} pretty - Whether to pretty-print JSON output.
 */
function output(items, result, fmt, pretty) {
  switch (fmt) {
    case "json":
      if (pretty) {
        console.log(JSON.stringify({ ...result, items }, null, 2));
      } else {
        console.log(JSON.stringify({ ...result, items }));
      }
      break;

    case "jsonl":
      for (const item of items) {
        console.log(JSON.stringify(item));
      }
      break;

    case "csv":
      outputCsv(items);
      break;

    case "table":
      outputTable(items);
      break;
  }
}

/**
 * Renders search results as a human-readable, ANSI-coloured table to stdout.
 * Each item is printed as a multi-line card showing title, price, badges,
 * seller, rating, photo count, attributes, and a description snippet.
 *
 * @param {object[]} items - Parsed search result items.
 */
function outputTable(items) {
  if (items.length === 0) {
    console.log("No results found.");
    return;
  }

  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
  const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

  console.log(dim(`─── Found ${items.length} result${items.length === 1 ? "" : "s"} ───`));
  console.log();

  for (const [i, item] of items.entries()) {
    const num = dim(`${String(i + 1).padStart(2)}.`);
    const title = bold((item.title || "").slice(0, 72));
    const safeCur = { R$: "BRL", BRL: "BRL", USD: "USD", US$: "USD", EUR: "EUR", $: "USD" };
    const code =
      safeCur[
        String(item.currency || "")
          .trim()
          .toUpperCase()
      ] ||
      item.currency ||
      "BRL";
    let priceStr;
    try {
      priceStr = new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(item.price || 0);
    } catch {
      priceStr = `${item.currency || "BRL"} ${(item.price || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    }
    const price = green(priceStr);

    let badges = "";
    if (item.bestSeller) badges += `\x1b[35;1m [BEST SELLER]\x1b[0m`;
    else if (item.highlight) badges += yellow(` [${item.highlight}]`);
    if (item.freeShipping) badges += cyan(" [FRETE GRÁTIS]");
    if (item.discountPercent) badges += yellow(` -${item.discountPercent}%`);
    if (item.originalPrice) badges += dim(` (was ${item.originalPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`);
    if (item.isAd) badges += dim(" [ad]");

    const seller = item.seller ? dim(` • ${item.seller}`) : "";
    const link = item.permalink ? dim(`  ${item.permalink}`) : "";

    let ratingLine = "";
    if (item.rating?.average != null) {
      const stars = "*".repeat(Math.round(item.rating.average)) + "-".repeat(5 - Math.round(item.rating.average));
      ratingLine = yellow(`    ${stars} ${item.rating.average}`);
      if (item.rating.count != null) ratingLine += dim(` (${item.rating.count} avaliações)`);
      if (item.rating.sales) ratingLine += dim(` ${item.rating.sales}`);
    }

    console.log(`${num} ${title}`);
    console.log(`    ${price}${badges}${seller}`);
    if (ratingLine) console.log(ratingLine);
    if (link) console.log(`    ${link}`);

    if (item.pictures && item.pictures.length > 0) {
      console.log(dim(`    PHOTOS: ${item.pictures.length} foto${item.pictures.length === 1 ? "" : "s"}`));
    }

    if (item.attributes) {
      for (const section of item.attributes) {
        console.log(cyan(`    ─ ${section.title}`));
        for (const attr of section.attributes) {
          console.log(dim(`      ${attr.name}: `) + attr.value);
        }
      }
    }

    if (item.description) {
      const desc = item.description.replace(/\n+/g, " ").trim();
      console.log(dim(`    DESCRIPTION: ${desc.length > 120 ? desc.slice(0, 120) + "…" : desc}`));
    }

    console.log();
  }
}

/**
 * Serialises search results as CSV to stdout.
 * The header row is derived from the keys of the first item.
 * Values that contain commas, double-quotes, or newlines are RFC 4180-quoted.
 *
 * @param {object[]} items - Parsed search result items.
 */
const CSV_ESCAPE_RE = /[,"\n\r]/;

function outputCsv(items) {
  if (items.length === 0) return;

  const keys = Object.keys(items[0]);
  console.log(keys.join(","));

  for (const item of items) {
    const row = keys.map((k) => {
      const v = item[k];
      if (v == null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (CSV_ESCAPE_RE.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    console.log(row.join(","));
  }
}

/**
 * Generates a complete self-contained HTML page for the given search results.
 *
 * @param {object} result - The full search result from {@link search}.
 * @param {object[]} items - The (possibly field-filtered) items to render.
 * @returns {string} A complete HTML document as a string.
 */
function generateHtml(result, items) {
  const { query, pagination } = result;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const CURRENCY_MAP = { R$: "BRL", BRL: "BRL", USD: "USD", US$: "USD", EUR: "EUR", "€": "EUR", $: "USD" };
  const safeCurrency = (c) => {
    const u = String(c || "")
      .trim()
      .toUpperCase();
    return CURRENCY_MAP[u] ?? (u.length === 3 ? u : "BRL");
  };
  const fmtPrice = (price, currency) => {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: safeCurrency(currency) }).format(price);
    } catch {
      return `${currency || "BRL"} ${price}`;
    }
  };

  const starsHtml = (avg) => {
    if (avg == null) return "";
    const n = Math.min(5, Math.max(0, Math.round(avg)));
    return "&#9733;".repeat(n) + "&#9734;".repeat(5 - n);
  };

  const card = (item, index) => {
    const link = esc(item.permalink || "#");

    const allPics = item.pictures?.length > 0 ? item.pictures.map((p) => p.url) : item.thumbnail ? [item.thumbnail] : [];
    const mainSrc = allPics[0] || "";
    const thumbImg = mainSrc ? `<img class="thumb main-img" src="${esc(mainSrc)}" alt="${esc(item.title)}" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex'">` : "";

    const thumbPh = `<div class="thumb-ph"${mainSrc ? ' style="display:none"' : ""}><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M2 15l5-5 4 4 3-3 5 5"/><circle cx="8" cy="8" r="2"/></svg></div>`;
    const galleryStrip = allPics.length > 1 ? `<div class="gallery-strip">${allPics.map((url, gi) => `<button class="gal-btn${gi === 0 ? " active" : ""}" data-src="${esc(url)}" type="button" aria-label="Foto ${gi + 1}"><img src="${esc(url)}" loading="lazy" alt=""></button>`).join("")}</div>` : "";

    const badges = [item.discountPercent != null && `<span class="b disc">-${item.discountPercent}%</span>`, item.bestSeller && `<span class="b best">Mais Vendido</span>`, !item.bestSeller && item.highlight && `<span class="b hl">${esc(item.highlight)}</span>`, item.freeShipping && `<span class="b ship">Frete Gr\xE1tis</span>`, item.isAd && `<span class="b ad">Patrocinado</span>`].filter(Boolean).join("");

    const priceHtml = item.price != null ? `<div class="price-row"><span class="price">${esc(fmtPrice(item.price, item.currency))}</span>${item.originalPrice != null ? `<span class="orig">${esc(fmtPrice(item.originalPrice, item.currency))}</span>` : ""}</div>` : "";

    const instHtml = item.installments ? `<p class="inst">${esc(item.installments)}</p>` : "";
    const sellerHtml = item.seller ? `<p class="seller">por ${esc(item.seller)}</p>` : "";

    const ratingHtml = item.rating?.average != null ? `<div class="rating"><span class="stars">${starsHtml(item.rating.average)}</span><span class="avg">${item.rating.average}</span>${item.rating.count != null ? `<span class="cnt">(${item.rating.count})</span>` : ""}${item.rating.sales ? `<span class="sales">${esc(item.rating.sales)}</span>` : ""}</div>` : "";

    const promosHtml = item.promotions?.length ? `<div class="promos">${item.promotions.map((p) => `<span class="promo">${esc(p.text)}</span>`).join("")}</div>` : "";

    return `<article class="card" data-index="${index}" data-title="${esc((item.title || "").toLowerCase())}" data-desc="${esc((item.description || "").toLowerCase().slice(0, 500))}" data-price="${item.price ?? 0}" data-rating="${item.rating?.average ?? 0}" data-discount="${item.discountPercent ?? 0}">
      <div class="img-zone">
        <a class="img-a" href="${link}" target="_blank" rel="noopener noreferrer">${thumbImg}${thumbPh}</a>
        ${galleryStrip}
      </div>
      <div class="card-body">
        ${badges ? `<div class="badges">${badges}</div>` : ""}
        <a class="title-a" href="${link}" target="_blank" rel="noopener noreferrer"><h2 class="card-title">${esc(item.title)}</h2></a>
        ${priceHtml}${instHtml}${ratingHtml}${sellerHtml}${promosHtml}
        <a class="btn-cta" href="${link}" target="_blank" rel="noopener noreferrer">Ver an\xFAncio &#8594;</a>
      </div>
    </article>`;
  };

  const sortMap = { price_asc: "price-asc", price_desc: "price-desc", relevance: "relevance" };
  const initialSort = sortMap[query.sort] || "relevance";
  const total = (pagination.total || items.length).toLocaleString("pt-BR");
  const now = new Date().toLocaleString("pt-BR");
  const cardsHtml = items.length > 0 ? items.map((item, i) => card(item, i)).join("\n") : '<p class="empty">Nenhum resultado encontrado.</p>';

  const css = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f4f5f7;--surface:#fff;--surface-2:#eef0f3;--border:#e2e5ea;
  --text:#111827;--muted:#6b7280;
  --accent:#ffe600;--accent-fg:#111827;
  --price-c:#00a650;
  --disc-bg:#f97316;--disc-fg:#fff;
  --best-bg:#00a650;--best-fg:#fff;
  --hl-bg:#6366f1;--hl-fg:#fff;
  --ship-bg:#059669;--ship-fg:#fff;
  --ad-bg:#e5e7eb;--ad-fg:#6b7280;
  --promo-c:#6366f1;
  --sh1:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.05);
  --sh2:0 6px 20px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.07);
  --r:14px;--rs:6px;
  --page-max:1680px;
  --header-py:.9rem;--header-px:1.5rem;
  --main-px:1.25rem;--main-pt:1.5rem;--main-pb:3rem;
  --card-gap:.4rem;--card-px:1rem;--card-pt:.875rem;--card-pb:1rem;
  --grid-gap:1.125rem;
  --ctl-py:.7rem;--ctl-px:1.25rem;--ctl-gap:.6rem;
  --chip-py:.28rem;--chip-px:.6rem;
  --thumb-pad:.5rem;
  --btn-py:.58rem;
  --icon-btn:36px;
  --footer-py:1.1rem;--footer-px:1.5rem;
}
@media(prefers-color-scheme:dark){
  :root:not([data-theme=light]){
    --bg:#0c0c14;--surface:#181825;--surface-2:#21212f;--border:#2b2b3d;
    --text:#f0eff9;--muted:#8b8aa8;--price-c:#1ec86a;
    --sh1:0 1px 4px rgba(0,0,0,.3);--sh2:0 6px 24px rgba(0,0,0,.45);
    --ad-bg:#2b2b3d;--ad-fg:#8b8aa8;
  }
}
[data-theme=dark]{
  --bg:#0c0c14;--surface:#181825;--surface-2:#21212f;--border:#2b2b3d;
  --text:#f0eff9;--muted:#8b8aa8;--price-c:#1ec86a;
  --sh1:0 1px 4px rgba(0,0,0,.3);--sh2:0 6px 24px rgba(0,0,0,.45);
  --ad-bg:#2b2b3d;--ad-fg:#8b8aa8;
}
[data-theme=light]{
  --bg:#f4f5f7;--surface:#fff;--surface-2:#eef0f3;--border:#e2e5ea;
  --text:#111827;--muted:#6b7280;--price-c:#00a650;
  --sh1:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.05);
  --sh2:0 6px 20px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.07);
  --ad-bg:#e5e7eb;--ad-fg:#6b7280;
}
body{font-family:'Poppins',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5;transition:background .2s,color .2s}
header{position:sticky;top:0;z-index:100;background:var(--accent);color:var(--accent-fg);padding:var(--header-py) var(--header-px);display:flex;align-items:center;gap:1rem;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.2)}
.h-left{display:flex;align-items:center;gap:.75rem;min-width:0;flex:1}
.logo{font-size:1.1rem;font-weight:800;letter-spacing:-.5px;white-space:nowrap;flex-shrink:0}
.logo em{font-style:normal;font-weight:400;opacity:.6}
.h-info{display:flex;flex-direction:column;min-width:0}
.h-query{font-weight:700;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-meta{font-size:.7rem;opacity:.65;white-space:nowrap}
.theme-btn{flex-shrink:0;margin-left:auto;width:var(--icon-btn);height:var(--icon-btn);border-radius:50%;border:none;background:rgba(255,255,255,.2);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--accent-fg);transition:background .15s}
.theme-btn:hover{background:rgba(255,255,255,.35)}
.theme-btn svg{width:17px;height:17px;display:block}
main{max-width:var(--page-max);margin:0 auto;padding:var(--main-pt) var(--main-px) var(--main-pb)}
.empty{text-align:center;margin-top:5rem;color:var(--muted);font-size:1.05rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:var(--grid-gap)}
.card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh1);transition:box-shadow .2s,transform .2s,border-color .2s}
.card:hover{box-shadow:var(--sh2);transform:translateY(-3px);border-color:var(--accent)}
.img-a{display:block;background:var(--surface-2);aspect-ratio:1/1;overflow:hidden;position:relative}
.thumb{width:100%;height:100%;object-fit:contain;padding:var(--thumb-pad);transition:transform .3s ease}
.img-a:hover .thumb{transform:scale(1.06)}
.thumb-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);opacity:.3}
.card-body{padding:var(--card-pt) var(--card-px) var(--card-pb);display:flex;flex-direction:column;gap:var(--card-gap);flex:1}
.badges{display:flex;flex-wrap:wrap;gap:.3rem}
.b{display:inline-block;padding:.18rem .42rem;border-radius:var(--rs);font-size:.6rem;font-weight:700;letter-spacing:.4px;text-transform:uppercase;line-height:1.3}
.b.disc{background:var(--disc-bg);color:var(--disc-fg)}
.b.best{background:var(--best-bg);color:var(--best-fg)}
.b.hl{background:var(--hl-bg);color:var(--hl-fg)}
.b.ship{background:var(--ship-bg);color:var(--ship-fg)}
.b.ad{background:var(--ad-bg);color:var(--ad-fg)}
.title-a{text-decoration:none;color:inherit}
.card-title{font-size:.875rem;font-weight:500;line-height:1.45;color:var(--text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;transition:color .15s}
.title-a:hover .card-title{color:#1a56db}
[data-theme=dark] .title-a:hover .card-title{color:#93c5fd}
.price-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:.35rem;margin-top:.1rem}
.price{font-size:1.2rem;font-weight:700;color:var(--price-c)}
.orig{font-size:.76rem;color:var(--muted);text-decoration:line-through}
.inst{font-size:.72rem;color:var(--muted)}
.rating{display:flex;align-items:center;flex-wrap:wrap;gap:.25rem;font-size:.74rem}
.stars{color:#f59e0b}
.avg{font-weight:600}
.cnt,.sales{color:var(--muted)}
.seller{font-size:.71rem;color:var(--muted)}
.promos{display:flex;flex-wrap:wrap;gap:.3rem}
.promo{font-size:.67rem;color:var(--promo-c);border:1px solid color-mix(in srgb,var(--promo-c) 30%,transparent);border-radius:var(--rs);padding:.1rem .32rem;background:color-mix(in srgb,var(--promo-c) 8%,transparent)}
.img-zone{display:flex;flex-direction:column}
.gallery-strip{display:flex;gap:4px;padding:5px 6px;background:var(--surface-2);border-top:1px solid var(--border);overflow-x:auto;scrollbar-width:none}
.gallery-strip::-webkit-scrollbar{display:none}
.gal-btn{flex-shrink:0;width:38px;height:38px;border-radius:5px;border:2px solid transparent;background:var(--surface);padding:1px;cursor:pointer;transition:border-color .15s,transform .1s;overflow:hidden}
.gal-btn img{width:100%;height:100%;object-fit:cover;border-radius:3px;display:block}
.gal-btn.active{border-color:var(--accent)}
.gal-btn:hover:not(.active){border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.gal-btn:active{transform:scale(.92)}
.btn-cta{display:block;text-align:center;margin-top:auto;padding:var(--btn-py);background:var(--accent);color:var(--accent-fg);font-weight:700;font-size:.8rem;border-radius:var(--rs);text-decoration:none;transition:filter .15s,transform .1s}
.btn-cta:hover{filter:brightness(.93);transform:scale(1.01)}
.controls{background:var(--surface);border-bottom:1px solid var(--border);padding:var(--ctl-py) var(--ctl-px);display:flex;flex-wrap:wrap;align-items:center;gap:var(--ctl-gap);position:sticky;top:var(--controls-top,56px);z-index:90;backdrop-filter:blur(8px)}
.ctrl-search{display:flex;align-items:center;gap:.45rem;background:var(--surface-2);border:1px solid var(--border);border-radius:99px;padding:.32rem .75rem;flex:1;min-width:160px;max-width:340px;transition:border-color .15s}
.ctrl-search:focus-within{border-color:var(--accent)}
.ctrl-search svg{flex-shrink:0;color:var(--muted);width:15px;height:15px}
.ctrl-search input{border:none;background:transparent;color:var(--text);font-size:.83rem;width:100%;outline:none}
.ctrl-search input::placeholder{color:var(--muted)}
.ctrl-sort{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem}
.sort-label{font-size:.74rem;font-weight:600;color:var(--muted);flex-shrink:0;white-space:nowrap}
.sort-btn{border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-size:.72rem;font-weight:500;padding:var(--chip-py) var(--chip-px);border-radius:99px;cursor:pointer;transition:background .15s,border-color .15s,color .15s,transform .1s}
.sort-btn:hover{border-color:color-mix(in srgb,var(--accent) 60%,transparent);background:color-mix(in srgb,var(--accent) 10%,var(--surface-2))}
.sort-btn.active{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:700}
.sort-btn:active{transform:scale(.96)}
.ctrl-count{font-size:.73rem;color:var(--muted);margin-left:auto;white-space:nowrap;flex-shrink:0}
.card.hidden{display:none!important}
.no-match{grid-column:1/-1;text-align:center;padding:4rem 1rem;color:var(--muted);font-size:1rem}
footer{border-top:1px solid var(--border);padding:var(--footer-py) var(--footer-px);text-align:center;font-size:.75rem;color:var(--muted)}
footer strong{color:var(--text)}
footer a{color:inherit}
.ctrl-anti{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem}
.anti-label{font-size:.74rem;font-weight:600;color:var(--muted);flex-shrink:0;white-space:nowrap}
.anti-input-wrap{display:flex;align-items:center;gap:.45rem;background:var(--surface-2);border:1px solid var(--border);border-radius:99px;padding:.32rem .75rem;min-width:140px;max-width:260px;transition:border-color .15s}
.anti-input-wrap:focus-within{border-color:#ef4444}
.anti-input-wrap svg{flex-shrink:0;color:var(--muted);width:15px;height:15px}
.anti-input-wrap input{border:none;background:transparent;color:var(--text);font-size:.83rem;width:100%;outline:none}
.anti-input-wrap input::placeholder{color:var(--muted)}
.anti-chips{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
.anti-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.2rem .5rem .2rem .6rem;background:color-mix(in srgb,#ef4444 12%,var(--surface-2));border:1px solid color-mix(in srgb,#ef4444 35%,transparent);border-radius:99px;font-size:.7rem;font-weight:600;color:#ef4444}
.anti-chip button{background:none;border:none;cursor:pointer;color:inherit;padding:0 0 0 .15rem;line-height:1;font-size:.9rem;opacity:.7;display:flex;align-items:center}
.anti-chip button:hover{opacity:1}
@media(max-width:600px){.controls{padding:.6rem .875rem;gap:.5rem}.ctrl-search{max-width:100%;width:100%}.ctrl-count{display:none}}
@media(max-width:480px){header{padding:.75rem 1rem}.h-meta{display:none}main{padding:1rem .875rem 2.5rem}.grid{gap:.875rem}}`;

  const js = `(function(){
  var root=document.documentElement,btn=document.getElementById('theme-btn');
  var SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function isDark(){var t=root.getAttribute('data-theme');return t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)}
  function apply(dark){root.setAttribute('data-theme',dark?'dark':'light');btn.innerHTML=dark?SUN:MOON;try{localStorage.setItem('ml-theme',dark?'dark':'light')}catch(e){}}
  var saved;try{saved=localStorage.getItem('ml-theme')}catch(e){}
  apply(saved?saved==='dark':false);
  btn.addEventListener('click',function(){apply(!isDark())});

  var hdr=document.querySelector('header'),ctl=document.querySelector('.controls');
  function pinControls(){if(hdr&&ctl){document.documentElement.style.setProperty('--controls-top',hdr.offsetHeight+'px');}}
  pinControls();
  window.addEventListener('resize',pinControls);

  var searchInput=document.getElementById('search-input');
  var sortBtns=document.querySelectorAll('.sort-btn');
  var cards=Array.from(document.querySelectorAll('.card'));
  var grid=document.querySelector('.grid');
  var countEl=document.getElementById('ctrl-count');
  var controls=document.querySelector('.controls');
  var currentSort=(controls&&controls.dataset.initialSort)||'relevance';
  var currentSearch='';
  sortBtns.forEach(function(b){b.classList.toggle('active',b.dataset.sort===currentSort);});

  function update(){
    var q=currentSearch.toLowerCase();
    var visible=cards.filter(function(c){
      var title=c.dataset.title;
      var desc=c.dataset.desc||'';
      var matchPos=!q||title.indexOf(q)!==-1;
      var matchAnti=!excludeTerms.some(function(t){return title.indexOf(t)!==-1||desc.indexOf(t)!==-1;});
      var match=matchPos&&matchAnti;
      c.classList.toggle('hidden',!match);
      return match;
    });
    visible.sort(function(a,b){
      switch(currentSort){
        case 'price-asc': return parseFloat(a.dataset.price)-parseFloat(b.dataset.price);
        case 'price-desc': return parseFloat(b.dataset.price)-parseFloat(a.dataset.price);
        case 'rating': return parseFloat(b.dataset.rating)-parseFloat(a.dataset.rating);
        case 'discount': return parseFloat(b.dataset.discount)-parseFloat(a.dataset.discount);
        default: return parseInt(a.dataset.index)-parseInt(b.dataset.index);
      }
    });
    visible.forEach(function(c){grid.appendChild(c);});
    var noMatch=document.getElementById('no-match');
    if(visible.length===0){
      if(!noMatch){var p=document.createElement('p');p.id='no-match';p.className='no-match';p.textContent='Nenhum an\xFAncio encontrado para "'+currentSearch+'"';grid.appendChild(p);}
    }else if(noMatch){noMatch.remove();}
    if(countEl){countEl.textContent=visible.length+' an\xFAncio'+(visible.length===1?'':'s');}
  }

  var searchTimer;
  if(searchInput){
    searchInput.addEventListener('input',function(){
      clearTimeout(searchTimer);
      searchTimer=setTimeout(function(){currentSearch=searchInput.value;update();},180);
    });
  }
  var antiInput=document.getElementById('anti-input');
  var antiChipsEl=document.getElementById('anti-chips');
  var excludeTerms=[];
  function renderChips(){
    antiChipsEl.innerHTML='';
    excludeTerms.forEach(function(term,i){
      var chip=document.createElement('span');chip.className='anti-chip';
      var lbl=document.createTextNode(term);
      var btn=document.createElement('button');btn.setAttribute('aria-label','Remover '+term);btn.innerHTML='&#215;';
      btn.addEventListener('click',function(){excludeTerms.splice(i,1);renderChips();update();});
      chip.appendChild(lbl);chip.appendChild(btn);antiChipsEl.appendChild(chip);
    });
  }
  if(antiInput){
    antiInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){
        var term=antiInput.value.trim().toLowerCase();
        if(term&&excludeTerms.indexOf(term)===-1){excludeTerms.push(term);renderChips();update();}
        antiInput.value='';
      }
    });
  }
  sortBtns.forEach(function(btn){
    btn.addEventListener('click',function(){
      currentSort=btn.dataset.sort;
      sortBtns.forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      update();
    });
  });
  if(countEl){countEl.textContent=cards.length+' an\xFAncio'+(cards.length===1?'':'s');}
  document.querySelectorAll('.gallery-strip').forEach(function(strip){
    strip.querySelectorAll('.gal-btn').forEach(function(gbtn){
      gbtn.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        var zone=strip.closest('.img-zone');
        var mainImg=zone&&zone.querySelector('.main-img');
        var ph=zone&&zone.querySelector('.thumb-ph');
        if(mainImg){mainImg.src=gbtn.dataset.src;mainImg.style.display='';}
        if(ph){ph.style.display='none';}
        strip.querySelectorAll('.gal-btn').forEach(function(b){b.classList.remove('active');});
        gbtn.classList.add('active');
      });
    });
  });

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (a && (a.classList.contains('img-a') || a.classList.contains('title-a') || a.classList.contains('btn-cta'))) {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var ev = new MouseEvent('click', {
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true
        });
        a.dispatchEvent(ev);
      }
    }
  });
})();`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ml-search \xB7 ${esc(query.text)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<header>
  <div class="h-left">
    <span class="logo">ml-search<em>.cli</em></span>
    <div class="h-info">
      <span class="h-query">${esc(query.text)}</span>
      <span class="h-meta">${total} resultado${pagination.total === 1 ? "" : "s"} \xB7 ${now}</span>
    </div>
  </div>
  <button id="theme-btn" class="theme-btn" aria-label="Toggle dark mode"></button>
</header>
<div class="controls" data-initial-sort="${initialSort}">
  <div class="ctrl-search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="search-input" type="search" placeholder="Filtrar an\xFAncios&hellip;" autocomplete="off" aria-label="Filtrar an\xFAncios">
  </div>
  <div class="ctrl-sort">
    <span class="sort-label">Ordenar:</span>
    <button class="sort-btn" data-sort="relevance">Relev\xE2ncia</button>
    <button class="sort-btn" data-sort="price-asc">Menor Pre\xE7o</button>
    <button class="sort-btn" data-sort="price-desc">Maior Pre\xE7o</button>
    <button class="sort-btn" data-sort="rating">Maior Avalia\xE7\xE3o</button>
    <button class="sort-btn" data-sort="discount">Maior Desconto</button>
  </div>
  <div class="ctrl-anti">
    <span class="anti-label">Excluir:</span>
    <div class="anti-input-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <input id="anti-input" type="text" placeholder="Excluir palavra&hellip;" autocomplete="off" aria-label="Excluir por palavra-chave">
    </div>
    <div class="anti-chips" id="anti-chips"></div>
  </div>
  <span class="ctrl-count" id="ctrl-count"></span>
</div>
<main>
  <div class="grid">
${cardsHtml}
  </div>
</main>
<footer>Gerado por <strong>ml-search-cli</strong> &middot; Dados do <a href="https://www.mercadolivre.com.br" target="_blank" rel="noopener noreferrer">Mercado Livre</a></footer>
<script>${js}</script>
</body>
</html>`;
}

/**
 * Generates an HTML page for the search results and opens it in the default system browser.
 *
 * @param {object} result - The full search result from {@link search}.
 * @param {object[]} items - The (possibly field-filtered) items to render.
 * @returns {Promise<void>}
 */
async function openInBrowser(result, items) {
  const { writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { exec } = await import("node:child_process");
  const { join } = await import("node:path");

  const html = generateHtml(result, items);
  const file = join(tmpdir(), `ml-search-${Date.now()}.html`);
  writeFileSync(file, html, "utf8");

  const cmd = process.platform === "win32" ? `start "" "${file}"` : process.platform === "darwin" ? `open "${file}"` : `xdg-open "${file}"`;
  exec(cmd);
  process.stderr.write(`Opened in browser: ${file}\n`);
}

/**
 * Prints a red-coloured error message to stderr and terminates the process.
 *
 * @param {string} msg - Human-readable error description.
 * @returns {never}
 */
function error(msg) {
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
  process.exit(1);
}
