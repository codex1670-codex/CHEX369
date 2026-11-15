// Circle to Ask — keeping private things private.
//
// Three layers, all applied on the device BEFORE anything is sent:
//   1. Whole screens that are never shared (Private space, Admin), and screens where only button/heading
//      labels — never pictures or message content — may be read (Messages, Coin store, Settings).
//   2. Page elements that are blacked out of the picture and skipped when reading text: password / card / code
//      fields, anything marked data-sensitive, and chat message bubbles. Typed-in text is cleared too.
//   3. Text patterns scrubbed from what is read: card numbers, codes, passwords, emails, phone numbers…
// (The server scrubs the text again — see backend/src/circle/redact.js. Keep the two in step.)

export const BLOCKED_ROUTES = new Set(['mylife', 'admin']);
export const NO_PICTURE_ROUTES = new Set(['messages', 'coins', 'settings']);
export const CONTROLS_ONLY_ROUTES = new Set(['messages']);

export const SENSITIVE_SELECTOR = [
  'input[type="password"]', 'input[autocomplete^="cc-"]', 'input[autocomplete="one-time-code"]', 'input[autocomplete*="password"]',
  'input[name*="pass" i]', 'input[name*="card" i]', 'input[name*="cvv" i]', 'input[name*="cvc" i]', 'input[name*="otp" i]', 'input[name*="pin" i]',
  'input[id*="pass" i]', 'input[id*="card" i]', 'input[id*="otp" i]',
  '[data-sensitive]', '[data-private]',
].join(',');
// Chat content: message bubbles and conversation previews.
export const BUBBLE_SELECTOR = '[class*="bubble"], [class*="convo-preview"], [class*="chat-media"]';
export const ENTERED_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

export function routeStatus(route, privateSpaceOpen = false) {
  if (privateSpaceOpen || BLOCKED_ROUTES.has(route)) return 'blocked';
  if (NO_PICTURE_ROUTES.has(route)) return 'text-only';
  return 'full';
}

const luhn = (digits) => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return digits.length >= 13 && sum % 10 === 0;
};
const RULES = [
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, '[secret hidden]'],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, '[secret hidden]'],
  [/\b(?:password|passwd|pwd|passcode)\b\s*[:=]\s*\S+/gi, '[password hidden]'],
  [/\b(otp|cvv|cvc|pin|passcode|verification code|security code|one[- ]time (?:code|password))\b[^\n\d]{0,14}\d{3,8}\b/gi, '$1: [hidden]'],
  [/\b[\w.-]{2,}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|paytm|ibl|axl|upi|apl|sbi|hdfcbank|icici|axisbank)\b/gi, '[payment ID hidden]'],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, '[bank code hidden]'],
  [/(?<!\d[ -])\b\d{4}[ -]\d{4}[ -]\d{4}\b(?![ -]?\d)/g, '[ID number hidden]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[ID number hidden]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden]'],
];
export function redactText(input, max = 1500) {
  let s = String(input ?? '').replace(/\s+/g, ' ').trim();
  let count = 0;
  s = s.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? (count++, '[card number hidden]') : m)); // cards first
  for (const [re, to] of RULES) s = s.replace(re, (...m) => { count++; return to.replace(/\$1/g, m[1] ?? ''); });
  s = s.replace(/(?<![\w.])\+?\d(?:[ -]?\d){9,}(?![\w])/g, (m) => { count++; return m.replace(/\D/g, '').length <= 13 ? '[phone hidden]' : '[number hidden]'; });
  return { text: s.slice(0, max), count };
}

export const isSensitive = (el) => !!el?.closest?.(`${SENSITIVE_SELECTOR},${BUBBLE_SELECTOR}`);

function blackOut(el) {
  if ('value' in el) { try { el.value = ''; } catch { /* readonly */ } el.setAttribute?.('value', ''); }
  for (const a of ['src', 'srcset', 'poster', 'placeholder']) el.removeAttribute?.(a);
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const [k, v] of [['background', '#111'], ['background-image', 'none'], ['color', 'transparent'], ['border-color', '#111'], ['box-shadow', 'none'], ['text-shadow', 'none']]) el.style?.setProperty(k, v, 'important');
}

// Run on the CLONED page that is about to be drawn into the picture (never on the live page).
// Returns how many things were blacked out.
export function maskSensitiveIn(root) {
  let n = 0;
  root.querySelectorAll(`${SENSITIVE_SELECTOR},${BUBBLE_SELECTOR}`).forEach((el) => { blackOut(el); n++; });
  // Anything typed in (a draft message, a search, a caption) is the person's own business: show the empty box.
  root.querySelectorAll(ENTERED_SELECTOR).forEach((el) => {
    if (el.matches?.('select')) { try { el.selectedIndex = -1; } catch { /* ignore */ } return; }
    if ('value' in el && el.value) { try { el.value = ''; } catch { /* ignore */ } el.setAttribute?.('value', ''); }
    else if (el.getAttribute?.('contenteditable') === 'true') el.textContent = '';
  });
  return n;
}
