// Build 9 phase 4: the model files the game asks for are all in the build, and the download stays small.
import { describe, expect, it } from 'vitest';
import { FILES } from '../src/render/kit';

const urls = import.meta.glob('../public/models/**/*', { query: '?url', eager: true, import: 'default' }) as Record<string, string>;

describe('model kit', () => {
  it('has every model the loader requests, plus textures and credits', () => {
    const have = Object.keys(urls);
    for (const f of Object.values(FILES).flat()) expect(have, f).toContain(`../public/models/${f}.glb`);
    for (const k of ['sub', 'ind', 'car']) expect(have).toContain(`../public/models/${k}/Textures/colormap.png`);
    expect(have).toContain('../public/models/CREDITS.txt');
  });
  it('ships a small, fixed set of models (about 2.4 MB on disk)', () => {
    const glb = Object.keys(urls).filter((u) => u.endsWith('.glb'));
    expect(glb.length).toBe(Object.values(FILES).flat().length);
    expect(glb.length).toBeLessThanOrEqual(40);
  });
});
