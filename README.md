# Order Lifecycle — Demo UI

A React + Vite demo UI for the [Order Lifecycle API](https://api.oliverhatherton.com/order-lifecycle/docs):
JWT auth with rotating httpOnly refresh tokens, orders that move through an async
`PENDING → RESERVED → PAID → COMPLETED` fulfilment pipeline over RabbitMQ, admin
user management, and a public live-metrics dashboard reading the backend's
Prometheus `/metrics` endpoint.

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
| `/orders` | authenticated | Place orders, watch fulfilment status poll to completion |
| `/admin` | ADMIN role | Enable/disable user accounts |
| `/metrics` | public | Live dashboard over the backend's Prometheus scrape endpoint |

## Auth model

The access token is kept in memory only (a module singleton in
[`src/lib/api.js`](src/lib/api.js)) — never `localStorage`. The refresh token is
an httpOnly cookie the browser manages automatically; every API call sends
`credentials: 'include'`. A `401` triggers one shared, de-duplicated
refresh-and-retry (see `apiRequest` in `src/lib/api.js`); a second `401` drops
the session.

## Metrics dashboard

[`src/routes/Metrics.jsx`](src/routes/Metrics.jsx) polls the backend's raw
`/metrics` text output every 5s. [`src/lib/prometheus.js`](src/lib/prometheus.js)
is a small generic Prometheus exposition-format parser (no query API is
exposed by the backend, so rates like requests/sec are computed client-side by
diffing two successive scrapes). Panels for metrics the backend hasn't emitted
yet (or doesn't expose at all — e.g. RabbitMQ queue/DLQ depth, which lives in
the broker's own management API, not this app) show an honest empty state
instead of a fabricated number. A raw-text explorer at the bottom of the page
covers anything not surfaced as a dedicated panel.

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
