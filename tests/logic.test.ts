import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addBonus, aggregate, canAskGakkun, deleteBonus, emptyPrefs, endSession, exportBackup, isComplete, isResetFlashTarget,
  bellTail, bellTarget, setBonusBells, newSession, normalizeSession, parseBackup, setBellTotal, setBonusType, setMid, shareDetail, shareSimple, timeline,
  totalBells, totalGames, updateBonus,
} from '../src/logic';
import { getMachine, MACHINES } from '../src/machines';
import { buildSample } from '../src/sample';
import { loadState, saveState } from '../src/storage';
import type { AppState } from '../src/types';

const s0 = (machineId = 'new-king-v30') => newSession({ store: 'テスト店', tableNo: '1', machineId });
const NK = getMachine('new-king-v30');
const STAR = getMachine('star-30');

describe('機種定義', () => {
  it('ニューハナハナゴールドは選択肢にない', () => {
    expect(MACHINES.map((m) => m.id)).toEqual(['new-king-v30', 'star-30', 'king-30', 'dragon-30', 'houou-30']);
  });
  it('ニューキングV：BIG前半スイカ・後半サイド・終了(紫あり)、REG中スイカ・終了(虹なし)、REGサイドなし', () => {
    expect(NK.big.side.colors).toEqual(['blue', 'yellow', 'green', 'red', 'rainbow']);
    expect(NK.big.end.colors).toEqual(['white', 'blue', 'yellow', 'green', 'purple', 'rainbow']);
    expect(NK.reg.end.colors).toEqual(['white', 'blue', 'yellow', 'green', 'purple']);
    expect(NK.reg.side.support).toBe('not_applicable');
    expect(NK.big.side.miss).toBe(true);
  });
  it('スター等：BIG中スイカ・終了(赤あり)、REG中サイド(ミス可)・終了、BIGサイド/REGスイカなし', () => {
    for (const id of ['star-30', 'king-30', 'dragon-30', 'houou-30']) {
      const m = getMachine(id);
      expect(m.big.side.support).toBe('not_applicable');
      expect(m.reg.suika.support).toBe('not_applicable');
      expect(m.reg.side.miss).toBe(true);
      expect(m.big.end.colors).toEqual(['white', 'blue', 'yellow', 'green', 'red', 'rainbow']);
      expect(m.reg.end.colors).toEqual(['white', 'blue', 'yellow', 'green', 'red', 'rainbow']);
    }
  });
});

describe('1-2. 仮登録と二重加算防止', () => {
  it('入力G→BIG/REGで1件追加・累計更新、詳細は未記録(null)のまま', () => {
    let s = addBonus(s0(), 'BIG', 180);
    expect(aggregate(s).big).toBe(1);
    expect(aggregate(s).total).toBe(180);
    const b = s.bonuses[0];
    expect([b.suika, b.side, b.end, b.retroRight]).toEqual([null, null, null, null]);
    s = addBonus(s, 'REG', 20);
    expect(s.bonuses[1].retroRight).toBeNull(); // REGにもレトロあり
    expect(s.bonuses[1].side).toBe('not_applicable'); // ニューキングVはREG中サイドなし
  });
  it('詳細確定してもボーナス回数・Gは増えない', () => {
    let s = addBonus(s0(), 'BIG', 180);
    const id = s.bonuses[0].id;
    s = updateBonus(s, id, { suika: 1, side: 'green', end: 'white', retroRight: true, retroActual: false });
    s = updateBonus(s, id, { side: 'red' });
    const a = aggregate(s);
    expect([a.big, a.reg, a.total]).toEqual([1, 0, 180]);
    expect(a.bigSide.counts.red).toBe(1);
    expect(a.bigSide.counts.green).toBe(0);
  });
  it('REGもレトロ権利が入力完了の条件', () => {
    let s = addBonus(s0(), 'REG', 50);
    s = updateBonus(s, s.bonuses[0].id, { suika: 0, end: 'white' });
    expect(isComplete(s.bonuses[0], NK)).toBe(false);
    s = updateBonus(s, s.bonuses[0].id, { retroRight: false });
    expect(isComplete(s.bonuses[0], NK)).toBe(true);
  });
});

describe('ミス（判別不可）', () => {
  it('ニューキングBIG後半・スターREG中サイドでミスを記録し、未記録と別集計', () => {
    let s = addBonus(addBonus(s0(), 'BIG', 10), 'BIG', 20);
    s = updateBonus(s, s.bonuses[0].id, { side: 'miss' });
    const a = aggregate(s).bigSide;
    expect([a.miss, a.unrecorded]).toEqual([1, 1]);
    let t = addBonus(s0('star-30'), 'REG', 30);
    t = updateBonus(t, t.bonuses[0].id, { side: 'miss', end: 'white', retroRight: false });
    expect(isComplete(t.bonuses[0], STAR)).toBe(true);
    expect(shareSimple(t)).toContain('REG中サイド：🟦0🟡0🟢0🟥0🌈0（ミス1）');
  });
});

describe('3-4. スイカ・ランプ集計', () => {
  it('スイカ2回が累計に反映、未記録と0回を区別', () => {
    let s = addBonus(addBonus(addBonus(s0(), 'BIG', 10), 'BIG', 20), 'BIG', 30);
    s = updateBonus(s, s.bonuses[0].id, { suika: 2 });
    s = updateBonus(s, s.bonuses[1].id, { suika: 0 });
    const a = aggregate(s).bigSuika;
    expect([a.sum, a.recorded, a.unrecorded]).toEqual([2, 2, 1]);
  });
});

describe('5. ベル（累計入力→当選時に記録）', () => {
  it('ベル累計を入れてから当選→その当選に累計を記録、履歴は差分と確率', () => {
    let s = setBellTotal(s0(), 20);
    s = setBellTotal(s, 25); // 置き換え（加算しない）
    expect(totalBells(s)).toBe(25);
    s = addBonus(s, 'BIG', 180);
    expect(s.bonuses[0].bellsAt).toBe(25);
    expect(s.bellPending).toBe(false);
    s = setBellTotal(s, 35);
    s = addBonus(s, 'REG', 70);
    const rows = timeline(s);
    expect([rows[0].bellDiff, rows[1].bellDiff]).toEqual([25, 10]);
    expect(rows[0].bellRatio).toBeCloseTo(7.2);
    expect(rows[1].bellRatio).toBeCloseTo(7.0);
    expect(totalBells(s)).toBe(35);
    expect(aggregate(s).bellRatio).toBeCloseTo(250 / 35);
  });
  it('ベル累計を入れ忘れた当選は未記録、次の入力時に2区間ぶんの差分として表示', () => {
    let s = setBellTotal(s0(), 30);
    s = addBonus(s, 'BIG', 210);
    s = addBonus(s, 'REG', 100); // 入れ忘れ
    s = setBellTotal(s, 90);
    s = addBonus(s, 'BIG', 320);
    const r = timeline(s);
    expect(r[1].bellDiff).toBeNull();
    expect([r[2].bellDiff, r[2].bellGames, r[2].bellSpan]).toEqual([60, 420, 2]);
    expect(r[2].bellRatio).toBeCloseTo(7);
  });
  it('当選後にベル累計を修正すると差分・確率も更新', () => {
    let s = addBonus(s0(), 'BIG', 210); // ベル未入力で登録
    expect(timeline(s)[0].bellDiff).toBeNull();
    s = updateBonus(s, s.bonuses[0].id, { bellsAt: 35 });
    expect(timeline(s)[0].bellDiff).toBe(35);
    expect(totalBells(s)).toBe(35);
    expect(aggregate(s).bellRatio).toBeCloseTo(6);
  });
  it('順番自由：当選後にベル累計を入れるとその当選に記録', () => {
    let s = addBonus(s0(), 'BIG', 160);
    expect(bellTarget(s)?.id).toBe(s.bonuses[0].id);
    s = setBonusBells(s, s.bonuses[0].id, 23);
    expect(s.bonuses[0].bellsAt).toBe(23);
    expect([s.bellTotal, s.bellPending]).toEqual([23, false]);
    expect(bellTarget(s)).toBeNull();
    s = addBonus(setBellTotal(s, 32), 'REG', 70); // 先に入れた場合は従来どおり
    expect(bellTarget(s)).toBeNull();
    expect(timeline(s)[1].bellDiff).toBe(9);
    s = setMid(addBonus(s, 'REG', 40), 100); // 途中保存したら対象外
    expect(bellTarget(s)).toBeNull();
  });
  it('ヤメ時のベル累計は最終区間として扱う', () => {
    let s = addBonus(setBellTotal(s0(), 30), 'BIG', 210);
    s = endSession(setBellTotal(s, 50), 140);
    const t = bellTail(s);
    expect([t.diff, t.games]).toEqual([20, 140]);
    expect(aggregate(s).bellRatio).toBeCloseTo(350 / 50);
  });
});

describe('ガックン・リセフラ', () => {
  it('累計0G台のみガックン入力可、1回目BIGのみリセフラ対象（REGは含めない）', () => {
    let s = s0();
    expect(canAskGakkun(s)).toBe(true);
    s = addBonus(s, 'REG', 30);
    expect(canAskGakkun(s)).toBe(false);
    s = addBonus(addBonus(s, 'BIG', 100), 'BIG', 50);
    expect(isResetFlashTarget(s, s.bonuses[0].id)).toBe(false);
    expect(isResetFlashTarget(s, s.bonuses[1].id)).toBe(true);
    expect(isResetFlashTarget(s, s.bonuses[2].id)).toBe(false);
    const used = newSession({ seatTotalGames: 1500, seatBig: 3 });
    const u2 = addBonus(used, 'BIG', 10);
    expect(canAskGakkun(used)).toBe(false);
    expect(isResetFlashTarget(u2, u2.bonuses[0].id)).toBe(false);
  });
});

describe('6-7. 途中保存・ヤメ・着席時基準', () => {
  it('400G途中保存→550GでBIGは550だけ加算', () => {
    let s = addBonus(s0(), 'REG', 100);
    s = setMid(s, 400);
    expect(totalGames(s)).toBe(500);
    s = addBonus(s, 'BIG', 550);
    expect(s.midGames).toBeNull();
    expect(totalGames(s)).toBe(650);
  });
  it('累計5,765Gから284Gヤメで6,049G', () => {
    expect(totalGames(endSession(addBonus(s0(), 'BIG', 5765), 284))).toBe(6049);
  });
  it('着席時の表示カウンターを最初の当選で二重加算しない', () => {
    let s = newSession({ seatTotalGames: 2000, seatCurrentGames: 120, seatBig: 5, seatReg: 4 });
    expect(totalGames(s)).toBe(2000);
    s = setMid(s, 300);
    expect(totalGames(s)).toBe(2180);
    s = addBonus(s, 'BIG', 350);
    expect(totalGames(s)).toBe(2230);
    const a = aggregate(s);
    expect([a.big, a.myBig, a.myGames]).toEqual([6, 1, 230]);
  });
});

describe('8. 履歴修正', () => {
  it('当選G修正・削除で後続累計が更新される', () => {
    let s = s0();
    [14, 8, 43, 476].forEach((g, i) => (s = addBonus(s, i % 2 ? 'BIG' : 'REG', g)));
    expect(timeline(s).map((r) => r.cumTotal)).toEqual([14, 22, 65, 541]);
    s = updateBonus(s, s.bonuses[1].id, { games: 18 });
    expect(timeline(s).map((r) => r.cumTotal)).toEqual([14, 32, 75, 551]);
    s = deleteBonus(s, s.bonuses[0].id);
    expect(timeline(s).map((r) => r.cumTotal)).toEqual([18, 61, 537]);
  });
  it('種別修正：新種別で無効な値は未記録に戻す・二重加算しない', () => {
    let s = addBonus(s0(), 'BIG', 100);
    s = updateBonus(s, s.bonuses[0].id, { suika: 1, side: 'blue', end: 'rainbow', retroRight: true, retroActual: false });
    s = setBonusType(s, s.bonuses[0].id, 'REG');
    const b = s.bonuses[0];
    expect(b.type).toBe('REG');
    expect(b.suika).toBe(1); // REG中スイカとして有効
    expect(b.side).toBe('not_applicable'); // ニューキングVはREG中サイドなし
    expect(b.end).toBeNull(); // REG終了に虹はない
    expect(b.retroRight).toBe(true);
    const a = aggregate(s);
    expect([a.big, a.reg, a.total]).toEqual([0, 1, 100]);
  });
});

describe('13. サンプル実戦（10/25）の最終値', () => {
  const s = buildSample();
  const a = aggregate(s);
  it('集計値が指示書の最終値と一致', () => {
    expect(s.bonuses.length).toBe(31);
    expect([a.total, a.big, a.reg, a.bells]).toEqual([6049, 16, 15, 876]);
    expect([a.bigSuika.sum, a.regSuika.sum]).toEqual([10, 3]);
    expect(a.bigSide.counts).toMatchObject({ blue: 6, yellow: 4, green: 3, red: 3, rainbow: 0 });
    expect(a.bigEnd.counts).toMatchObject({ white: 15, blue: 1 });
    expect(a.regEnd.counts).toMatchObject({ white: 14, blue: 1 });
    expect([a.bigRetroRight.yes, a.bigRetroActual.yes]).toEqual([16, 1]);
    expect(s.endGames).toBe(284);
  });
  it('10. 簡易共有テキスト', () => {
    expect(shareSimple(s)).toBe(
      [
        '日付：2026/10/25', '店舗：タイホウ篭山', '台番：1625', '機種：ニューキングV-30', '',
        '累計6049G｜B16/R15｜🔔876(1/6.9)｜🍉B10/R3', '',
        'BIG後半：🟦6🟡4🟢3🟥3🌈0', 'BIG終了：🤍15🟦1', 'REG終了：🤍14🟦1',
        'レトロ：BIG権利16/発生1・REG権利0/発生0',
      ].join('\n'),
    );
  });
  it('10. 詳細共有に全31件・区間ベル・最終ハマリ', () => {
    const t = shareDetail(s);
    const rows = t.split('\n').filter((l) => /^\d+\|/.test(l));
    expect(rows.length).toBe(31);
    expect(rows[0]).toMatch(/^1\|\d\d:\d\d\|REG\|14\|14\|2\|2\|1\/7\.0\|0\|-\|🤍/);
    expect(rows[30]).toMatch(/\|BIG\|407\|5765\|/);
    expect(t).toContain('最終ハマリ：284G（ヤメ）');
    expect(t).toContain('BIGレトロ権利：あり16・なし0・未記録0／実発生：あり1・なし15・未記録0');
    expect(t).toMatch(/ヤメ\|\d\d:\d\d\|-\|284\|6049\|876\|\d+\|1\//);
  });
});

describe('9・11. 保存・バックアップ・旧データ移行', () => {
  const mk = (): AppState => {
    const st: AppState = { version: 1, sessions: [buildSample(), addBonus(s0(), 'BIG', 99)], activeId: null, prefs: emptyPrefs() };
    st.activeId = st.sessions[1].id;
    st.prefs = { stores: ['テスト新店'], storeRates: { タイホウ篭山: 47 } };
    return st;
  };
  it('JSONバックアップ→復元で完全一致', () => {
    const st = mk();
    const back = parseBackup(exportBackup(st));
    expect(back).toEqual(st);
    expect(shareDetail(back.sessions[0])).toBe(shareDetail(st.sessions[0]));
  });
  it('旧形式（累計ベル・ゴールド）を読み込める', () => {
    const old = normalizeSession({ machineId: 'newgold-30', bells: 307, bonuses: [{ type: 'REG', games: 10, retroRight: 'not_applicable' }] });
    expect(old.machineId).toBe('new-king-v30');
    expect(totalBells(old)).toBe(307);
    expect(old.bonuses[0].bellsAt).toBeNull();
  });
  it('前回版（区間ベル）を累計に変換して読み込める', () => {
    const v2 = normalizeSession({ bellsBase: 0, curBells: 9, bonuses: [{ type: 'BIG', games: 160, bells: 23 }, { type: 'REG', games: 70, bells: 9 }] });
    expect(v2.bonuses.map((b) => b.bellsAt)).toEqual([23, 32]);
    expect([v2.bellTotal, v2.bellPending]).toEqual([41, true]);
    expect((v2.bonuses[0] as any)._oldBells).toBeUndefined();
  });
  it('IndexedDB に保存→再読込で一致', async () => {
    const st = mk();
    expect(await saveState(st)).toBe('idb');
    const { state } = await loadState();
    expect(state).toEqual(st);
  });
});
