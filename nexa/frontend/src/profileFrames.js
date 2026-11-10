// Premium animated profile frames. ids must match PROFILE_FRAMES in backend/src/coins.js;
// the artwork for each lives in frames.css as `.pf-<id>`.
export const PROFILE_FRAMES = [
  { id: 'golden',  name: 'Golden Halo',     tag: 'Spinning gold light' },
  { id: 'aurora',  name: 'Aurora Spin',     tag: 'Northern-lights ring' },
  { id: 'neon',    name: 'Neon Pulse',      tag: 'Pink & cyan glow' },
  { id: 'crown',   name: 'Royal Crown',     tag: 'Gold ring + crown' },
  { id: 'emerald', name: 'Emerald Flame',   tag: 'Living green fire' },
  { id: 'rainbow', name: 'Rainbow Orbit',   tag: 'Full-spectrum spin' },
  { id: 'diamond', name: 'Diamond Sparkle', tag: 'Icy shimmer & stars' },
  { id: 'inferno', name: 'Inferno',         tag: 'Flickering flames' },
  { id: 'ocean',   name: 'Ocean Wave',      tag: 'Rolling blue tide' },
  { id: 'blossom', name: 'Cherry Blossom',  tag: 'Drifting petals' },
  { id: 'glitch',  name: 'Cyber Glitch',    tag: 'Digital static' },
  { id: 'galaxy',  name: 'Galaxy Orbit',    tag: 'Orbiting star' },
];
export const isFrameId = (id) => PROFILE_FRAMES.some(f => f.id === id);
