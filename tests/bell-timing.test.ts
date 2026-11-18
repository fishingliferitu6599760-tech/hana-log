import { describe, expect, it } from 'vitest';
import {
  addBonus, aggregate, bellObservations, bellSummary, checkBellAt, deleteBonus, endSession, endBellPoint, exportBackup,
  emptyPrefs, newSession, normalizeSession, parseBackup, previewEnd, probText2, reopenSession, sessionIssues, setMid,
  shareDetail, shareSimple, timeline, totalBells, totalGames,
} from '../src/logic';
import { bellSegments, windowCompare } from '../src/analysis';
import type { Session } from '../src/types';

const s0 = (p: Partial<Session> = {}) => newSession({ machineId: 'star-30', ...p });

describe('1. ベル累計はG時点とセット', () => {
  it('200G・30回で途中保存 → 300Gでベル未入力のまま当選：300Gは未記録、最終実測は200G・30回（1/6.67）', () => {
    let s = setMid(s0(), 200, undefined, 30);
    s = addBonus(s, 'BIG', 300);
    expect(s.bonuses[0].bellsAt).toBeNull(); // コピーしない
    expect(timeline(s)[0].bellDiff).toBeNull();
    const b = bellSummary(s);
    expect([b.obs?.my, b.obs?.bells, b.obs?.kind]).toEqual([200, 30, 'mid']);
    expect(aggregate(s).bellRatio).toBeCloseTo(200 / 30, 10); // 内部精度は維持
    expect(b.ratio).toBe('1/6.67');
    expect(b.scope).toBe('200G・30回まで'); // 最終実測が現在より前
    expect(shareSimple(s)).toContain('🔔30(1/6.67・自分200G時点まで)');
  });
  it('200G・30回で途中保存 → 300Gでベル未入力のまま終了：同じく200G・30回が最終実測', () => {
    let s = setMid(s0(), 200, undefined, 30);
    s = endSession(s, 300);
    expect(endBellPoint(s)).toBeNull();
    expect(bellSummary(s).ratio).toBe('1/6.67');
    expect(bellSummary(s).scope).toBe('200G・30回まで');
    expect(totalGames(s)).toBe(300);
  });
  it('過去の観測を保持（途中保存を複数回→当選→その後の差分は直前の観測から）', () => {
    let s = setMid(s0(), 100, undefined, 15);
    s = setMid(s, 200, undefined, 30);
    s = addBonus(s, 'REG', 260, undefined, 38);
    const obs = bellObservations(s);
    expect(obs.map((o) => [o.kind, o.my, o.bells])).toEqual([['mid', 100, 15], ['mid', 200, 30], ['bonus', 260, 38]]);
    const r = timeline(s)[0];
    expect([r.bellDiff, r.bellGames, r.bellFrom]).toEqual([8, 60, 'mid']);
    expect(shareDetail(s)).toContain('■ベル観測記録');
  });
  it('入力経路を区別：当選時・後入力・途中保存・終了時', () => {
    let s = addBonus(s0(), 'BIG', 100, undefined, 14);
    s = addBonus(s, 'REG', 100);
    s = { ...s, bonuses: s.bonuses.map((b, i) => (i === 1 ? { ...b, bellsAt: 29, bellsSrc: 'late' as const } : b)) };
    s = setMid(s, 50, undefined, 36);
    s = endSession(s, 90, undefined, 42);
    expect(bellObservations(s).map((o) => o.kind)).toEqual(['bonus', 'late', 'mid', 'end']);
  });
  it('矛盾する値は検出（保存前チェック）、0回は観測済み0として保持', () => {
    const s = addBonus(s0(), 'BIG', 200, undefined, 30);
    expect(checkBellAt(s, 300, 25)).toContain('30回より少なく');
    expect(checkBellAt(s, 300, 30)).toBeNull();
    const z = endSession(s0(), 6, undefined, 0);
    expect(totalBells(z)).toBe(0);
    expect(bellSummary(z)).toMatchObject({ count: '0回', ratio: '—' });
    expect(bellSummary(s0())).toMatchObject({ count: '未記録', ratio: '—' });
  });
});

describe('2. 表示は小数第2位、内部精度は維持', () => {
  it('probText2', () => {
    expect(probText2(200 / 30)).toBe('1/6.67');
    expect(probText2(null)).toBe('—');
  });
});

describe('3. 終了画面の計算', () => {
  it('途中着席で当たりなし：749G・当選間235Gで着席→300Gヤメは自分65G／台814G', () => {
    const s = s0({ seatTotalGames: 749, seatCurrentGames: 235 });
    expect(previewEnd(s, 300)).toEqual({ total: 814, my: 65, error: null });
    expect(previewEnd(s, 200).error).toContain('235G');
    const e = endSession(s, 300, undefined, 10);
    expect(bellSummary(e).ratio).toBe('1/6.50');
    expect(aggregate(e).myGames).toBe(65);
  });
  it('終了時ベル：入力あり／空欄／0回', () => {
    const base = addBonus(s0(), 'BIG', 100, undefined, 15);
    expect(bellSummary(endSession(base, 200, undefined, 45)).ratio).toBe(probText2(300 / 45));
    const blank = endSession(base, 200);
    expect(bellSummary(blank)).toMatchObject({ ratio: probText2(100 / 15), scope: '100G・15回まで' });
    // 0回は前回15回より少ない → 終了画面で保存前に止める（checkBellAt）。もし保存されても要確認として表示
    expect(checkBellAt(base, 300, 0)).toContain('15回より少なく');
    expect(sessionIssues(endSession(base, 200, undefined, 0)).join()).toContain('前の記録より少ない');
  });
  it('終了済みログの修正：ヤメGと終了時ベルをまとめて修正、未記録にもできる', () => {
    let s = endSession(addBonus(s0(), 'BIG', 100, undefined, 15), 200, undefined, 45);
    const id = s.id;
    s = endSession(s, 250, undefined, 45); // 同じベル値を「修正後のG時点の値」として確認したうえで保存
    expect([s.endGames, endBellPoint(s)?.counter, endBellPoint(s)?.bells, s.id]).toEqual([250, 250, 45, id]);
    expect((s.bellObs ?? []).filter((p) => p.src === 'end')).toHaveLength(1);
    s = endSession(s, 250, undefined, null);
    expect(endBellPoint(s)).toBeNull();
    expect(bellSummary(s).scope).toBe('100G・15回まで');
  });
  it('再開すると終了時ベルは途中保存の観測として残る', () => {
    const s = reopenSession(endSession(addBonus(s0(), 'BIG', 100, undefined, 15), 200, undefined, 45));
    expect(s.endGames).toBeNull();
    expect(bellObservations(s).map((o) => o.kind)).toEqual(['bonus', 'mid']);
  });
  it('当選の削除でベル観測の位置は変わらない', () => {
    let s = addBonus(addBonus(s0(), 'BIG', 100, undefined, 15), 'REG', 80);
    s = setMid(s, 50, undefined, 35);
    const before = bellObservations(s).map((o) => o.x);
    s = deleteBonus(s, s.bonuses[1].id);
    expect(bellObservations(s).map((o) => o.x)).toEqual(before);
  });
});

describe('4. 区間比較', () => {
  const build = () => {
    let s = s0();
    // 自分の実戦 0..2500G。1500G（直近1,000Gの境界）ちょうどで当選
    s = addBonus(s, 'BIG', 400, undefined, 60);
    s = addBonus(s, 'REG', 600, undefined, 150);
    s = addBonus(s, 'BIG', 500, undefined, 220); // 1500G＝境界
    s = addBonus(s, 'REG', 300, undefined, 265);
    s = addBonus(s, 'BIG', 400);
    return endSession(s, 300, undefined, 360);
  };
  it('重ならない区間・境界の当選を二重計上しない', () => {
    const wc = windowCompare(build())!;
    expect(wc.map((w) => [w.fromMy, w.toMy])).toEqual([[500, 1500], [1500, 2500]]);
    expect(wc.map((w) => [w.big, w.reg])).toEqual([[1, 1], [1, 1]]); // 1500Gの当選は「その前」にだけ入る
  });
  it('ベルは区間内に完全に入る実測区間だけ（推定しない）', () => {
    const s = build();
    const segs = bellSegments(s);
    expect(segs.map((g) => [g.fromMy, g.toMy, g.bells, g.gap])).toEqual([[0, 400, 60, false], [400, 1000, 90, false], [1000, 1500, 70, false], [1500, 1800, 45, false], [1800, 2500, 95, true]]);
    const wc = windowCompare(s)!;
    expect(wc[0].bell).toEqual({ games: 500, bells: 70, ratio: 500 / 70 }); // 1000〜1500のみ（500〜1000は区間外にはみ出すので除外）
    expect(wc[1].bell?.games).toBe(1000);
    expect(windowCompare(addBonus(s0(), 'BIG', 1999))).toBeNull();
  });
});

describe('5. 旧データの復元', () => {
  const oldSession = (p: Record<string, unknown>) => ({
    id: 'keep-id', machineId: 'star-30', seatTotalGames: 0, seatCurrentGames: 0, seatBig: 0, seatReg: 0,
    bonuses: [
      { id: 'b1', type: 'BIG', games: 100, bellsAt: 15, suika: 0, side: 'not_applicable', end: 'white' },
      { id: 'b2', type: 'REG', games: 50, bellsAt: null, suika: 'not_applicable', side: 'miss', end: null },
    ],
    ...p,
  });
  it('終了済み（旧：最新ベル＋未記録フラグ）→ ヤメG時点の終了時ベルとして移行（ユーザー確認済み）', () => {
    const s = normalizeSession(oldSession({ bellTotal: 40, bellPending: true, endGames: 120, endedAt: '2026-11-08T05:00:00Z' }));
    expect(s.id).toBe('keep-id');
    const e = endBellPoint(s)!;
    expect([e.after, e.counter, e.bells, e.migrated]).toEqual(['b2', 120, 40, true]);
    expect(bellSummary(s).obs?.my).toBe(270);
    expect(s.legacy).toMatchObject({ bellTotal: 40, bellPending: true }); // 原データ保持
  });
  it('途中保存中（旧）→ 途中保存G時点の観測として移行', () => {
    const s = normalizeSession(oldSession({ bellTotal: 30, bellPending: true, midGames: 80 }));
    expect(bellObservations(s).slice(-1)[0]).toMatchObject({ kind: 'mid', my: 230, bells: 30 });
  });
  it('時点を確定できない旧ベル値は要確認（確率に使わない）', () => {
    const s = normalizeSession(oldSession({ bellTotal: 30, bellPending: true }));
    expect(s.legacyBell?.bells).toBe(30);
    expect(totalBells(s)).toBe(15);
    expect(sessionIssues(s).join()).toContain('時点不明の旧ベル値 30回');
  });
  it('未記録・0・対象外・判別不可の区別を保つ', () => {
    const s = normalizeSession(oldSession({ bellTotal: 15, bellPending: false }));
    const [b1, b2] = s.bonuses;
    expect([b1.suika, b1.side, b2.suika, b2.side, b2.end, b2.bellsAt]).toEqual([0, 'not_applicable', 'not_applicable', 'miss', null, null]);
  });
  it('負のG数・逆行したベル累計は補正せず要確認', () => {
    const s = normalizeSession({
      id: 'x', seatTotalGames: 500, seatCurrentGames: 120, bellTotal: 10, bellPending: false,
      bonuses: [{ id: 'a', type: 'BIG', games: 80, bellsAt: 20 }, { id: 'b', type: 'REG', games: 90, bellsAt: 12 }],
    });
    expect(s.bonuses.map((b) => [b.games, b.bellsAt])).toEqual([[80, 20], [90, 12]]); // 値はそのまま
    const issues = sessionIssues(s).join('\n');
    expect(issues).toContain('負のG数');
    expect(issues).toContain('前の記録より少ない');
  });
  it('現行形式の往復（保存→復元）で完全一致', () => {
    let s = setMid(addBonus(s0({ seatTotalGames: 749, seatCurrentGames: 235 }), 'BIG', 418, undefined, 21), 120, undefined, 40);
    s = endSession(s, 209, undefined, 70);
    const st = { version: 1 as const, sessions: [s], activeId: null, prefs: emptyPrefs() };
    expect(parseBackup(exportBackup(st))).toEqual(st);
  });
});
