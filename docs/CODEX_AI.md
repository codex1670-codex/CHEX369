# CODEX AI — one AI platform inside CHEX

CODEX is the orchestrator. You talk to one chat; CODEX picks the engine, streams the answer, previews media, remembers (only what you approve) and tells you plainly when a free limit is reached.

Open it from the ☰ menu → **CODEX AI**, the 🧠 button on the Codex bar, or the installed app's "CODEX AI" shortcut (`/?open=codexai`). Admins manage it under **Admin → 🧠 AI**.

## Architecture
| # | Engine | Provider | Used for | Code |
|---|---|---|---|---|
| 1 | **CODEX** (router/orchestrator) | CHEX backend | picks the engine, enforces limits | `backend/src/codexai/orchestrator.js`, `router.js` |
| 2 | **Text AI** | Groq | chat, reasoning, coding, explanations (streamed) | `providers/groq.js` |
| 3 | **Vision AI** | Groq | pictures, screenshots, documents (also powers Circle to Ask) | `providers/groq.js` |
| 4 | **Image AI** | Cloudflare Workers AI | text-to-image (`flux-1-schnell`) | `providers/cloudflare.js` |
| 5 | **Video AI** *(experimental)* | Pollinations | text-to-video / image-to-video | `providers/pollinations.js` |
| 6 | **Audio AI** | Cloudflare Workers AI | speech-to-text (`whisper-large-v3-turbo`), text-to-speech (`melotts`) | `providers/cloudflare.js` |
| 7 | **Memory AI** | MongoDB (local DB fallback) | chat history + memories you approve | `memory/mongoStore.js`, `sqliteStore.js` |

Existing app commands ("open reels", "dark mode", reminders…) still run on your existing Codex action engine; CODEX hands them over and shows that engine's confirmations.

### How CODEX routes (free, instant, no tokens spent)
| You send | Engine |
|---|---|
| a voice message | Speech-to-text, then the transcript is routed again |
| a picture + a question | Vision AI |
| a picture + "animate this" | Video AI (image-to-video) |
| "draw / generate an image of…", `/imagine …` (also Tamil/Hindi/Tanglish keywords) | Image AI |
| "make a video of…", `/video …` | Video AI |
| "read this aloud", `/speak …` | Text-to-speech |
| "open reels", "dark mode", "remind me…" | existing Codex action engine |
| `/do hi to rahul` | existing Codex action engine (messaging/follow/block/post need `/do` and are still confirmed) |
| "remember that …" | a memory *proposal* you must approve (no AI call is spent) |
| everything else | Text AI |

You can override with the Auto / Chat / Image / Video / Speak selector. Why not let an LLM decide? It would cost free quota on every message, and the old command parser proved too eager on its own ("Tell me about owls" parses as *send message*), so automatic command routing is limited to harmless UI actions.

## Free-only policy (₹0)
`FREE_ONLY_MODE=true` is the default. In practice:
- **No paid fallback, ever.** If an engine is down or limited, the person sees the limitation. CODEX never switches to another provider (including Anthropic) and never buys credits — there is no payment code anywhere.
- **Cloudflare:** CHEX counts estimated neurons itself and stops at **8,000/day** (`CF_DAILY_NEURON_CAP`, hard-capped at 10,000 while FREE_ONLY is on). This matters: on the Workers **Free** plan Cloudflare simply refuses above 10,000, but an account on **Workers Paid** is billed per neuron above that. *Keep the account on Workers Free.*
- **Groq Free tier:** limits (requests/tokens per minute and per day) differ per model and can change — see console.groq.com → Settings → Limits. CHEX allows `GROQ_CONCURRENCY` (default 4) simultaneous requests, and when Groq answers "429" it pauses that provider (for the `retry-after` time if given, otherwise 2 minutes) and says so.
- **Per-user and shared daily limits** (admin-editable, reset 00:00 UTC): text 100/800, vision 30/200, image 8/40, speech 30/150 each, video 2/6.
- **Video** ships **off**, restricted to `VIDEO_FREE_MODELS` (default `grok-video`). Use a Pollinations key from an account that has not bought credits.
- Nothing promises unlimited use anywhere in the UI.

### What is verified and what is not (read this)
Verified against current provider docs/pricing pages while building: Groq exposes an OpenAI-compatible API (`POST https://api.groq.com/openai/v1/chat/completions`, Bearer key, SSE streaming, `GET /models` for the model list); Cloudflare gives 10,000 free neurons/day (reset 00:00 UTC); request/response shapes for `flux-1-schnell` (`{prompt, steps}` → `image` base64), `whisper-large-v3-turbo` (`{audio: base64}` → `text`), `melotts` (`{prompt, lang}` → `audio` base64).
**Not verified:**
- **No engine was called live** (no keys or internet in the build environment). Tests use stand-ins that match the shapes above. Run `npm run ai:check` with your keys to prove each engine.
- **Default model names** (`openai/gpt-oss-120b` for text, `qwen/qwen3.8-27b` for vision) are best guesses and Groq retires models from time to time; use Admin → AI → model box (it suggests names from Groq's live model list) and *Test connection*.
- **Free video:** sources disagreed on which models are free, and no stable free quota could be confirmed. Treat Video AI as a beta that may be slow, limited or unavailable.
- Neuron estimates are deliberately conservative (≈175 per image, ≈46/min speech-to-text, ≈19/min text-to-speech); your Cloudflare dashboard is the source of truth.
- MeloTTS speaks English, Spanish, French, Japanese, Korean. For Tamil/Hindi etc. the UI offers your device's built-in read-aloud instead.

## Setup
1. **Groq (Text + Vision):** create an account at console.groq.com → API Keys → create a key (starts with `gsk_`).
2. **Cloudflare (Image + Audio):** Cloudflare dashboard → Workers AI → *Use REST API* → copy your **Account ID**, and create an **API token** with *Workers AI* permission. Stay on the Workers **Free** plan.
3. **MongoDB (Memory):** you already use `MONGODB_URI`; CODEX stores history and memories in the same database (collections `codex_conversations`, `codex_messages`, `codex_memories`). Without it, a local database is used.
4. Set the environment variables below: for local use copy `backend/.env.example` to `backend/.env` and fill it in (the backend reads it on start); on Docker use a `.env` beside `docker-compose.yml`; on Render use the dashboard. **Never commit keys.**
5. `cd backend && npm run ai:check` — every engine should show ✅.
6. Sign in as the master account → **Admin → 🧠 AI** to see status, pick models, adjust limits, and press *Test connection*.

### Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `FREE_ONLY_MODE` | `true` | block anything paid; never turn off unless you understand the billing risk |
| `GROQ_API_KEY` | – | **secret**; required for Text + Vision (and Circle to Ask) |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq's OpenAI-compatible endpoint |
| `GROQ_TEXT_MODEL` / `GROQ_VISION_MODEL` | `openai/gpt-oss-120b` / `qwen/qwen3.8-27b` | models (also changeable in Admin) |
| `GROQ_CONCURRENCY` | `4` | simultaneous requests to Groq |
| `GROQ_TIMEOUT_MS` | `60000` | per-request timeout |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | – | **secret** token; image + speech |
| `CF_DAILY_NEURON_CAP` | `8000` | CHEX's own daily limit (max 10000 in free-only) |
| `CF_IMAGE_MODEL` / `CF_STT_MODEL` / `CF_TTS_MODEL` | flux-1-schnell / whisper-large-v3-turbo / melotts | Cloudflare models |
| `VIDEO_API_KEY` | – | **secret**, optional (anonymous works but is heavily rate-limited) |
| `VIDEO_MODEL` / `VIDEO_FREE_MODELS` | `grok-video` / `grok-video` | video model + the allow-list enforced in free-only mode |
| `PUBLIC_BASE_URL` | – | your https site address; only needed for image-to-video |
| `MONGODB_URI` / `MONGODB_DB` | – / `chex` | Memory AI storage |

### Deploy
- **Render:** `render.yaml` lists all variables; fill the secret ones (`sync: false`) in the dashboard.
- **Docker:** put the variables in a `.env` beside `docker-compose.yml`; compose passes them through.
- **HTTPS is required** for the microphone (browsers block it on plain http, except localhost).
- If you front the app with nginx/Cloudflare, disable response buffering for `/api/ai/chat` (the server already sends `X-Accel-Buffering: no`) so tokens stream.

## Website and Android
There is no native Android project in CHEX: the "Android app" is the installable web app (PWA). CODEX AI is part of it, responsive down to phone width, with camera/gallery attach (📎), microphone (🎤, up to 60 s), previews, and an installed-app shortcut. A Play Store wrapper (Trusted Web Activity / Capacitor) would reuse it unchanged but is not included.

## Memory & privacy
- History is saved per person; "Temporary chat" saves nothing. History, memories and files can be deleted from the History tab ("Delete all my CODEX AI data").
- **Long-term memory is opt-in per item.** "Remember that…" produces a proposal with *Save / No thanks*; only saved items are given to the AI. Anything that looks like a card number, password, code, email or phone is refused.
- API keys exist only on the server; the dashboard shows only "set ✓ / missing ✗". Uploads are validated by file *content*, size-limited (picture 4 MB, voice 2 MB) and stored under `uploads/ai/<user>/` with unguessable names (like the rest of CHEX's uploads). Prompts for sexual content involving minors are blocked locally on top of the providers' own filters.
- If MongoDB is unreachable, CODEX still answers and warns that history isn't being saved.

## API (signed-in users)
`GET /api/ai/status` · `POST /api/ai/chat` (SSE events: `route`, `token`, `transcript`, `media`, `memory_proposal`, `command`, `warning`, `error`, `usage`, `done`; send `stream:false` for one JSON reply) · `POST /api/ai/upload` · `POST /api/ai/transcribe` · `GET|PATCH|DELETE /api/ai/conversations[/:id]` · `GET|POST|DELETE /api/ai/memory[/:id]` · `GET|DELETE /api/ai/media[/:id]` · `DELETE /api/ai/data`
Admin (master account): `GET /api/admin/ai/overview` · `PUT /api/admin/ai/engines/:engine` · `POST /api/admin/ai/engines/:engine/test|reset` · `GET /api/admin/ai/groq-models`

## Troubleshooting
| You see | Meaning / fix |
|---|---|
| "…isn't set up on this server yet" | missing key/ID — set the variable, restart, `npm run ai:check` |
| "unavailable right now" (admins see "rejected the API key") | wrong/expired key |
| "reached its free usage limit for now" | provider 429; CODEX pauses it briefly (Admin → *Clear pause* to retry) |
| "used up today's free allowance" | Cloudflare cap reached; resets 00:00 UTC |
| "busy right now" | too many simultaneous requests; try again in a moment (or raise `GROQ_CONCURRENCY`) |
| "model wasn't found" | pick another in Admin → AI (suggestions come from Groq) |
| "would need a paid plan…free-only mode" | video model isn't on `VIDEO_FREE_MODELS` |
| no streaming (answer appears all at once) | a proxy is buffering `/api/ai/chat` |
| mic button says permission denied / unsupported | needs https and a browser with MediaRecorder |

## Tests
Backend `test/codexai.test.mjs` (27 tests: routing, exact provider request shapes, quotas/UTC reset, free-only rules, cooldowns, streaming, uploads, memory incl. a MongoDB-driver fake, admin) and frontend `test/codexAi.test.jsx` (24 tests). All run against stand-ins — **live connectivity is checked with `npm run ai:check`.** The MongoDB store is tested against a faithful in-memory fake of the driver calls it uses, not a real server.
