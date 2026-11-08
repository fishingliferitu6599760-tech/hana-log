import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addBonus, aggregate, endSession, exportBackup, isComplete, newSession, normalizeSession, parseBackup, setBellTotal,
  setBgm, shareDetail, timeline, totalBells, updateBonus, emptyPrefs,
} from '../src/logic';
import { getMachine } from '../src/machines';
import { computeRetro, manualMismatch } from '../src/retro';
import { nextSessionSameStore, unfinishedSessions, lastEndedSession } from '../src/home';
import { loadState, saveState } from '../src/storage';
import type { AppState, BonusType, Session } from '../src/types';

const NK = getMachine('new-king-v30');
const zero = () => newSession({ machineId: 'new-king-v30', store: 'タイホウ篭山', tableNo: '1' });
const play = (s: Session, seq: Array<[BonusType, number]>) => seq.reduce((x, [t, g]) => addBonus(x, t, g), s);
const rights = (s: Session) => s.bonuses.map((b) => computeRetro(s, NK).get(b.id)!.right);

describe('A. レトロ権利の自動判定（ニューキングV暫定ルール）', () => {
  it('0G開始・初回50G BIGは対象外で、権利入力を要求しない', () => {
    let s = play(zero(), [['BIG', 50]]);
    expect(rights(s)).toEqual(['no']);
    s = updateBonus(s, s.bonuses[0].id, { suika: 0, side: 'blue', end: 'white' });
    expect(isComplete(s.bonuses[0], NK, s)).toBe(true); // 権利もBGMも入力不要
  });
  it('0G開始・初回50G REGも同様', () => {
    let s = play(zero(), [['REG', 50]]);
    expect(rights(s)).toEqual(['no']);
    s = updateBonus(s, s.bonuses[0].id, { suika: 0, end: 'white' });
    expect(isComplete(s.bonuses[0], NK, s)).toBe(true);
  });
  it('BIG→REG→BIG（100G以内）で連続状態を維持し、2回目BIGが対象', () => {
    const s = play(zero(), [['BIG', 300], ['BIG', 400], ['REG', 40], ['BIG', 60]]);
    // 300(初回)→400(解除・1連目)→REG40(BIG1連・対象外)→BIG60(2連目・対象)
    expect(rights(s)).toEqual(['no', 'no', 'no', 'yes']);
  });
  it('BIG2連後の100G以内REGは対象', () => {
    const s = play(zero(), [['BIG', 200], ['BIG', 150], ['BIG', 30], ['REG', 80], ['REG', 100]]);
    expect(rights(s)).toEqual(['no', 'no', 'yes', 'yes', 'yes']);
  });
  it('BIG5連以上は大連続BGM優先で対象外（REGも）', () => {
    const s = play(zero(), [['BIG', 150], ['BIG', 120], ['BIG', 10], ['BIG', 20], ['BIG', 30], ['BIG', 40], ['REG', 5], ['BIG', 6]]);
    const m = computeRetro(s, NK);
    expect(rights(s)).toEqual(['no', 'no', 'yes', 'yes', 'yes', 'no', 'no', 'no']);
    expect(s.bonuses.map((b) => m.get(b.id)!.chainBig)).toEqual([1, 1, 2, 3, 4, 5, 5, 6]);
    expect(s.bonuses.map((b) => m.get(b.id)!.bigChain)).toEqual([false, false, false, false, false, true, true, true]);
  });
  it('100Gは連続、101Gで解除（境界）', () => {
    const a = play(zero(), [['BIG', 200], ['BIG', 200], ['BIG', 100]]);
    expect(rights(a)[2]).toBe('yes');
    const b = play(zero(), [['BIG', 200], ['BIG', 200], ['BIG', 101]]);
    expect(rights(b)[2]).toBe('no');
  });
  it('着席前の履歴が不明な台は、101G以上で解除されるまで「不明」', () => {
    const s = play(newSession({ seatTotalGames: 3000, seatCurrentGames: 20, seatBig: 8, seatReg: 6 }), [
      ['BIG', 40], ['REG', 60], ['BIG', 250], ['BIG', 70],
    ]);
    expect(rights(s)).toEqual(['unknown', 'unknown', 'no', 'yes']);
    let t = s;
    t = updateBonus(t, t.bonuses[0].id, { suika: 1, side: 'red', end: 'white' });
    expect(isComplete(t.bonuses[0], NK, t)).toBe(false); // 不明はBGM（実発生）の記録を求める
    t = setBgm(t, t.bonuses[0].id, 'unconfirmed');
    expect(isComplete(t.bonuses[0], NK, t)).toBe(true);
  });
  it('自動判定ルールのない機種には適用しない（手動）', () => {
    const s = play(newSession({ machineId: 'star-30' }), [['BIG', 200], ['BIG', 20]]);
    expect(s.bonuses.map((b) => computeRetro(s, getMachine('star-30')).get(b.id)!.right)).toEqual(['manual', 'manual']);
  });
  it('BGM記録：レトロ→実発生あり／通常・大連続→なし／未確認→未記録のまま区別', () => {
    let s = play(zero(), [['BIG', 200], ['BIG', 20]]);
    const id = s.bonuses[1].id;
    expect(isComplete(s.bonuses[1], NK, s)).toBe(false);
    s = setBgm(s, id, 'retro');
    expect([s.bonuses[1].bgm, s.bonuses[1].retroActual]).toEqual(['retro', true]);
    s = setBgm(s, id, 'big_chain');
    expect(s.bonuses[1].retroActual).toBe(false);
    s = setBgm(s, id, 'unconfirmed');
    expect([s.bonuses[1].bgm, s.bonuses[1].retroActual]).toEqual(['unconfirmed', null]);
    s = setBgm(s, id, null);
    expect([s.bonuses[1].bgm, s.bonuses[1].retroActual]).toEqual([null, null]);
  });
  it('旧データの手動権利は上書きせず保持し、自動判定との違いを検出', () => {
    const raw = {
      machineId: 'new-king-v30', seatTotalGames: 0, seatBig: 0, seatReg: 0,
      bonuses: [
        { id: 'a', type: 'BIG', games: 300, retroRight: true, retroActual: false },
        { id: 'b', type: 'BIG', games: 50, retroRight: true, retroActual: true },
      ],
    };
    const s = normalizeSession(raw);
    expect(s.bonuses.map((b) => b.retroRight)).toEqual([true, true]); // 保持
    const m = computeRetro(s, NK);
    expect(s.bonuses.map((b) => manualMismatch(b, m.get(b.id)))).toEqual([true, false]);
    expect(aggregate(s).bigRetro.mismatch).toBe(1);
    expect(shareDetail(s)).toContain('あり≠自動');
  });
});

describe('B. 初回BIGのリセットフラッシュ', () => {
  it('ありの場合は終了ランプ不要・通常の終了ランプ集計に混ぜない', () => {
    let s = play(zero(), [['REG', 30], ['BIG', 120], ['BIG', 300]]);
    const first = s.bonuses[1].id;
    s = { ...s, resetFlash: true };
    s = updateBonus(s, first, { suika: 0, side: 'blue', end: 'rainbow', rfLamp: 'rainbow' });
    expect(isComplete(s.bonuses[1], NK, s)).toBe(true);
    s = updateBonus(s, s.bonuses[2].id, { end: 'white' });
    const a = aggregate(s);
    expect(a.bigEnd.counts.rainbow).toBe(0); // リセフラ時の色は集計外
    expect(a.bigEnd.counts.white).toBe(1);
    expect(a.bigEnd.excluded).toBe(1);
  });
  it('なし／未確認は通常どおり終了ランプが必要・未確認を保存・復元できる', () => {
    let s = play(zero(), [['BIG', 120]]);
    s = { ...s, resetFlash: 'unconfirmed' };
    s = updateBonus(s, s.bonuses[0].id, { suika: 0, side: 'blue' });
    expect(isComplete(s.bonuses[0], NK, s)).toBe(false);
    const back = parseBackup(exportBackup({ version: 1, sessions: [s], activeId: s.id, prefs: emptyPrefs() }));
    expect(back.sessions[0].resetFlash).toBe('unconfirmed');
  });
});

describe('C. ベル累計・G数・BIG/REGの一括登録', () => {
  it('1回の操作でG・種別・ベル累計が1件に入り、二重加算しない', () => {
    let s = addBonus(zero(), 'BIG', 160, undefined, 23);
    expect(s.bonuses).toHaveLength(1);
    expect([s.bonuses[0].games, s.bonuses[0].type, s.bonuses[0].bellsAt]).toEqual([160, 'BIG', 23]);
    s = addBonus(s, 'REG', 70, undefined, 32);
    expect(timeline(s).map((r) => r.bellDiff)).toEqual([23, 9]);
    expect([aggregate(s).big, aggregate(s).reg, aggregate(s).total, totalBells(s)]).toEqual([1, 1, 230, 32]);
  });
  it('ベル未入力なら前回の累計をコピーせず未記録', () => {
    let s = addBonus(zero(), 'BIG', 160, undefined, 23);
    s = addBonus(s, 'REG', 70);
    expect(s.bonuses[1].bellsAt).toBeNull();
  });
  it('ベルを後から入力した場合（履歴修正）', () => {
    let s = addBonus(zero(), 'BIG', 160);
    s = updateBonus(s, s.bonuses[0].id, { bellsAt: 25 });
    expect(timeline(s)[0].bellDiff).toBe(25);
    s = addBonus(setBellTotal(s, 40), 'BIG', 100); // 事前入力（従来方式）も維持
    expect(s.bonuses[1].bellsAt).toBe(40);
  });
});

describe('D/E. ホーム・台移動', () => {
  it('同じ店舗で次の台：日付・店舗・貸し枚数のみ引き継ぎ', () => {
    let prev = newSession({ date: '2026-11-08', store: 'タイホウ鳴海', lendRate: 47, machineId: 'star-30', tableNo: '805', seatTotalGames: 1200, cashInvest: 10000 });
    prev = endSession(setBellTotal(addBonus(prev, 'BIG', 99), 50), 120);
    const next = nextSessionSameStore(prev);
    expect([next.date, next.store, next.lendRate]).toEqual(['2026-11-08', 'タイホウ鳴海', 47]);
    expect([next.machineId, next.tableNo, next.seatTotalGames, next.seatBig, next.cashInvest, next.bonuses.length, next.bellTotal])
      .toEqual(['new-king-v30', '', 0, 0, null, 0, null]);
    expect(next.id).not.toBe(prev.id);
  });
  it('終了済み・中断中を区別', () => {
    const a = endSession(addBonus(newSession({ date: '2026-11-07' }), 'BIG', 10), 5);
    const b = addBonus(newSession({ date: '2026-11-08' }), 'REG', 10);
    const st: AppState = { version: 1, sessions: [a, b], activeId: b.id, prefs: emptyPrefs() };
    expect(unfinishedSessions(st).map((x) => x.id)).toEqual([b.id]);
    expect(lastEndedSession(st)?.id).toBe(a.id);
  });
  it('終了済み・中断中のデータが再起動（保存→読込）後も保持される', async () => {
    const a = endSession(addBonus(newSession(), 'BIG', 10), 5);
    const b = addBonus(newSession(), 'BIG', 10, undefined, 3);
    const st: AppState = { version: 1, sessions: [a, b], activeId: null, prefs: { stores: [], storeRates: { タイホウ鳴海: 47 } } };
    expect(await saveState(st)).toBe('idb');
    const { state } = await loadState();
    expect(state).toEqual(st);
    expect(parseBackup(exportBackup(state))).toEqual(st);
  });
});
