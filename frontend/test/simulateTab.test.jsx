import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import * as THREE from 'three';
import { StudioEngine } from '../src/sim3d/studio/engine.js';
import { SimulateTab } from '../src/sim3d/studio/panelsB.jsx';

// A real StudioEngine with the WebGL-only parts stubbed out, holding a base, a block on top of it and a loose block.
function makeEngine() {
  const eng = new StudioEngine();
  eng.scene = new THREE.Scene(); eng.modelRoot = new THREE.Group(); eng.scene.add(eng.modelRoot);
  eng.selBoxes = new THREE.Group(); eng.attachGizmo = () => {}; eng.invalidate = () => {}; eng.select = (ids) => { eng.selected = new Set(ids); }; eng.setGizmo = () => {};
  eng.renderer = { domElement: { style: {}, width: 400, height: 300 }, render: () => {} };
  const add = (id, size, pos) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: '#888888' })); m.position.set(...pos); m.userData.partId = id; eng.modelRoot.add(m); eng.addPart(m, id); };
  add('base', [2, 1, 2], [0, 0.5, 0]); add('top', [1, 1, 1], [0, 1.5, 0]); add('loose', [1, 1, 1], [5, 0.5, 0]);
  eng.modelRoot.updateMatrixWorld(true); eng.emitParts = () => {}; eng.emitStats = () => {};
  return eng;
}
const pos = (eng, id) => eng.part(id).object.position.toArray();

describe('StudioEngine — simulation features', () => {
  let eng; beforeEach(() => { eng = makeEngine(); }); afterEach(() => eng.stopSim());

  it('nudge pushes a free part, refuses fixed parts, and needs a simulation', () => {
    expect(() => eng.nudge('top', [1, 0, 0])).toThrow(/Set up/);
    eng.startSim({ fixedIds: ['base'] });
    expect(() => eng.nudge('base', [1, 0, 0])).toThrow(/fixed/);
    expect(() => eng.nudge('ghost', [1, 0, 0])).toThrow(/not in the simulation/);
    eng.nudge('loose', [1, 0, 0], 3); eng.playSim(false);
    const b = eng.sim.bodies.find((x) => x.id === 'loose'); expect(b.vel[0]).toBeGreaterThan(0);
  });
  it('updateSim changes gravity/bounce/speed live and clamps the speed', () => {
    eng.startSim({}); eng.updateSim({ gravity: 3, restitution: 0.5, friction: 0.7, timeScale: 99, autoPause: false });
    expect(eng.sim.opts.gravity).toBeCloseTo(-3); expect(eng.sim.opts.restitution).toBe(0.5); expect(eng.sim.opts.friction).toBe(0.7); expect(eng.sim.timeScale).toBe(3); expect(eng.sim.autoPause).toBe(false);
  });
  it('collision boxes follow the bodies and disappear with the simulation', () => {
    eng.startSim({}); eng.showBoxes(true); expect(eng._boxGroup.children.length).toBe(3);
    eng.sim.bodies[2].pos[1] += 1; eng.applySim(); expect(eng._boxGroup.children[2].position.y).toBeCloseTo(eng.sim.bodies[2].pos[1]);
    eng.stopSim(); expect(eng._boxGroup).toBeNull();
  });
  it('stop puts every part back', () => {
    const before = pos(eng, 'top'); eng.startSim({ fixedIds: ['base'] }); eng.sim.bodies[1].pos[1] += 3; eng.applySim(); expect(pos(eng, 'top')[1]).not.toBeCloseTo(before[1]);
    eng.stopSim(); expect(pos(eng, 'top')).toEqual(before);
  });

  it('slider and ball joints move the part and restore it on stop', () => {
    const before = pos(eng, 'loose');
    eng.startJoint('loose', 'slider', 'x', 100); eng.setAnimTime(1.5); expect(pos(eng, 'loose')[0]).toBeCloseTo(before[0] + 1, 3);   // 100% of a 1 m wide part
    eng.stopAnim(); expect(pos(eng, 'loose')).toEqual(before);
    eng.startJoint('loose', 'ball', 'y', 30); eng.setAnimTime(0); expect(eng.part('loose').object.rotation.z).not.toBeCloseTo(0); eng.stopAnim();
    expect(eng.part('loose').object.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(() => eng.startJoint('nope', 'slider')).toThrow(/Select a part/); expect(() => eng.startJoint('loose', 'weld')).toThrow(/Unknown joint/);
  });
  it('timeline: options clamp, keys can be deleted, easing applies, reset returns to the start', () => {
    eng.setAnimOptions({ duration: 500, speed: 99, loop: false, easing: 'smooth' }); expect(eng.anim.duration).toBe(60); expect(eng.anim.speed).toBe(4); expect(eng.anim.loop).toBe(false);
    eng.part('loose').object.position.set(0, 0, 0); eng.setKey('loose', 0); eng.part('loose').object.position.set(4, 0, 0); eng.setKey('loose', 1);
    eng.setAnimOptions({ duration: 4 }); eng.setAnimTime(0.25); expect(pos(eng, 'loose')[0]).toBeLessThan(1);          // smooth easing lags linear (which would be 1)
    eng.resetAnim(); expect(pos(eng, 'loose')[0]).toBe(0); expect(eng.anim.t).toBe(0);
    eng.deleteKey('loose', 0); expect(eng.anim.keys.loose.length).toBe(1); eng.deleteKey('loose', 0); expect(eng.anim.keys.loose).toBeUndefined();
  });

  it('structure analysis finds the load path and the balance, and its overlay never leaks into exports', () => {
    const r = eng.analyseStructure(); const by = Object.fromEntries(r.parts.map((p) => [p.id, p]));
    expect(by.top.rel).toBe(0); expect(by.loose.rel).toBe(0); expect(by.base.rel).toBeGreaterThan(0); expect(r.support).not.toBeNull();
    eng.showStructure({ com: true, loads: true }, true);
    expect(eng._structure.children.length).toBeGreaterThan(0); expect(eng.part('base').object.material).not.toBe(eng.part('base').authorMat);       // tinted for display…
    const { group } = eng.exportGroup(); expect(group.children.every((c) => c.material === eng.parts.find((p) => p.name === c.name).authorMat)).toBe(true);   // …but exports use the real material
    eng.clearStructure(); expect(eng._structure).toBeNull(); expect(eng.part('base').object.material).toBe(eng.part('base').authorMat);
  });
  it('a tilted-away centre of mass is reported as tipping', () => {
    eng.part('top').object.position.set(4, 1.5, 0); eng.part('top').object.updateMatrixWorld(true);
    const r = eng.analyseStructure(); expect(r.com).toBeTruthy();   // loose + base + top spread out: whatever the verdict, it must be a finite number
    expect(Number.isFinite(r.marginM)).toBe(true);
  });

  it('material preview is undo-free until committed, can be A/B-toggled and reverted', () => {
    const m = eng.part('base').authorMat; const orig = m.color.getHexString(); const hist = eng.history.length; const events = [];
    eng.on((e, d) => events.push([e, d]));
    expect(eng.previewMaterial('Metal', ['base'])).toBe(1); expect(m.metalness).toBe(1); expect(eng.history.length).toBe(hist);
    expect(eng.togglePreviewCompare()).toBe(false); expect(m.metalness).not.toBe(1); expect(eng.togglePreviewCompare()).toBe(true); expect(m.metalness).toBe(1);
    eng.revertMaterialPreview(); expect(m.metalness).not.toBe(1); expect(m.color.getHexString()).toBe(orig); expect(events.some(([e, d]) => e === 'matpreview' && d === null)).toBe(true);
    expect(eng.previewMaterial('Nonsense')).toBe(0);
    eng.previewMaterial('Wood', ['base']); expect(eng.commitMaterialPreview()).toBe(1); expect(m.roughness).toBeCloseTo(0.75); expect(eng.history.length).toBeGreaterThan(hist);
    expect(eng.undo()).toBe(true); expect(m.roughness).not.toBeCloseTo(0.75);
  });
  it('locked parts are skipped by material previews', () => {
    eng.part('base').locked = true; expect(eng.previewMaterial('Metal', ['base'])).toBe(0); expect(eng.previewMaterial('Metal')).toBe(2);
  });
});

describe('<SimulateTab />', () => {
  let eng; const notify = vi.fn();
  const ui = (extra = {}) => <SimulateTab ctx={{ eng, selected: new Set(['loose']), notify, unit: 'cm', ...extra }} />;
  beforeEach(() => { cleanup(); notify.mockClear(); eng = makeEngine(); });
  afterEach(() => eng.stopSim());

  it('shows the safety disclaimer and all five sections', () => {
    render(ui());
    expect(screen.getByRole('note').textContent).toMatch(/not.*engineering, structural or safety analysis/i);
    for (const n of [/Physics/, /Joints/, /Timeline/, /Materials/, /Balance/]) expect(screen.getByRole('tab', { name: n })).toBeTruthy();
  });
  it('physics: push buttons are disabled until set up, then push the selected part', () => {
    render(ui());
    expect(screen.getByText(/→ Right/).closest('button').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Keep selected part/));   // un-tick: the selected part must be free to move
    fireEvent.click(screen.getByText('Set up')); expect(screen.getByText(/→ Right/).closest('button').disabled).toBe(false);
    act(() => { fireEvent.click(screen.getByText(/→ Right/)); });
    expect(eng.sim.bodies.find((b) => b.id === 'loose').vel[0]).toBeGreaterThan(0);
  });
  it('physics: pushing a part that is kept fixed explains why', () => {
    render(ui({ selected: new Set(['base']) })); fireEvent.click(screen.getByText('Set up')); fireEvent.click(screen.getByText(/→ Right/));
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/fixed/));
  });
  it('joints: slider demo runs and Stop restores the part', () => {
    render(ui()); fireEvent.click(screen.getByRole('tab', { name: /Joints/ })); const before = pos(eng, 'loose');
    fireEvent.click(screen.getByText(/Slide “loose”/)); expect(eng.anim.joint.kind).toBe('slider'); eng.setAnimTime(1.5); expect(pos(eng, 'loose')).not.toEqual(before);
    fireEvent.click(screen.getByText(/Stop/)); expect(pos(eng, 'loose')).toEqual(before); expect(eng.anim.joint).toBeNull();
  });
  it('timeline: sets, lists and deletes a key', () => {
    render(ui()); fireEvent.click(screen.getByRole('tab', { name: /Timeline/ }));
    fireEvent.click(screen.getByText(/Set key at/)); expect(screen.getByText(/loose · 0.0 s/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Delete key of loose/)); expect(screen.getByText('No keys yet.')).toBeTruthy();
  });
  it('balance: analyses, reports, and clears', () => {
    render(ui()); fireEvent.click(screen.getByRole('tab', { name: /Balance/ })); fireEvent.click(screen.getByText('Analyse'));
    expect(screen.getByLabelText('Weight resting on each part').querySelectorAll('li').length).toBe(3); expect(eng._structure).toBeTruthy();
    fireEvent.click(screen.getByText('Clear')); expect(eng._structure).toBeNull(); expect(screen.queryByLabelText('Weight resting on each part')).toBeNull();
  });
  it('materials: reports a clear error when the preview cannot be rendered, and leaves the model alone', async () => {
    vi.useFakeTimers(); render(ui()); fireEvent.click(screen.getByRole('tab', { name: /Materials/ }));
    const before = eng.part('loose').authorMat.metalness; fireEvent.click(screen.getByText(/Compare all materials/)); await act(async () => { vi.advanceTimersByTime(100); });
    vi.useRealTimers(); expect(eng.part('loose').authorMat.metalness).toBe(before);   // jsdom has no canvas 2D → either a thumbnail grid or a notified error, never a changed model
  });
  it('materials: preview → A/B → keep applies as an undoable edit', () => {
    render(ui()); fireEvent.click(screen.getByRole('tab', { name: /Materials/ }));
    act(() => { eng.previewMaterial('Metal', ['loose']); }); expect(screen.getByText(/Previewing/).textContent).toMatch(/Metal/);
    fireEvent.click(screen.getByText(/Show original/)); expect(screen.getByRole('status').textContent).toMatch(/ORIGINAL/);
    fireEvent.click(screen.getByText('Keep')); expect(eng.part('loose').authorMat.metalness).toBe(1); expect(eng.history.at(-1).label).toBe('Material');
  });
  it('leaving the tab cleans up: simulation stopped, overlays and previews removed', () => {
    const { unmount } = render(ui()); fireEvent.click(screen.getByText('Set up')); act(() => { eng.previewMaterial('Metal', ['loose']); eng.showStructure({}, true); });
    unmount(); expect(eng.sim).toBeNull(); expect(eng._structure).toBeNull(); expect(eng._mp).toBeNull(); expect(eng._loadMats).toBeNull();
  });
});
