# Circle to Ask

Circle part of any CHEX screen, approve a preview, and ask Codex about it.

**Use it:** Settings → ⭕ Circle to Ask → switch on. Then press and hold (~0.8 s) on an empty part of a page, or tap ⭕ on the Codex bar.
**Flow:** circle → *Let Codex look at this area?* → preview (with what text Codex will read) → *Send to Codex* → answer panel.

## What you can do in the panel
| Button | Does |
|---|---|
| 💡 Explain | Explains the circled part |
| 🪄 Simplify | Same, in the simplest words |
| 🔬 Deep Explain | What / why / how / what happens / tips |
| 🌐 Translate | Explains in the language chosen in the panel |
| 🪜 Show Steps | Numbered steps |
| 🧭 Take Me There | Suggests the right CHEX screen; **moves only after you tap "Take me there"** |
| Quick questions + free text | What is this? · Why is this used? · How does it work? · What happens if I click it? · How can I fix this? · Give me an example · anything you type |

## The six building blocks
| Block | Where it lives |
|---|---|
| **Brain** | `backend/src/circle/provider.js` — one function, two back-ends: Groq (default, open-weight vision models), any OpenAI-compatible server, or Anthropic |
| **Personality** | `backend/src/circle/prompt.js` — Codex's tone, per-mode instructions, JSON reply format, safety rules |
| **Knowledge** | `backend/src/circle/knowledge.js` — short CHEX notes (from the README) + keyword retrieval; answers about the app are grounded in these |
| **Memory** | `frontend/src/circleAsk/settings.js` — opt-in only: "Remember my language" is saved on this device; nothing else is remembered; one click forgets it |
| **Tools** | Navigation only, through a fixed allow-list of real screens (`SCREENS`), always with the person's tap. (The existing Codex tool registry is untouched.) |
| **Vision** | The approved crop is sent with the question; if the person unchecks "Include the picture", or the screen doesn't allow pictures, Codex works from text only |

### Model setup: Groq (default)
Circle to Ask talks to **Groq** out of the box — no Anthropic key needed.
```
# set as environment variables (shell, Render dashboard, or a .env next to docker-compose.yml).
# NEVER commit the key to the repository.
GROQ_API_KEY=gsk_...                                          # required (console.groq.com → API Keys)
GROQ_BASE_URL=https://api.groq.com/openai/v1                  # default
GROQ_VISION_MODEL=qwen/qwen3.8-27b   # default; any Groq vision-capable model
```
Other options: `CIRCLE_PROVIDER=openai` (+ `CIRCLE_BASE_URL`, `CIRCLE_MODEL`, `CIRCLE_API_KEY`) for vLLM/LM Studio, or `CIRCLE_PROVIDER=anthropic` (+ `ANTHROPIC_API_KEY`). Pick a vision-capable model; text-only models still work when the person sends text only. Note: the rest of Codex (commands) still uses its existing `ANTHROPIC_API_KEY` setup — only Circle to Ask uses Groq.

## Privacy model
1. **Permission first.** Nothing is captured until the person taps *Capture & preview*; nothing is sent until they tap *Send to Codex*. "Don't ask again" skips only the first prompt, only until CHEX is closed, and is never saved.
2. **Only the circled area.** The picture is drawn from a *copy* of the CHEX page, cropped to the circle, shrunk (≤1024 px, ≤~900 KB). It can never include other apps, notifications or the rest of the phone.
3. **Blacked out before drawing:** password / card / OTP / PIN inputs, anything with `data-sensitive` or `data-private`, chat bubbles and conversation previews. Typed-in text (drafts, searches) is cleared.
4. **Screens:** *Private space* and *Admin* are never shared. *Messages*, *Coin store* and *Settings* are **text-only**: Codex reads button/heading labels (never message content) and no picture is taken.
5. **Scrubbed text:** card numbers (Luhn-checked), OTP/CVV/PIN, passwords, emails, UPI IDs, phone/ID/account numbers, tokens — on the device, and again on the server. Long digit runs are hidden whole, never partially.
6. **Not stored.** The server writes nothing to the database or disk and logs only an error message. The picture lives in browser memory and is dropped when the panel closes, the page changes, or the person taps 🗑 / ✕.
7. **Prompt-injection safe.** Text on the screen (a post, a message from someone else) is passed as data; the model is told never to follow instructions found in it, and can only *suggest* a screen from a fixed list.

Mark any element that should never be shared with `data-sensitive`. Mark an area that should never *start* the long-press with `data-no-circle`.

## API
`POST /api/codex/circle` (signed in; shares the Codex rate limit) — body:
`{ mode, question?, language?, locale, regionText, context:{screen,title,headings,activeTabs,device}, history?, consent:true, image?:{mediaType:'image/jpeg'|'image/png'|'image/webp', data:<base64>} }`
→ `{ answer, steps[], navigate:{screen,label,reason}|null, followUps[], mode, usedImage, hiddenItems }`.
`GET /api/codex/circle/status` → `{ configured, modes }`.
Errors use the app's usual `{ error:{ code, message } }`: `NO_CONSENT`, `BAD_IMAGE`, `IMAGE_TOO_LARGE`, `BLOCKED_SCREEN`, `NOTHING_SELECTED`, `NOT_CONFIGURED`, `PROVIDER_ERROR`.

## Known limits (be upfront with users)
- Works **inside CHEX** only. A page in a browser tab/PWA cannot see other apps; "circle anywhere on the phone" would need a native Android app (MediaProjection/Accessibility), which is a different project.
- The picture is a re-draw of the page (html2canvas): glass/blur effects, some CSS, and video frames can look flatter or blank, and cross-origin images without CORS headers can't be drawn. When drawing fails, Circle to Ask automatically falls back to text only and says so.
- Long-press ignores buttons, links, fields, videos and anything with its own long-press (post reactions, chat menu, reels hold) so it never fights them — use ⭕ on the Codex bar there.
- Answers are only as good as the model; the AI key (or open-weight server) must be configured, otherwise Codex says so plainly.

## Manual QA checklist (needs a real phone + desktop browser)
1. Long-press empty space on Home → overlay; draw a circle → permission → preview shows the right area.
2. Compare the preview against the screen: a typed draft, a password box and chat bubbles must be blank/black.
3. Messages and Coin store: no *Capture* button; *Read labels* works; preview text contains no message content.
4. Private space: long-press does nothing; ⭕ shows "switched off on private screens".
5. Each of the six buttons and quick questions; Translate in Tamil/Hindi; Take Me There → the card asks first.
6. Close the panel → open DevTools → no screenshot data retained; Network tab shows exactly one POST per question.
7. Turn the AI key off → a plain "isn't set up on this server" message, not a fake answer.
