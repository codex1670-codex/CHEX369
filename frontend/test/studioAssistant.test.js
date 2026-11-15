import { describe, it, expect } from 'vitest';
import { interpret } from '../src/sim3d/studio/assistant.js';

const ctx = { partNames: [{ id: 'a', name: 'Seat' }, { id: 'b', name: 'Back rest' }, { id: 'c', name: 'Leg 1' }], selected: [] };
describe('studio assistant', () => {
  it('views and modes', () => {
    expect(interpret('Show the model from the top', ctx)).toEqual({ intent: 'view', value: 'top' });
    expect(interpret('wireframe', ctx)).toEqual({ intent: 'viewMode', value: 'wireframe' });
    expect(interpret('switch to x-ray', ctx).value).toBe('xray');
  });
  it('part commands resolve names, or ask which part', () => {
    expect(interpret('hide the seat', ctx).ids).toEqual(['a']);
    expect(interpret('select back rest', ctx).ids).toEqual(['b']);
    expect(interpret('delete it', ctx).intent).toBe('clarify');
    expect(interpret('delete it', { ...ctx, selected: ['c'] }).ids).toEqual(['c']);
  });
  it('variants need a material or colour', () => {
    expect(interpret('Make a second version with a different material', ctx).intent).toBe('clarify');
    expect(interpret('make a second version in wood', ctx)).toEqual({ intent: 'variant', material: 'wood', color: undefined });
  });
  it('is honest about what it cannot do', () => {
    expect(interpret('Highlight the damaged-looking region', ctx).intent).toBe('unsupported');
    expect(interpret('bake me a cake', ctx).intent).toBe('unknown');
  });
  it('other intents', () => {
    expect(interpret('Separate the visible components', ctx).intent).toBe('split');
    expect(interpret('Create a simplified version', ctx).intent).toBe('simplify');
    expect(interpret('Measure the distance between these two points', ctx)).toEqual({ intent: 'measure', mode: 'distance' });
    expect(interpret('Explain this 3D model', ctx).intent).toBe('explain');
    expect(interpret('Prepare this model for sharing', ctx).intent).toBe('prepareShare');
  });
  it('simulation commands', () => {
    expect(interpret('drop it and see what happens', ctx).intent).toBe('simulate');
    expect(interpret('run the physics', ctx).intent).toBe('simulate');
    expect(interpret('stop the simulation', ctx).intent).toBe('simStop');
    expect(interpret('will it tip over?', ctx).intent).toBe('balance');
    expect(interpret('compare materials', ctx).intent).toBe('compareMaterials');
    expect(interpret('make a second version in wood', ctx).intent).toBe('variant');
  });
});
