// The studio assistant's command reader. It only turns a sentence into an INTENT; ScanStudio executes the intent
// against the engine (asking first for anything that changes the model) and the real Codex assistant is kept
// informed of the studio state through codexContext. Plain English only for now — other languages fall through
// to the "I didn't understand" answer rather than being guessed at.

const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const MODES = [['wireframe', 'wireframe'], ['wire frame', 'wireframe'], ['x-ray', 'xray'], ['xray', 'xray'], ['x ray', 'xray'], ['point cloud', 'points'], ['points', 'points'], ['textured', 'textured'], ['solid', 'solid']];
const MATS = ['metal', 'wood', 'glass', 'plastic', 'matte', 'rubber', 'brushed'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s.\-]/gu, ' ').replace(/\s+/g, ' ').trim();

export const HELP = 'Try: “show from the top”, “wireframe”, “separate the components”, “hide the seat”, “select leg”, “make a second version in wood”, “create a simplified version”, “drop it” (physics), “will it tip over?”, “compare materials”, “measure distance”, “explain this model”, “prepare this for sharing”, “undo”.';

/** `ctx.partNames` = [{id,name}] of live parts, `ctx.selected` = ids. Returns { intent, ...args } or { intent: 'clarify'|'unsupported'|'unknown', reply }. */
export function interpret(text, ctx = {}) {
  const t = norm(text); const names = ctx.partNames || [];
  if (!t) return { intent: 'unknown', reply: HELP };

  if (/\b(undo)\b/.test(t)) return { intent: 'undo' };
  if (/\b(redo)\b/.test(t)) return { intent: 'redo' };
  if (/(reset|fit|frame|recenter|re center)\b.*\b(camera|view)\b|^(reset|frame) ?(view|camera)?$/.test(t)) return { intent: 'frame' };

  const view = VIEWS.find((v) => new RegExp(`\\b${v}\\b`).test(t));
  if (view && /(show|view|look|see|from|camera|go)/.test(t) && !/\b(hide|delete|remove|select)\b/.test(t)) return { intent: 'view', value: view };
  const mode = MODES.find(([w]) => t.includes(w));
  if (mode && /(show|switch|mode|view|display|turn|use|make|^wireframe|^solid|^textured|^x ?-?ray|^points)/.test(t)) return { intent: 'viewMode', value: mode[1] };

  if (/(damage|defect|crack|dent|scratch|broken|wear)/.test(t)) {
    return { intent: 'unsupported', reply: 'I can’t detect damage — there is no defect-detection model connected to this studio, and guessing would be misleading. I can hide parts, use X-ray, or measure two points so you can inspect it yourself.' };
  }
  if (/\b(stop|end|cancel)\b.*\b(simulation|physics)\b|\b(simulation|physics)\b.*\b(stop|off)\b/.test(t)) return { intent: 'simStop' };
  if (/\b(simulate|simulation|physics)\b|\bdrop (it|the|this)\b|\bgravity\b/.test(t)) return { intent: 'simulate' };
  if (/\b(stable|stability|balanced?|tip over|topple|fall over|centre of mass|center of mass)\b/.test(t)) return { intent: 'balance' };
  if (/compare.*\bmaterials?\b|\bmaterials?\b.*\bcompar/.test(t)) return { intent: 'compareMaterials' };
  if (/(separate|split|segment|detect).*(component|part|piece|object)|(component|part)s?\b.*\b(separate|split)|\bseparate\b/.test(t)) return { intent: 'split' };

  if (/(second|another|new|alternative|different).*(version|variant)|\bvariant\b/.test(t) || /\bversion\b.*\b(material|colou?r|in)\b/.test(t)) {
    const material = MATS.find((m) => t.includes(m));
    const color = (t.match(/\b(red|blue|green|yellow|orange|purple|pink|black|white|grey|gray|gold|silver)\b/) || [])[1];
    if (/simplif|low ?poly|lighter|smaller file/.test(t)) return { intent: 'simplify', ratio: 0.5 };
    if (!material && !color) return { intent: 'clarify', reply: 'What should differ in the second version — a material (metal, wood, glass, plastic, matte, rubber, brushed) or a colour?' };
    return { intent: 'variant', material, color };
  }
  if (/simplif|reduce (the )?(poly|triangle)|low ?poly|lighter model|decimate/.test(t)) return { intent: 'simplify', ratio: /(25|quarter)/.test(t) ? 0.25 : 0.5 };
  if (/smooth/.test(t)) return { intent: 'smooth' };

  if (/measure|distance|how (far|long|wide|tall|big)|dimension|\bsize\b/.test(t)) {
    if (/angle/.test(t)) return { intent: 'measure', mode: 'angle' };
    if (/(how (long|wide|tall|big))|dimension|\bsize\b/.test(t)) return { intent: 'dimensions' };
    return { intent: 'measure', mode: 'distance' };
  }
  if (/(explain|describe|what is|summar|tell me about|analy[sz]e)/.test(t)) return { intent: 'explain' };
  if (/(prepare|ready|get).*(shar|publish|post)|\bshare\b|\bpublish\b/.test(t)) return { intent: 'prepareShare' };
  if (/\bsave\b/.test(t)) return { intent: 'save' };
  if (/\bexport\b|\bdownload\b/.test(t)) return { intent: 'goto', value: 'export' };

  const verb = (t.match(/\b(hide|show|select|delete|remove|lock|unlock|duplicate|copy|rename)\b/) || [])[1];
  if (verb) {
    const target = names.filter((p) => p.name && t.includes(norm(p.name)));
    const byWord = target.length ? target : names.filter((p) => norm(p.name).split(' ').some((w) => w.length > 2 && new RegExp(`\\b${w}s?\\b`).test(t)));
    const ids = byWord.map((p) => p.id);
    const intent = { hide: 'hide', show: 'showPart', select: 'select', delete: 'delete', remove: 'delete', lock: 'lock', unlock: 'unlock', duplicate: 'duplicate', copy: 'duplicate', rename: 'rename' }[verb];
    if (verb === 'show' && !ids.length) return { intent: 'unknown', reply: HELP };
    if (/\b(all|everything)\b/.test(t) && (verb === 'show' || verb === 'hide')) return { intent, all: true };
    if (ids.length) return { intent, ids, names: byWord.map((p) => p.name) };
    if (ctx.selected?.length && verb !== 'rename') return { intent, ids: ctx.selected, names: [] };
    return { intent: 'clarify', reply: `Which part should I ${verb}? Select it in the viewport or the Parts list, or name it (${names.slice(0, 4).map((p) => p.name).join(', ') || 'no parts yet'}).` };
  }
  return { intent: 'unknown', reply: `I didn’t understand that. ${HELP}` };
}
