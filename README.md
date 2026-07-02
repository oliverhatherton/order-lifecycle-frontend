# Order Lifecycle — Demo UI

A React + Vite demo UI for the [Order Lifecycle API](https://api.oliverhatherton.com/order-lifecycle/docs):
JWT auth with rotating httpOnly refresh tokens, a real product catalog and cart
that's the only way to create an order, orders that move through an async
`PENDING → RESERVED → PAID → COMPLETED` fulfilment pipeline over RabbitMQ (with
a genuine manual pause at `RESERVED` until the user clicks **Pay**, cancellable
any time before that), admin user management, and a metrics dashboard combining
the backend's live Prometheus `/metrics` scrape with its durable, Postgres-backed
`/metrics/history`.

## Stack

React 19 · React Router 7 (`HashRouter`) · Vite · plain CSS (no framework).

## Running locally

```bash
cp .env.example .env   # defaults to the deployed backend; edit for local dev
npm install
npm run dev
```

`VITE_API_BASE_URL` should point at a running instance of the backend with **no**
trailing slash and no route prefix (e.g. `https://api.oliverhatherton.com/order-lifecycle`
or `http://localhost:3000` for local dev).

## Routes

| Path | Access | Notes |
| --- | --- | --- |
| `/` | public | Landing page |
| `/login`, `/register` | public | Auth forms |
| `/shop` | authenticated (login prompt inline otherwise) | Browse products, manage cart, checkout to create an order |
| `/orders` | authenticated (login prompt inline otherwise) | Watch orders reserve, **Pay** or **Cancel**, through to completion |
| `/admin` | ADMIN role | Enable/disable user accounts |
| `/metrics` | public | Live dashboard over the backend's Prometheus scrape endpoint |

`/shop` and `/orders` are always in the nav (not hidden for logged-out
visitors); visiting either without a session shows an inline login prompt in
place of the page content rather than a redirect.

## Auth model

The access token is kept in memory only (a module singleton in
[`src/lib/api.js`](src/lib/api.js)) — never `localStorage`. The refresh token is
an httpOnly cookie the browser manages automatically; every API call sends
`credentials: 'include'`. A `401` triggers one shared, de-duplicated
refresh-and-retry (see `apiRequest` in `src/lib/api.js`); a second `401` drops
the session.

**Session persistence across a reload** works the same way: on mount,
[`AuthContext.jsx`](src/lib/AuthContext.jsx) silently calls `POST /auth/refresh`
(the httpOnly cookie rides along) and, if that succeeds, `GET /auth/me` — so a
valid session survives a full page reload without ever touching
`localStorage`. If that check fails with a real `401`, the user is genuinely
logged out. If it fails at the network/CORS level instead (the two look
identical from the user's side — a reload that silently drops the session),
`sessionCheckError` is set and the nav bar shows a distinct "couldn't verify
your session — this looks like a network or CORS issue" banner with a Retry
button, rather than presenting it as an expired login. In practice this fires
whenever the current origin isn't in the backend's `CORS_ORIGIN` allowlist
(e.g. running the UI against the deployed API from `localhost`, or a
mismatch after the GitHub Pages custom-domain reset).

## Shop, cart & checkout

[`src/routes/Shop.jsx`](src/routes/Shop.jsx) is the only way to create an
order — `POST /orders` doesn't exist anymore. Each product tile's quantity
stepper always shows (and sets, not adds to) the cart's actual quantity for
that product, matching `POST /cart/items`' upsert semantics; a stepper hits
`DELETE /cart/items/:productId` when it reaches zero. **Checkout**
(`POST /cart/checkout`) is one-shot — a `409` (double-click, or a stale tab)
just re-fetches the cart, which is lazily recreated empty, rather than
erroring. Stock is real: a product's `stock` bounds the stepper client-side,
and the server enforces it too — a line that's gone short by the time
inventory reserves fails the order (`FAILED`) exactly like a declined payment,
with no separate signal to tell them apart.

## Order lifecycle: Pay and Cancel

[`src/routes/Orders.jsx`](src/routes/Orders.jsx) polls `GET /orders/:id` for
any order the server is actively progressing — but an order sitting in
`RESERVED` with no `paymentInitiatedAt` is a genuine pause, not a transient
state, so polling stops there and a **Pay** button appears instead. Clicking
it calls `POST /orders/:id/pay`, which resumes the async chain (payment →
completion); polling picks the order back up automatically once
`paymentInitiatedAt` is set. A **Cancel** button is available any time before
that point (`PENDING`, or `RESERVED` with no payment initiated yet) and calls
`POST /orders/:id/cancel`, restoring stock server-side. Both endpoints are
idempotent (atomic claims in Postgres), so a `409` from a double-click, a
stale button, or a too-late cancel just triggers a re-fetch of the order's
real state rather than an error. `CANCELLED` joins `COMPLETED`/`FAILED` as a
terminal status.

## Metrics dashboard

[`src/routes/Metrics.jsx`](src/routes/Metrics.jsx) combines two sources:

- **Live scrape** — polls the backend's raw `/metrics` text output every 5s.
  [`src/lib/prometheus.js`](src/lib/prometheus.js) is a small generic
  Prometheus exposition-format parser (rates like requests/sec are computed
  client-side by diffing two successive scrapes). This resets on a backend
  restart, and the trend charts here only cover whatever window this browser
  tab has been open for.
- **Durable history** — [`src/lib/useMetricHistory.js`](src/lib/useMetricHistory.js)
  polls `GET /metrics/history` (Postgres-backed, resolution-bucketed,
  survives restarts) every 30s for authenticated users, charting orders/day
  and HTTP latency/hour. No `from` is passed, so each request returns the
  full history recorded since the server started (not a fixed lookback
  window), capped server-side at the most recent 500 buckets per resolution.
  Unauthenticated visitors see a prompt to log in instead, since that
  endpoint requires auth.

Panels for metrics the backend hasn't emitted yet (or doesn't expose at all —
e.g. RabbitMQ queue/DLQ depth, which lives in the broker's own management API,
not this app) show an honest empty state instead of a fabricated number. A
raw-text explorer at the bottom of the page covers anything not surfaced as a
dedicated panel.

The dashboard is organized into five tabs: System Overview, API, Order
Processing, Messaging, and **Spike Correlation**.

### Spike Correlation

Overlays request volume, latency, event loop lag and CPU on one timeline
(recharts `ComposedChart`, bars on the left axis for requests/bucket, lines on
the right for ms/%) so a spike in one series can be visually correlated
against the others, plus a heap-used trend below. All backed by durable
`/metrics/history`, with a bucket-resolution selector (`1m`/`5m`/`15m`/`1h` —
wider resolutions trade granularity for a longer span, per the 500-bucket
cap). [`src/lib/metricsCorrelation.js`](src/lib/metricsCorrelation.js) joins
the five underlying series (`http_request_duration_ms` doubles as both the
traffic and latency series) into one row per bucket, and — this is the part
worth understanding before changing it — applies two *different* fill
strategies:

- **Traffic** (request count): a missing bucket means zero requests, which is
  real data, so it's zero-filled.
- **Gauges** (lag, CPU, heap): a missing bucket means the server was down for
  that window, so it's left as `null` and rendered as a genuine gap
  (`connectNulls={false}` throughout) rather than interpolated — durable
  history means downtime visualization comes for free, as long as nothing
  papers over the gap.

The master bucket timeline is the union of the gauge series (recorded on a
timer regardless of traffic), not the traffic series — otherwise a bucket with
zero requests but a live server would be indistinguishable from real
downtime.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds on every
push to `main` and publishes `dist/` to the `prod` branch
([peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages)).
One-time setup:

1. Push this repo to GitHub with `main` as the default branch.
2. Let the workflow run once so the `prod` branch exists.
3. **Settings → Pages → Source: Deploy from a branch → Branch: `prod` / `(root)`**.

The build uses `base: './'` (relative asset paths) and `HashRouter`
(`/#/orders`, `/#/metrics`, …), so the same build artifact works unmodified
whether Pages serves it from `https://<user>.github.io/<repo>/` or a custom
domain — no per-deploy config.

If the UI ends up on a different origin than the API, the **backend** needs
`CORS_ORIGIN` and `COOKIE_SAMESITE=none` set (see the backend's integration
guide, §5) — no frontend changes required either way.
