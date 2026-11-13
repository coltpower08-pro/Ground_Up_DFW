import { describe, expect, it } from 'vitest';
import { AIRPORTS, RAILS, ROADS } from '../src/render/layout';

describe('map layout', () => {
  it('no highway or railroad runs across an airport', () => {
    const hits: string[] = [];
    const lines = [...ROADS.map((r) => ({ name: r.name, pts: r.pts })), ...RAILS.map((pts, i) => ({ name: `rail ${i}`, pts }))];
    for (const a of AIRPORTS) for (const l of lines) for (let i = 0; i < l.pts.length - 1; i++) for (let t = 0; t <= 1; t += 0.02) {
      const x = l.pts[i][0] + (l.pts[i + 1][0] - l.pts[i][0]) * t, y = l.pts[i][1] + (l.pts[i + 1][1] - l.pts[i][1]) * t;
      if (x > a.x - 0.35 && x < a.x + Math.ceil(a.w) + 0.35 && y > a.y - 0.35 && y < a.y + Math.ceil(a.h) + 0.35) { hits.push(`${l.name} x ${a.name}`); break; }
    }
    expect([...new Set(hits)]).toEqual([]);
  });
});
