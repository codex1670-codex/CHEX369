# CHEX / Nexa — Architecture & Migration Roadmap

## Target stack and current status

| Layer | Target | Status |
|---|---|---|
| Frontend | React + TypeScript | **Foundation done.** `strict` TS, `allowJs`. Migrated: `main`, `theme`, `socket`, `AuthContext`, `types`, `motion/*`, `ui/*`, `three/*`. ~100 `.jsx` files remain. |
| Styling | Tailwind CSS | **Installed** (`tw-` prefix, no preflight → no clash with legacy CSS). Used by `ui/Skeleton`. Legacy CSS migrates screen by screen. |
| Animation | Framer Motion | **Done for navigation** (`PageTransition`, shared variants in `motion/variants.ts`). Sheets/lists/reactions next. |
| 3D | Three.js | **Started** (`three/Globe3D` — spinning, draggable 3D Earth on the sign-in screen, generated land map, lazy-loaded, WebGL-safe). `Emoji3D`/`ui3d.js` still custom. |
| Backend | Node + TypeScript | **Foundation done.** Runs under `tsx`, `tsc --noEmit` clean. Migrated: `middleware/auth`, `presence`, `content`, `contentHash`, `accountService`, `config`, `cache`, `realtime`, `postgres`, `aiClient`. Routes + `db.js` remain JS. |
| AI | Python + FastAPI | **Service built** (`ai-service/`: chat, translate, moderate, token auth, 7 tests). Node ↔ AI via typed `aiClient.ts`. `nlu.js` / `uiAgent.js` not yet moved. |
| Database | MongoDB + PostgreSQL | MongoDB: existing persistence. PostgreSQL: **connected + health-checked, no tables moved yet** (see Phase 2). |
| Cache | Redis / Valkey | **Done**: `cache.ts` (Redis or in-memory fallback). Not yet used by feed/search routes. |
| Real-time | WebSockets + WebRTC | Socket.IO + WebRTC existing; **Redis adapter added** so multiple instances share rooms. Presence map is still per-instance. |
| Android | Kotlin | Not started. |
| Deployment | Docker + Render | **Done**: 5-service `docker-compose.yml`, multi-service `render.yaml`. |
| Version control | Git + GitHub | **Done**: repo + CI (`.github/workflows/ci.yml`). |

## Why the migration is incremental
Vite resolves `.js`/`.jsx` imports to the migrated `.ts`/`.tsx` file (see `vite.config.ts`), and the backend
runs `.js` and `.ts` side by side through `tsx`. Any file can be converted on its own and the whole test
suite keeps passing at every step.

## Next phases
1. **Backend → PostgreSQL.** `db.js` is synchronous `better-sqlite3` used from every route; moving to `pg`
   is an async rewrite. Do it domain by domain (auth/users → messages → coins), behind a repository layer.
2. **Cache real traffic**: feed, search, profile, unread counts via `cache.wrap`; presence in Redis.
3. **Move NLU/UI-agent into FastAPI**, keep the Node routes as thin proxies.
4. **Convert the remaining `.jsx` → `.tsx`** (start with `api.js` — it is the biggest typing win — then pages).
5. **Tailwind + Framer Motion on Feed, Messages, Profile**; replace `Emoji3D` with Three.js.
6. **Internationalisation** (react-i18next, RTL support, locale-aware dates/numbers) — required for "worldwide".
7. **Kotlin Android app** against the same API/WebSocket contract (extract an OpenAPI spec first).
