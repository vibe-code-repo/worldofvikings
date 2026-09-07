# ADR-0052: Validators, not lifetimes — a second editor open transfers nothing

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** editor, API and deployment owners

## Context

Opening the village world in the editor on staging took 72 seconds and moved
about 154 MB: 158 files out of the private asset store (models, their external
textures, an 8 MB height field), a 1.0 MB world from the API, the merged prefab
catalogue and, once the Zone tab is opened, an 886 kB manifest. Closing the tab
and opening it again moved the same 154 MB. So did a reload. So did every zone
switch that re-instantiates.

Every one of those files was answered with

```http
cache-control: no-cache
```

and **no `ETag`, no `Last-Modified`**. That combination cannot work.
`no-cache` does not mean "do not store", it means "revalidate before using
this" — and with no validator to revalidate _against_, the only revalidation a
browser can perform is downloading the bytes again. The header was doing the
opposite of what it was written for.

The API was no better in a subtler way: `GET /worlds/:id` sent

```http
last-modified: 2026-09-07T17:34:58.451Z
```

which is an ISO 8601 string, not an HTTP-date. Browsers do not reject that,
they ignore it. The header was present in every response dump and had no effect
whatsoever, and there was no `ETag` beside it and no conditional handling in
the route.

The constraint that shaped everything below: **the store is re-imported during
development.** An importer writes byte-identical files when nothing changed and
new bytes under the _same path_ when a texture was swapped, and an author
looking at staging right after a deploy must see the new texture on reload.
That is why `no-cache` was chosen in the first place, and the intention was
right. Only the implementation made it impossible to honour cheaply.

## Decision

**Every answer keeps being asked about; an answer that has not changed comes
back empty.**

- The asset server (`tooling/scripts/asset-server.ts`) sends a weak `ETag` and
  a real `Last-Modified` HTTP-date on every file, and answers `304` with no
  body to `If-None-Match` / `If-Modified-Since`, for `GET` and `HEAD`.
  `Cache-Control` becomes `public, max-age=0, must-revalidate` — which is
  `no-cache` said in full, and keeps the stale-picture guarantee exactly as it
  was. `ASSET_CACHE_MAX_AGE` (seconds, default `0`) exists for a deployment
  that knowingly wants a lifetime.
- `services/api` does the same for `GET /worlds/:id` and
  `GET /prefabs/:catalog` (validators from the file's size and modification
  time) and for `GET /worlds` and `GET /prefabs` (validators from a hash of
  the composed body, which is the only thing that is true about an aggregate).
  `updatedAt` stays an ISO string **in the body and in the listing**: that is
  what the client reads, and it is not a header.
- **Nothing is `immutable` and nothing gets a lifetime by default.** The only
  files in this system that would deserve `immutable` are the hashed
  `/assets/*` bundles the apps build, and those are served by `vite preview`,
  which cannot set a header per path (see below).
- The comparison lives once, in `@wov/shared` (`http-cache.ts`), because the
  asset server and the API both need it and a validator implemented twice is a
  validator that drifts.

### Why the ETag is weak, and why size plus mtime is enough here

The tag is `W/"<size>-<mtime>"` (with a schema-version prefix and the content
id on the API's, below: size and mtime describe _a_ file, not _which_ file, and
two worlds written in the same millisecond with names of the same length would
otherwise share a tag). It is **weak** because size and mtime do not prove the bytes — a strong
tag would be a promise this server cannot keep. Weak costs nothing:
RFC 9110 §13.1.2 requires `If-None-Match` to be compared with the _weak_
function, so a weak tag revalidates exactly like a strong one, and it survives a
reverse proxy that compresses on the fly and downgrades strong tags to weak.
The comparison therefore ignores the `W/` prefix on both sides; comparing the
strings would have made every request through a gzipping proxy a full body.

Size plus mtime is sufficient **because of how these files are produced**: the
importers and `writeJsonFileAtomically` build a new file and rename it over the
old one. Nothing in this project edits bytes inside an existing file, so "same
size, same mtime" and "same content" do not come apart. That is a statement
about this pipeline, not a general truth — a store somebody patched in place
would need a content hash.

`If-None-Match` decides alone whenever it is present. `Last-Modified` has
one-second resolution, so a file rewritten within the same second as the copy a
client holds would otherwise be declared unchanged — which is precisely the
stale picture this whole change has to keep impossible.

The API folds `CURRENT_WORLD_SCHEMA_VERSION` into its tags because it does not
serve the file, it serves a representation it builds from the parsed file: a
service that starts shaping that JSON differently has to invalidate caches whose
only other input is a modification time the file never changed.

### What the reverse proxy still has to do

The API answers 1.0 MB of JSON uncompressed. Measured over localhost, the
village world is 1,007,111 bytes and gzips to 144,214 (`gzip -6`, 14.3 %); the
merged prefab catalogue is 197,508 bytes and gzips to 22,852 (11.6 %). Nginx
Proxy Manager already compresses the editor's JavaScript bundle
(1.88 MB → 476 kB) and does not compress `application/json`; adding that content
type in front of `api.staging` saves about 1.04 MB on a **first** open and costs
nothing on any later one, which are all empty 304s after this change.

That is a proxy change, not a code change, and `@fastify/compress` is
deliberately **not** added: it would put a dependency and a per-response
compression pass in the service to solve a problem the layer above it already
solves for every other content type.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A long `max-age` on store files                           | The store is re-imported under the same paths. A lifetime is a promise that the bytes behind a URL will not change, and this project breaks that promise on purpose, several times a day.                                             |
| A content hash in the asset URL (`?v=…` or a hashed name) | Would make a lifetime honest, but the URL is written into world files, the prefab catalogue and the manifest. Cache-busting would become a data migration. Worth revisiting when the asset pipeline rewrites paths anyway (Phase 5).  |
| A strong ETag from the file's bytes                       | Requires reading and hashing every file on every request, including the 8 MB height field, to answer a question the file system already answered. It would also be downgraded to weak by the first gzipping proxy in front of it.     |
| `@fastify/etag`                                           | Hashes the serialised body of every response — 1.0 MB on `GET /worlds/:id`, plus the writes and the error bodies — to produce a validator the file's `stat` already provides. Forty lines and no dependency do it better (AGENTS §7). |
| `@fastify/compress`                                       | See above: the reverse proxy already compresses, and after this change the bytes it would compress are sent once rather than on every open.                                                                                           |
| Babylon's IndexedDB offline provider                      | A second cache with its own invalidation rules, next to the one every browser already has, and one that a swapped texture would survive. Explicitly out of scope.                                                                     |
| `Cache-Control: no-cache` kept verbatim                   | Identical in effect to `max-age=0, must-revalidate`, but the shorter spelling is what invited the original mistake — it reads like "do not cache". The long form says what is meant.                                                  |

## What could not be done: per-path headers in `vite preview`

The hashed `/assets/*` files the three apps build **are** immutable — a
different build produces a different name — and `index.html` must stay
revalidated. Vite 7 cannot express that. `preview.headers` is applied by a
`setHeaders(res)` callback that is handed no path
(`vite/dist/node/chunks/config.js`, the preview server's sirv middleware), so
the option is all-or-nothing.

Measured on `vite preview` 7.3.6 as it stands, which is better than the current
comment in `staging-serve.sh` claimed: `index.html` gets `Cache-Control:
no-cache` with a weak ETag, hashed assets get `no-cache` plus an ETag **and** a
`Last-Modified`, and both answer `304`. The warm pass below confirms it: 42
requests to the preview server, 42 × 304, 11 answered by the browser itself,
0.01 MB. That is already the right behaviour; `immutable` would only save the
round trips.

Getting `immutable` on `/assets/*` needs a `configurePreviewServer` plugin or a
static server of our own. Neither is worth writing for round trips that cost
about 800 bytes each, and the honest place to set it is the reverse proxy, which
already sits in front of those paths. Left undone, on purpose.

## Consequences

Measured with `pnpm perf:cache` (`tooling/perf/cache-profile.ts`) — built
bundles, the private store mounted, a throwaway `CONTENT_DIR`, one Chromium with
a profile on disk, village1 opened through the File menu and waited on until
`loadedCount === entityCount` (5273/5273), then the page reloaded in the same
profile and opened again:

| pass     | before                                          | after                                            |
| -------- | ----------------------------------------------- | ------------------------------------------------ |
| **cold** | 384 requests · **154.02 MB** · 372×200 · 0×304  | 384 requests · **56.90 MB** · 224×200 · 148×304  |
| **warm** | 384 requests · **153.44 MB** · 320×200 · 52×304 | 384 requests · **0.09 MB** · 0×200 · **372×304** |

Per origin on the warm pass, after: asset server 317 requests / 0.08 MB /
317×304, API 3 requests / 0.00 MB / 3×304, preview server 53 requests /
0.01 MB / 42×304 (11 answered by the browser without asking).

**Positive** — a second open of the editor transfers 0.09 MB instead of
153.44 MB, and every one of the 372 requests is answered by the file that is
actually on disk right now, so a swapped texture still appears on reload.

The **cold** open more than halved as well, which was not the goal and is the
more interesting number: 148 of the 317 asset requests in a _single_ open are
repeats — the same texture referenced by several models. With no validator each
repeat was a full download; with one they are 304s. That is 97 MB saved on a
first visit, before any caching between visits happens at all.

**Negative** — a warm open makes the same 384 round trips it always did, and on
this machine takes the same time (cold 85.6 s → 90.6 s and 61.0 s across two
runs; warm 76.3 s → 84.4 s and 66.2 s — the spread between two runs of the same
build is larger than the difference, and over localhost the bytes were never the
bottleneck). The win is bandwidth and it will show as time on a real link, not
on loopback. The API's 304 still reads and parses the file it is not going to
send (about 30 ms for the village world against 43 ms for the full answer); the
validator is derived from `stat`, so short-circuiting before the read is
possible and was left out to keep the change reviewable.

**Follow-ups** — ask the proxy to compress `application/json` for
`api.staging`, and to set `immutable` on `/assets/*` for the three app hosts.
Both are outside this repository. If the asset pipeline ever rewrites store
paths (Phase 5), hashed asset names become possible and `ASSET_CACHE_MAX_AGE`
becomes something worth setting.

## Addendum (2026-09-07, after review)

- The API folds the content id into the tag (see above).
- `readJsonFile` takes bytes and stamp from one open file handle. Read as two
  calls on the path, a concurrent atomic write could pair the old body with the
  new file's validator; a client caching that pair would be told `304` for the
  old world until the next save. Measured with a tight read/write loop: 2 of
  5 000 reads mismatched before, 0 after.
