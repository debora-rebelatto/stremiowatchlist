# 🎬 Stremio Watchlist (Good Quality Tracker)

<div align="center">

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?style=for-the-badge&logo=github-sponsors)](https://github.com/sponsors/debora-rebelatto)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=for-the-badge)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing-emerald.svg?style=for-the-badge)](tests)
[![Stremio Addon](https://img.shields.io/badge/Stremio-Official%20Protocol-00d1b2?style=for-the-badge&logo=stremio)](https://web.stremio.com/)

**Automatically track when pending movies in your watchlist become available in confirmed good quality (1080p Full HD or 4K UHD).**

Works 24/7 across **Smart TV (Android TV, Fire TV, LG webOS, Samsung Tizen)**, **Mobile (iOS & Android)**, and **Desktop**.

[🌐 Web Dashboard](https://stremiowatchlist.vercel.app/) • [📦 Addon Manifest](https://stremiowatchlist.vercel.app/manifest.json) • [💖 Sponsor on GitHub](https://github.com/sponsors/debora-rebelatto)

</div>

---

## 🌟 Why Stremio Watchlist?

When browsing upcoming or recently released films in Stremio, movies often only have low-quality theater recordings (CAM / TS / Telesync).

**Stremio Watchlist** eliminates the need to constantly check if a real digital release is out:

1. You save movies to your watchlist via the web dashboard.
2. The tracker continuously inspects real torrent networks and streaming sources (via Torrentio & Cinemeta).
3. The moment a confirmed **1080p**, **4K UHD**, or **BluRay / WEB-DL** stream is detected, the movie instantly moves to your **🟢 Ready (Good Quality)** catalog inside your Stremio player!

---

## ✨ Key Features

- **⚡ 1-Click Stremio Install:** Authenticate your Stremio account on the web dashboard to install the addon directly to your profile across all connected devices—no manual link copying required.
- **🟢 Real-Time Quality Detection:** Identifies 4K UHD, 1080p FHD, 720p HD, and BluRay/WEB-DL releases while ignoring CAM and low-bitrate rips.
- **📺 Dedicated Stremio Catalogs:**
  - `🟢 Watchlist: Ready (Good Quality)` — Movies ready to stream right now in high quality.
  - `⏳ Watchlist: Waiting for Quality` — Upcoming and in-theater titles being actively tracked.
  - `📋 Watchlist: All Movies` — Complete collection of all tracked movies.
- **📱 Smart TV & Mobile QR Code:** Scan a QR code on your TV screen or mobile device to open the dashboard with instant authentication.
- **📁 Custom Lists & Curated Collections:** Organize movies into custom folders (e.g. _Horror Night_, _Sci-Fi Favorites_) or 1-click import curated lists (e.g. _Letterboxd 2026 Most Anticipated_).
- **🔄 Watched Movies Synchronization:** Automatically detect movies you already watched inside Stremio and keep your watchlist clutter-free.
- **🎯 Quality Target Preferences:** Configure whether your threshold is 1080p Full HD or 4K Ultra HD.
- **💾 Backup & Restore:** Export your entire watchlist as a portable JSON file and restore it anytime.
- **🔒 Privacy First:** Stremio auth tokens are encrypted end-to-end. Your password is never stored or visible to the server.

---

## 🚀 Getting Started

1. Open the [Web Dashboard](https://stremiowatchlist.vercel.app/).
2. Click **"🔐 Sign in with Stremio"** and authenticate your account.
3. Click **"✨ Install Addon (1-Click)"** to activate the addon on your Stremio profile.
4. Search for upcoming movies or import recommendations to start tracking!

---

## 💻 Tech Stack & Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS, Vite, Lucide Icons.
- **Backend Services:** Node.js, Express, TypeScript, Supabase (PostgreSQL).
- **Addon Integration:** Official Stremio Addon SDK protocol (`manifest.json`, `catalog`, `meta`).
- **Testing:** Jest + SWC, 40+ automated unit & integration test suites.

```
.
├── src/                          # React 19 Frontend Application
│   ├── components/               # Reusable UI Components & Modals
│   ├── controllers/              # Custom React hook controllers
│   ├── models/                   # Domain models & TypeScript interfaces
│   ├── services/                 # Client API services (watchlist, auth, system)
│   ├── utils/                    # Pure utilities, adapters, and HTTP client
│   └── views/                    # Presentational page views
├── server/                       # Backend Business Logic (Controllers, Services, Repositories)
│   ├── controllers/              # Thin Express HTTP route handlers
│   ├── repositories/             # Persistence layer adapters
│   ├── services/                 # Quality checker, addon routes, TMDB, auth, crypto
│   ├── types/                    # Shared server type definitions
│   └── utils/                    # Centralized envLoader & request context helpers
├── supabase/                     # Local Supabase stack config, migrations & synthetic seed
│   ├── config.toml               # Local Docker stack configuration (Postgres 17)
│   ├── migrations/               # SQL schema migrations synced with production
│   └── seed.sql                  # Deterministic, idempotent synthetic test data
├── tests/                        # Automated Test Suites (Jest)
└── server.js                     # Express HTTP server bootstrap
```

---

## 🛠️ Local Development

### Prerequisites

- **Node.js 20+** and **npm 9+**
- **Docker Desktop** _(recommended for local PostgreSQL + Supabase Studio persistence; optional if using `npm run dev:memory`)_

```bash
# Clone the repository
git clone https://github.com/debora-rebelatto/stremiowatchlist.git
cd stremiowatchlist

# Install dependencies
npm install

# Option A: Start local Docker Supabase test DB + run app (recommended)
npm run db:start
npm run dev

# Option B: Run locally in 100% in-memory mode without Docker
npm run dev:memory

# Run the full verification pipeline (typecheck + lint + test + build)
npm run verify
```

### Local Test Database (Docker + Supabase)

This repository includes an isolated local Supabase stack (**PostgreSQL 17**, **PostgREST** on `:54321`, and **Supabase Studio** on `:54323`) powered by Docker so you can develop and test schema, migrations, or data changes safely without ever touching production.

#### Step-by-Step Daily Workflow

1. **Start Docker Desktop** on your machine.
2. **Boot the local database and generate `.env.development.local`:**
   ```bash
   npm run db:start
   ```
   On the first run, Docker downloads the Supabase images, applies `supabase/migrations/`, loads the synthetic data from `supabase/seed.sql`, and automatically writes `.env.development.local` (gitignored) pointing to `http://127.0.0.1:54321` with PostHog disabled (`VITE_POSTHOG_KEY=`). If your `.env` has `TMDB_API_KEY` or `ADMIN_EMAIL`, they are preserved locally without exposing production database credentials.
3. **Start the application:**
   ```bash
   npm run dev
   ```
   Confirm the server startup banner prints:
   `👉 Database: 🟢 LOCAL DOCKER SUPABASE (127.0.0.1:54321) [env: development]`
   You can also check `GET http://localhost:7000/health` (`"dbTarget": "local-docker"`, `"supabase": true`).
4. **Inspect or edit test data visually** at **Supabase Studio**: `http://127.0.0.1:54323`.
5. **Stop the local containers when finished** (data persists across restarts):
   ```bash
   npm run db:stop
   ```

#### Database Commands Reference

| Command              | Description                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run db:start`   | Starts the local Supabase Docker stack, applies migrations + seed, and syncs `.env.development.local`.           |
| `npm run db:stop`    | Stops the local Supabase Docker containers without erasing data.                                                 |
| `npm run db:status`  | Displays local service URLs and status (`API_URL`, `DB_URL`, `STUDIO_URL`).                                      |
| `npm run db:env`     | Regenerates `.env.development.local` from the running local stack (preserving `TMDB_API_KEY` & `ADMIN_EMAIL`).   |
| `npm run db:reset`   | Destroys and recreates the local Docker DB from scratch, replaying all migrations and `supabase/seed.sql`.       |
| `npm run db:seed`    | Idempotently reapplies `supabase/seed.sql` into the running local Postgres container (`ON CONFLICT DO NOTHING`). |
| `npm run dev`        | Starts backend + Vite frontend (automatically uses `.env.development.local` when available).                     |
| `npm run dev:memory` | Starts backend + Vite in 100% in-memory mode (`DB_MODE=memory`), no Docker required.                             |
| `npm run verify`     | Runs client/server TypeScript check, ESLint, all Jest suites, and production build.                              |

#### Synthetic Seed Data Overview

`supabase/seed.sql` contains zero production data or real user PII and pre-populates:

- **3 synthetic test users:**
  - `test-admin@example.com` (`is_admin = true`, `min_quality = '1080p'`, `onboarding_completed = true`)
  - `test-4k-user@example.com` (`min_quality = '4k'`, `onboarding_completed = true`)
  - `test-new-user@example.com` (`onboarding_completed = false` — empty watchlist for testing first-login onboarding)
- **3 custom lists** (`Sci-Fi Night 🚀`, `Weekend Classics 🍿`, `4K Showcase 💎`)
- **7 movies** covering every UI state (`4K UHD` ready, `1080p FHD` ready, `CAM` pending, `Unreleased` with 0 streams, `Watched`, plus a `1080p` item under a `4k`-only threshold)
- **Sample `analytics_events` and `poll_votes`** so the `/admin` dashboard and roadmap poll charts render realistic local data.

> **Tip:** Signing in via the local dashboard (`http://localhost:5173`) with your Stremio account only creates/updates rows inside your local Docker PostgreSQL container. To wipe your local state and return to the clean seed anytime, run `npm run db:reset`.

#### Schema & Migration Workflow

1. Add a new timestamped SQL file in `supabase/migrations/` (and keep `supabase_schema.sql` in sync).
2. Test the migration from a clean slate locally:
   ```bash
   npm run db:reset
   ```
3. Verify the full test and build suite passes (`npm run verify`) before pushing or promoting schema changes to production.

**Built-in Production Safety Guard (Poka-Yoke):**

- `envLoader` automatically loads `.env.development.local` before `.env` in local development, and Jest tests skip reading `.env` files from disk.
- If `SUPABASE_URL` points to any non-local host (such as `*.supabase.co`) while running locally outside `production`, the server refuses to boot unless `ALLOW_REMOTE_DB_IN_DEV=true` is explicitly provided.
- `db:reset` and `db:seed` strictly target the local Docker stack and abort if `APP_ENV=production`, `NODE_ENV=production`, or cloud variables (`VERCEL`, `RENDER`) are detected.

### Vercel Environment Isolation (Production vs. Preview)

To prevent Vercel Preview deployments (PR branches) from reading or mutating production data:

1. In **Vercel Dashboard → Project → Settings → Environment Variables**, edit `SUPABASE_URL`, `SUPABASE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), `ENCRYPTION_KEY`, and `VITE_POSTHOG_KEY`:
   - Keep them scoped strictly to **Production** (uncheck **Preview** and **Development**).
2. Leave Preview deployments without production database credentials (so previews boot safely in `in-memory` mode), or assign separate credentials pointing to a dedicated staging Supabase project scoped only to **Preview**.
3. Check `GET /health` on any deployment to confirm `environment` and `dbTarget` (`"local-docker"`, `"supabase-cloud"`, or `"in-memory"`).

---

## 💖 Supporting & Sponsoring

This project is open-source and free for everyone. Background quality checks and database storage run continuously in the cloud.

If **Stremio Watchlist** saves you time and enhances your movie nights, consider sponsoring the project on GitHub:

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor%20me%20on-GitHub%20Sponsors-ea4aaa?style=for-the-badge&logo=github)](https://github.com/sponsors/debora-rebelatto)

### Sponsorship Goals

- ☁️ **Server & Supabase Hosting:** Keeps background checking tasks running 24/7 with zero rate limits.
- 🔔 **Automated Notifications:** Funding development for Discord, Telegram, and Email alerts when a movie is released in 1080p/4K.
- 📺 **TV Series & Shows Support:** Expanding tracker capabilities beyond movies to series episodes and seasons.

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
