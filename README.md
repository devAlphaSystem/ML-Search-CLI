# ml-search-cli

Command line and library tool to extract structured search results from Mercado Livre (MLB).

## Highlights

- Node.js CLI command: `ml-search`
- Programmatic API: `search`, `searchRaw`, `getCategories`
- Output formats: `json`, `table`, `jsonl`, `csv`
- Advanced filters: condition, category, state, strict, sorting
- Multi-state mode with merge and deduplication

## Requirements

- Node.js `>=18`
- Network access to `lista.mercadolivre.com.br`

## Installation

This package is intended for local use and is not published to npm.

### Link CLI globally from local source

```bash
npm install
npm link
```

Run:

```bash
ml-search --help
```

### Link package into another local project

```bash
npm link ml-search-cli
```

### Unlink when needed

```bash
npm unlink -g ml-search-cli
```

## Quick Start

```bash
ml-search "bateria samsung galaxy s22"
ml-search "notebook dell" -l 5 -c used -f table
ml-search "iphone 15" --state sp --sort price_asc
ml-search --list-categories
```

## CLI Usage

```text
ml-search <query> [options]
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `query` | Yes | Search terms. |

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `-l, --limit <n>` | integer | `20` | Maximum number of results returned. |
| `-c, --condition <type>` | string | none | Item condition: `new` or `used`. |
| `--sort <order>` | string | `relevance` | Sort order: `price_asc`, `price_desc`, `relevance`. |
| `--category <id_or_slug>` | string | none | Category by ID (ex: `MLB1648`) or slug/path (ex: `informatica`). |
| `--list-categories` | flag | `false` | Print supported categories and exit. |
| `--timeout <ms>` | integer | `15000` | HTTP timeout per request. |
| `--concurrency <n>` | integer | `5` | Parallel detail requests. |
| `--state <uf[,uf...]>` | string | none | One or many UFs (MLB), ex: `sp` or `sp,rj,mg`. |
| `--strict` | flag | `false` | Keep only items matching all query tokens in title/description/attributes. |
| `--no-rate-limit` | flag | `false` | Disable built-in rate limiting (may get your IP blocked). |
| `-f, --format <type>` | string | `json` | `json`, `table`, `jsonl`, `csv`. |
| `--pretty` | flag | `false` | Pretty print JSON output. |
| `--raw` | flag | `false` | Return raw `initialState` and exit. |
| `--fields <list>` | csv string | none | Keep selected fields only. |
| `-w, --web` | flag | `false` | Render HTML results and open browser. |
| `--log` | flag | `false` | Write a timestamped `.log` file to the project root with HTTP, search, and detail-enrichment traces. |
| `-h, --help` | flag | `false` | Show help. |
| `-v, --version` | flag | `false` | Show package version. |

## Rate Limiting

Built-in rate limiting is **enabled by default** to prevent your IP from being blocked by Mercado Livre.

- **Page delay:** 200 ms between pagination requests
- **Detail delay:** 100 ms between detail-enrichment batches
- **Max concurrency:** 3 parallel detail requests (overrides `--concurrency` when lower)

To disable rate limiting (at your own risk):

```bash
ml-search "notebook" --no-rate-limit
```

## Important Rule

`--condition` and `--category` cannot be used together. The library throws an explicit error when both are provided.

## Logging

Pass `--log` to write a timestamped log file (`ml-search_YYYY-MM-DD_HH-MM-SS.log`) to the project root.
The file records every HTTP request/response (URL, status code, content-type, body size), the constructed search URL, per-page parse counts, pagination progress, per-item detail-enrichment results, and the final summary.
No file is created when `--log` is omitted.

```bash
ml-search "iphone 15" --log
```

## Output Formats

- `json`: full result object (`items`, `query`, `pagination`)
- `table`: readable, colorized terminal cards
- `jsonl`: one JSON object per line
- `csv`: comma-separated output based on item keys

## Common Examples

```bash
# Basic
ml-search "iphone 15"

# Used products only
ml-search "notebook dell" --condition used -f table

# Category by ID
ml-search "celular" --category MLB1648 --sort price_asc

# Category by slug/path
ml-search "notebook" --category informatica -f table

# Multi-state search
ml-search "moto g" --state sp,rj,mg --sort price_asc

# Strict matching
ml-search "samsung s20" --strict -l 20 -f table

# CSV export
ml-search "tela lcd" --fields title,price,permalink --format csv > ml-results.csv

# Raw state payload
ml-search "webcam" --raw > raw-initial-state.json
```

## Library Usage

```js
import { search, searchRaw, getCategories } from "ml-search-cli";

const result = await search("notebook dell", {
  limit: 20,
  condition: "used",
  sort: "price_asc",
  state: "sp,rj",
  timeout: 15000,
  concurrency: 5,
  strict: false,
});

console.log(result.items[0]);

const raw = await searchRaw("notebook dell", {
  state: "sp",
  sort: "price_asc",
});

console.log(raw.pagination);
console.log(getCategories().slice(0, 5));
```

### API Reference

#### `search(query, options?)`

Returns:

- `items: object[]`
- `query: { text, condition, sort, state, states, category, strict, url }`
- `pagination: { total, offset, limit, resultsLimit, capped }`

Main options:

- `limit?: number`
- `condition?: "new" | "used"`
- `timeout?: number`
- `sort?: "price_asc" | "price_desc" | "relevance"`
- `concurrency?: number`
- `state?: string` (single or comma-separated UFs)
- `category?: string` (ID or path slug)
- `strict?: boolean`
- `noRateLimit?: boolean`

#### `searchRaw(query, options?)`

Returns raw Mercado Livre `initialState` payload.

#### `getCategories()`

Returns array of `{ id, path, name }`.

## Item Schema (normalized)

Each item can include:

- `id`
- `title`
- `price`
- `currency`
- `originalPrice`
- `discountPercent`
- `installments`
- `freeShipping`
- `shipping`
- `seller`
- `bestSeller`
- `highlight`
- `promotions`
- `thumbnail`
- `permalink`
- `categoryId`
- `isAd`
- `rating`
- `pictures`
- `description`
- `attributes`

Notes:

- Ad results are filtered out.
- `pictures`, `description`, `rating`, and `attributes` are enriched from detail pages.
- Nullable fields are expected when source data is unavailable.

## Validation and Errors

The CLI validates:

- `--limit`, `--timeout`, `--concurrency` as positive integers
- allowed output format values
- valid UF codes for `--state`
- valid category ID/path
- condition/category conflict

Common runtime issues:

- extraction errors if frontend markup changes
- temporary anti-bot/rate limiting responses
- network timeout failures

## Performance Notes

- Multi-state mode performs one search per UF and then merges/deduplicates.
- High `--concurrency` can improve speed but increase blocking risk.
- `pagination.resultsLimit` indicates marketplace browse cap for some searches.

## Development

```bash
npm install
npm run format
```

## License

MIT
