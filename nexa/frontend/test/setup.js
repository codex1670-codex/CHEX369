// jsdom has no canvas: give every <canvas> a context that accepts (and ignores) all drawing calls,
// so each game's real draw code still runs and any exception in it fails the test.
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? () => ({ width: 10 }) : () => {})), set: (t, k, v) => { t[k] = v; return true; } });
HTMLCanvasElement.prototype.getContext = () => ctx;
HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300 });
