# Master account — `sanjiv`

A permanent owner account that always exists (re-created on every server start).

**Login** — two steps. Username `sanjiv` + password 1 on the normal login form; if both are right the app asks for
password 2 (verified together with a 3-minute signed challenge tied to your IP). Anything wrong, at either step, gives
the same generic "Incorrect username/email or password" error. 5 wrong tries from one IP lock that IP for 15 minutes.

**What it can do** (🛡️ Admin in the ＋ menu, plus 🛡️ buttons on feed posts, reels and comments)
- Delete any post, reel, comment, reel comment, story, note or message — from the feed or by ID
- Delete any user (permanent, same as "delete account")
- Gift CHEX coins (1 – 1,000,000,000), Premium Themes, Premium Frames (optionally pick the frame)
- Unlimited CHEX coins (shows ∞) and every Premium theme/frame unlocked
- Every report (post, reel, comment, user…) arrives as a DM from **CHEX Reports 🚩** with the reporter,
  reason and content, and appears in Admin → Reports with Delete content / Delete user / Dismiss

**Protected** — nobody (including sanjiv) can deactivate, delete, or add 2FA to the account from the app;
the name `sanjiv` can't be registered by anyone else; if someone had already registered it, that
account becomes the master account on the next start.

**Changing the passwords** — only bcrypt hashes are stored in `backend/src/admin.js`. To change them,
set these environment variables (e.g. on Render) and restart:

    NEXA_MASTER_PASS1_HASH=<bcrypt hash of password 1>
    NEXA_MASTER_PASS2_HASH=<bcrypt hash of password 2>

    node -e "console.log(require('bcryptjs').hashSync('your new password', 12))"

Because the hashes of the current passwords are in the code, **change them via the env vars before putting
this on a public GitHub repo.**

## Gifts between users

Any user can send a gift to one person: **CHEX coins**, **Premium Themes**, **Premium Frames** or a **CHEX learn language**
(🎁 Gift on a profile, or CoinStore → Send a gift). The sender pays from their own coins (coins = that amount, themes 1,000,
frames 2,000, a language 100); the receiver gets it free and sees a toast. Rules: coin gifts are 1–500 each and 500 a day per
sender (stops two accounts shuffling coins endlessly); no gifting yourself, blocked users, or things the person already has;
a language can only be gifted to someone who already picked their free first language. sanjiv's gifts are free.
