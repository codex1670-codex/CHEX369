// Circle to Ask — server-side privacy net.
//
// The browser already masks sensitive parts of the page BEFORE anything is captured or sent. This is the
// second line of defence: whatever text arrives is scrubbed again here, so a bug or an old client can
// never push a card number, password, one-time code or similar through to the AI provider.

const luhn = (digits) => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return digits.length >= 13 && sum % 10 === 0;
};

const RULES = [
  // Secrets first (so later number rules don't half-match inside them).
  { re: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, to: '[secret hidden]' },                      // JWT
  { re: /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, to: '[secret hidden]' },                      // API-key look-alikes
  { re: /\b(?:password|passwd|pwd|passcode)\b\s*[:=]\s*\S+/gi, to: '[password hidden]' },
  { re: /\b(otp|cvv|cvc|pin|passcode|verification code|security code|one[- ]time (?:code|password))\b[^\n\d]{0,14}\d{3,8}\b/gi, to: '$1: [hidden]' },
  // Payment / identity.
  { re: /\b[\w.-]{2,}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|paytm|ibl|axl|upi|apl|sbi|hdfcbank|icici|axisbank)\b/gi, to: '[payment ID hidden]' },
  { re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, to: '[bank code hidden]' },                                   // IFSC
  { re: /(?<!\d[ -])\b\d{4}[ -]\d{4}[ -]\d{4}\b(?![ -]?\d)/g, to: '[ID number hidden]' },                               // Aadhaar-style
  { re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, to: '[ID number hidden]' },                                    // PAN-style
  // Contact details.
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, to: '[email hidden]' },
];

export function redact(input, max = 1500) {
  let s = String(input ?? '').replace(/\s+/g, ' ').trim();
  let count = 0;
  const bump = (to) => (...m) => { count++; return to.replace(/\$1/g, m[1] ?? ''); };

  // Card numbers first: 13–19 digits (spaces/dashes allowed) that pass the Luhn check. This must run before the
  // shorter ID-number rules so those can never swallow part of a card and leave its last digits showing.
  s = s.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? (count++, '[card number hidden]') : m));

  for (const { re, to } of RULES) s = s.replace(re, bump(to));

  // Any other long run of digits (optionally split by spaces/dashes): 10–13 digits reads as a phone number, longer as an
  // account/ID number. The whole run is always consumed, so a partial number can never be left showing.
  s = s.replace(/(?<![\w.])\+?\d(?:[ -]?\d){9,}(?![\w])/g, (m) => {
    count++;
    return m.replace(/\D/g, '').length <= 13 ? '[phone hidden]' : '[number hidden]';
  });

  return { text: s.slice(0, max), count };
}

// Page context sent along with the picture: only short, plain, bounded strings survive.
export function cleanContext(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const strs = (a, n, len) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => redact(x, len).text).filter(Boolean);
  return {
    screen: redact(c.screen, 40).text,
    title: redact(c.title, 80).text,
    headings: strs(c.headings, 8, 60),
    activeTabs: strs(c.activeTabs, 6, 60),
    device: ['phone', 'tablet', 'desktop'].includes(c.device) ? c.device : undefined,
  };
}
