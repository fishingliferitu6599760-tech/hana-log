import { describe, expect, it } from 'vitest';
import { monotoneSegments } from '../src/Analysis';
import { bellSeries, bonusSeries, combinedSeries } from '../src/analysis';
import { build1115 } from './fixtures/s1115';

/** ベジェ曲線上の点を細かくサンプリングし、各区間の両端値の範囲を超えないことを確認 */
function check(pts: Array<{ x: number; y: number }>) {
  const segs = monotoneSegments(pts);
  expect(segs).toHaveLength(pts.length - 1);
  segs.forEach((d, k) => {
    const n = d.match(/-?[\d.]+/g)!.map(Number);
    const [x0, y0] = [n[0], n[1]];
    const end = [n[n.length - 2], n[n.length - 1]];
    expect([x0, y0]).toEqual([pts[k].x, pts[k].y]); // 観測点の位置は不変
    expect(end).toEqual([pts[k + 1].x, pts[k + 1].y]);
    if (n.length === 8) {
      const [, , c1x, c1y, c2x, c2y, x1, y1] = n;
      const lo = Math.min(y0, y1) - 1e-9, hi = Math.max(y0, y1) + 1e-9;
      for (let t = 0; t <= 1; t += 0.01) {
        const u = 1 - t;
        const y = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
        const x = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
        expect(y).toBeGreaterThanOrEqual(lo);
        expect(y).toBeLessThanOrEqual(hi);
        expect(x).toBeGreaterThanOrEqual(x0 - 1e-9);
        expect(x).toBeLessThanOrEqual(x1 + 1e-9);
      }
    }
  });
}

describe('滑らかな曲線（単調3次補間）', () => {
  it('ジグザグ・急変データでも観測値を超える山や谷を作らない', () => {
    check([{ x: 0, y: 5 }, { x: 10, y: 50 }, { x: 12, y: 2 }, { x: 40, y: 2 }, { x: 41, y: 80 }, { x: 90, y: 10 }]);
  });
  it('11/15の合算・ベルの観測点で範囲内', () => {
    const s = build1115();
    const comb = combinedSeries(bonusSeries(s)).filter((q, k, arr) => k === arr.length - 1 || arr[k + 1].x !== q.x);
    check(comb);
    check(bellSeries(s).map((o) => ({ x: o.x, y: o.ratio as number })));
  });
});
