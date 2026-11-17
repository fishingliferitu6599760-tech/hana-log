import { describe, expect, it } from 'vitest';
import {
  bellSeries, bonusSeries, combinedSeries, countsAt, lampStat, recentWindow, suikaSeries, supportComments,
} from '../src/analysis';
import { addBonus, aggregate, newSession, shareDetail, shareSimple, timeline, updateBonus } from '../src/logic';


import { build1115 } from './fixtures/s1115';

const CHECK = [
  [727, 4, 3, 111], [1421, 6, 6, 200], [1625, 6, 8, 229], [2107, 7, 8, 291], [2393, 7, 10, 331], [2695, 8, 10, 368], [2949, 8, 10, 404],
] as const;

describe('11/15 検証データ', () => {
  const s = build1115();
  const a = aggregate(s);
  it('最終値が一致（2949G・B8・R10・ベル404・スイカ5・REGサイド・終了ランプ）', () => {
    expect([a.total, a.big, a.reg, a.bells, a.bigSuika.sum]).toEqual([2949, 8, 10, 404, 5]);
    expect(a.regSide.counts).toMatchObject({ blue: 4, yellow: 5, green: 0, red: 1 });
    expect(a.bigEnd.counts.white).toBe(7);
    expect(a.bigEnd.excluded).toBe(1); // 初回BIGのリセットフラッシュは除外
    expect(a.regEnd.counts.white).toBe(10);
  });
  it('1. 累計BIG・REGが各地点で一致（グラフの階段の値）', () => {
    const bs = bonusSeries(s);
    for (const [x, big, reg] of CHECK) expect(countsAt(bs, x)).toEqual({ big, reg });
    expect(bs.xEnd).toBe(2949);
    expect(bs.hamari).toBe(254); // 3. 非当選区間（最終当選後のハマリ）も表現
    expect(countsAt(bs, 2694)).toEqual({ big: 7, reg: 10 });
  });
  it('2. ベル確率が観測点ごとに正確（未記録区間は点を作らない）', () => {
    const obs = bellSeries(s);
    expect(obs.map((o) => [o.x, o.bells])).toEqual(CHECK.map(([x, , , b]) => [x, b]));
    const exp = CHECK.map(([x, , , b]) => x / b);
    obs.forEach((o, i) => expect(o.ratio).toBeCloseTo(exp[i], 10));
    expect(obs[0].gapBefore).toBe(false);
    expect(obs[1].gapBefore).toBe(true); // 間にベル未記録の当選あり
    expect(obs[6].label).toBe('ヤメ');
  });
  it('合算確率：当選地点で厳密値（のこぎり型）', () => {
    const pts = combinedSeries(bonusSeries(s));
    const at = (x: number) => pts.filter((p) => p.x === x).map((p) => p.y);
    expect(at(727)[1]).toBeCloseTo(727 / 7);
    expect(pts[pts.length - 1]).toEqual({ x: 2949, y: 2949 / 18 });
  });
  it('4. BIG中スイカの分母に未記録BIGを入れない', () => {
    let t = updateBonus(s, s.bonuses.find((b) => b.type === 'BIG')!.id, { suika: null });
    const ss = suikaSeries(t);
    const last = ss.pts[ss.pts.length - 1];
    expect([last.recorded, last.sum, last.unrecorded]).toEqual([7, 4, 1]);
    expect(last.avg).toBeCloseTo(4 / 7);
    t = s;
    const full = suikaSeries(t).pts;
    expect(full[full.length - 1].avg).toBeCloseTo(5 / 8);
  });
  it('5・6. ランプ色別集計が記録と一致・リセフラ除外を維持', () => {
    const rs = lampStat(s, 'regSide');
    expect(rs.counts).toMatchObject({ blue: 4, yellow: 5, green: 0, red: 1 });
    expect([rs.observed, rs.unrecorded, rs.events.length]).toEqual([10, 0, 10]);
    const be = lampStat(s, 'bigEnd');
    expect([be.counts.white, be.observed, be.excluded]).toEqual([7, 7, 1]);
    const re = lampStat(s, 'regEnd');
    expect(re.counts.white).toBe(10);
    // ホウオウはBIG中サイドなし・REG中スイカなし（既存の機種別仕様）
    expect(lampStat(s, 'regSide').support).toBe('supported');
  });
  it('7. グラフの値と詳細ログ・集計が一致', () => {
    const d = shareDetail(s);
    const bs = bonusSeries(s);
    const rows = timeline(s);
    rows.forEach((r, i) => {
      expect(bs.steps[i].x).toBe(r.cumTotal);
      expect(d).toContain(`${r.no}|`);
      expect(d).toContain(`|${r.bonus.type}|${r.bonus.games}|${r.cumTotal}|`);
    });
    expect(shareSimple(s)).toContain('累計2949G｜B8/R10｜🔔404(1/7.3)');
    expect(shareSimple(s)).toContain('REG中サイド：🟦4🟡5🟢0🟥1🌈0');
  });
});

describe('欠損・修正・削除・データ不足', () => {
  it('未記録・0回・対象外を区別', () => {
    let s = newSession({ machineId: 'new-king-v30' });
    s = addBonus(addBonus(addBonus(s, 'REG', 100), 'REG', 50), 'BIG', 30);
    s = updateBonus(s, s.bonuses[0].id, { end: 'white' });
    const re = lampStat(s, 'regEnd');
    expect([re.observed, re.unrecorded]).toEqual([1, 1]);
    expect(lampStat(s, 'regSide').support).toBe('not_applicable'); // ニューキングVはREG中サイドなし
    s = updateBonus(s, s.bonuses[2].id, { suika: 0 });
    expect(suikaSeries(s).pts[0]).toMatchObject({ avg: 0, recorded: 1 });
  });
  it('履歴の修正・削除がグラフに反映', () => {
    let s = addBonus(addBonus(newSession(), 'BIG', 100, undefined, 15), 'REG', 200, undefined, 45);
    s = updateBonus(s, s.bonuses[0].id, { games: 150 });
    expect(bonusSeries(s).steps.map((x) => x.x)).toEqual([150, 350]);
    expect(bellSeries(s)[1].ratio).toBeCloseTo(350 / 45);
    s = { ...s, bonuses: s.bonuses.slice(1) };
    expect(bonusSeries(s).steps.map((x) => [x.x, x.big, x.reg])).toEqual([[200, 0, 1]]);
  });
  it('着席時の値を起点にする', () => {
    const s = addBonus(newSession({ seatTotalGames: 2000, seatCurrentGames: 120, seatBig: 5, seatReg: 4 }), 'BIG', 350);
    const bs = bonusSeries(s);
    expect([bs.x0, bs.big0, bs.reg0, bs.steps[0].x, bs.steps[0].big]).toEqual([2000, 5, 4, 2230, 6]);
    expect(countsAt(bs, 2100)).toEqual({ big: 5, reg: 4 });
  });
  it('判断サポート：材料不足の案内・断定表現なし・直近区間は算出可能な場合のみ', () => {
    const few = addBonus(newSession(), 'BIG', 100);
    expect(supportComments(few)[0]).toContain('十分な材料がありません');
    expect(recentWindow(few, 1000)).toBeNull();
    const s = build1115();
    const c = supportComments(s).join('\n');
    expect(c).not.toMatch(/設定[1-6]|確定|やめ|続行|撤退/);
    expect(recentWindow(s, 1000)).toEqual({ from: 1949, to: 2949, big: 2, reg: 2 }); // 2107B・2317R・2393R・2695B
  });
});
