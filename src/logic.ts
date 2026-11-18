import { getMachine, LAMP_EMOJI, MISS_EMOJI, type BonusSpec, type FieldSpec, type MachineDef } from './machines';
import { BGM_LABEL, computeRetro, effectiveRight, isZeroStart, manualMismatch, actualFromBgm, type RetroAuto } from './retro';
import {
  MISS, NA, type AppState, type BellPoint, type Bgm, type ResetFlash, type Bonus, type BonusType, type LampColor, type LampValue, type Prefs, type Session,
  type SuikaValue, type YesNo,
} from './types';

// ---------- 基本ユーティリティ ----------
export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const todayStr = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const hhmm = (iso: string | null): string => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const emptyPrefs = (): Prefs => ({ stores: [], storeRates: {} });
export const emptyState = (): AppState => ({ version: 1, sessions: [], activeId: null, prefs: emptyPrefs() });

export function newSession(p: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  return {
    id: uid(), date: todayStr(), store: '', machineId: 'new-king-v30', tableNo: '', lendRate: null,
    seatTotalGames: 0, seatCurrentGames: 0, seatBig: 0, seatReg: 0, gakkun: null, resetFlash: null,
    cashInvest: null, medalsUsed: null, payout: null, finalBalance: null,
    bellObs: [], legacyBell: null, bonuses: [], midGames: null, midAt: null, endGames: null, endedAt: null, memo: '',
    createdAt: now, updatedAt: now, ...p,
  };
}

export const specOf = (m: MachineDef, t: BonusType): BonusSpec => (t === 'BIG' ? m.big : m.reg);
/** 機種の対応状況に応じた初期値：対応/未確認 → null（未記録）、非対応 → not_applicable */
const init = (f: FieldSpec) => (f.support === 'not_applicable' ? NA : null);

export function newBonus(m: MachineDef, type: BonusType, games: number, bellsAt: number | null = null, at = new Date().toISOString()): Bonus {
  const sp = specOf(m, type);
  return {
    id: uid(), type, games, bellsAt, at, memo: '',
    suika: init(sp.suika) as SuikaValue,
    side: init(sp.side) as LampValue,
    end: init(sp.end) as LampValue,
    retroRight: init(sp.retro) as YesNo,
    retroActual: init(sp.retro) as YesNo,
    bgm: null,
    rfLamp: null,
  };
}

/** 値がその項目で有効か */
export function validLamp(v: LampValue, f: FieldSpec): boolean {
  if (f.support === 'not_applicable') return v === NA;
  if (v === null) return true;
  if (v === MISS) return !!f.miss;
  if (v === NA) return false;
  return (f.colors ?? []).includes(v);
}

/** 種別の修正。新しい種別で有効な値は残し、無効な値は初期値に戻す */
export function changeType(b: Bonus, type: BonusType, m: MachineDef): Bonus {
  const sp = specOf(m, type);
  const keepSuika = sp.suika.support === 'not_applicable' ? NA : b.suika === NA ? null : b.suika;
  const keepYN = (v: YesNo) => (sp.retro.support === 'not_applicable' ? NA : v === NA ? null : v);
  return {
    ...b, type,
    suika: keepSuika,
    side: validLamp(b.side, sp.side) ? b.side : (init(sp.side) as LampValue),
    end: validLamp(b.end, sp.end) ? b.end : (init(sp.end) as LampValue),
    retroRight: keepYN(b.retroRight),
    retroActual: keepYN(b.retroActual),
  };
}

// ---------- ゲーム数計算 ----------
// 当選間Gは台の表示カウンター基準。着席時の表示カウンター値(seatCurrentGames)は
// 着席時累計(seatTotalGames)に既に含まれるため、最初の当選・途中保存・ヤメでは差し引く。

/** 各ボーナスで新たに加算されるG数（自分が回した区間G） */
export function addedGames(s: Session, index: number): number {
  const g = s.bonuses[index].games;
  return index === 0 ? g - s.seatCurrentGames : g;
}

export const ratio = (games: number, n: number | null): number | null => (n && n > 0 && games > 0 ? games / n : null);
/** 区間などの確率（小数第1位） */
export const probText = (r: number | null): string => (r == null ? '―' : `1/${r.toFixed(1)}`);
/** 累計ベル確率（小数第2位。丸めは表示時のみ） */
export const probText2 = (r: number | null): string => (r == null ? '—' : `1/${r.toFixed(2)}`);
export const diffText = (r: { bellDiff: number | null; bellSpan: number; bellFrom?: BellObservation['kind'] | 'seat' | null }): string =>
  r.bellDiff == null ? '-' : `${r.bellDiff}${r.bellSpan > 1 ? `(${r.bellSpan}区間)` : ''}${r.bellFrom === 'mid' || r.bellFrom === 'end' ? '(途中保存から)' : ''}`;

export interface TimelineRow {
  bonus: Bonus; no: number; cumTotal: number; played: number; warn: boolean;
  /** 直前のベル観測からの差分（ボーナス間ベル）。この当選のベルが未記録なら null */
  bellDiff: number | null;
  /** 差分を数えた区間のG（直前のベル観測時点から） */
  bellGames: number | null;
  /** 差分が何回分の当選区間にまたがるか（途中にベル未記録の当選があると2以上） */
  bellSpan: number;
  bellRatio: number | null;
  /** 直前の観測の種類（seat＝着席時0回から） */
  bellFrom: BellObservation['kind'] | 'seat' | null;
}

/** 当選ごとの累計G（ベル計算と共通の土台） */
function rawRows(s: Session): Array<{ b: Bonus; i: number; cum: number; add: number }> {
  let cum = s.seatTotalGames;
  return s.bonuses.map((b, i) => {
    const add = addedGames(s, i);
    cum += add;
    return { b, i, cum, add };
  });
}

/** ベル観測（当選時・後入力・途中保存・終了時）。必ずG時点とセット */
export interface BellObservation {
  /** 台の累計G位置 */
  x: number;
  /** 自分の実戦G（着席から） */
  my: number;
  bells: number;
  kind: 'bonus' | 'late' | 'mid' | 'end';
  label: string;
  at: string;
  bonusId?: string;
  no?: number;
  pointId?: string;
  migrated?: boolean;
}

const KIND_LABEL: Record<BellObservation['kind'], string> = { bonus: '当選時', late: '当選時（後入力）', mid: '途中保存', end: '終了時' };
export const bellKindText = (o: BellObservation): string => `${KIND_LABEL[o.kind]}${o.migrated ? '（旧データ移行）' : ''}`;

/** 当選間のベル観測の位置（台の累計G）。起点の当選が見つからなければ null */
function pointX(s: Session, p: BellPoint, pos: Map<string, number>): number | null {
  const base = p.after == null ? s.seatTotalGames - s.seatCurrentGames : pos.get(p.after);
  return base == null ? null : base + p.counter;
}

/** すべてのベル観測をG位置順に並べる（同じ位置なら記録時刻順） */
export function bellObservations(s: Session): BellObservation[] {
  const rows = rawRows(s);
  const pos = new Map(rows.map((r) => [r.b.id, r.cum]));
  const out: BellObservation[] = [];
  rows.forEach((r) => {
    if (r.b.bellsAt == null) return;
    out.push({
      x: r.cum, my: r.cum - s.seatTotalGames, bells: r.b.bellsAt, kind: r.b.bellsSrc === 'late' ? 'late' : 'bonus',
      label: `#${r.i + 1} ${r.b.type}`, at: r.b.at, bonusId: r.b.id, no: r.i + 1,
    });
  });
  (s.bellObs ?? []).forEach((p) => {
    const x = pointX(s, p, pos);
    if (x == null) return;
    out.push({ x, my: x - s.seatTotalGames, bells: p.bells, kind: p.src, label: p.src === 'end' ? 'ヤメ' : '途中保存', at: p.at, pointId: p.id, migrated: p.migrated });
  });
  const order = new Map(out.map((o, k) => [o, k]));
  return out.sort((a, b) => a.x - b.x || (a.kind === 'bonus' || a.kind === 'late' ? -1 : 0) - (b.kind === 'bonus' || b.kind === 'late' ? -1 : 0) || (order.get(a)! - order.get(b)!));
}

/** 古い順の当選履歴と、各当選時点の累計G・ボーナス間ベル（直前のベル観測との差分）と確率 */
export function timeline(s: Session): TimelineRow[] {
  const rows = rawRows(s);
  const obs = bellObservations(s);
  return rows.map((r) => {
    const row: TimelineRow = {
      bonus: r.b, no: r.i + 1, cumTotal: r.cum, played: r.add, warn: r.add < 0,
      bellDiff: null, bellGames: null, bellSpan: 0, bellRatio: null, bellFrom: null,
    };
    if (r.b.bellsAt == null) return row;
    const k = obs.findIndex((o) => o.bonusId === r.b.id);
    const prev = k > 0 ? obs[k - 1] : null;
    const prevX = prev ? prev.x : s.seatTotalGames;
    const prevMy = prev ? prev.my : 0;
    row.bellDiff = r.b.bellsAt - (prev ? prev.bells : 0);
    row.bellGames = r.cum - s.seatTotalGames - prevMy;
    row.bellSpan = rows.filter((q) => q.cum > prevX && q.cum <= r.cum).length;
    row.bellRatio = row.bellDiff > 0 ? ratio(row.bellGames, row.bellDiff) : null;
    row.bellFrom = prev ? prev.kind : 'seat';
    return row;
  });
}

const tailAdd = (s: Session, counter: number) => (s.bonuses.length === 0 ? counter - s.seatCurrentGames : counter);

/** 現在のボーナス間G（表示カウンター相当） */
export function currentCounter(s: Session): number {
  if (s.endGames != null) return s.endGames;
  if (s.midGames != null) return s.midGames;
  return s.bonuses.length === 0 ? s.seatCurrentGames : 0;
}

/** 最終当選後に自分が回したG（途中保存・ヤメが無ければ null） */
export function tailPlayed(s: Session): number | null {
  const c = s.endGames ?? s.midGames;
  return c == null ? null : tailAdd(s, c);
}

/** 累計G。途中保存・ヤメは「最終ボーナス後の表示値」として1回だけ加算（二重加算しない） */
export function totalGames(s: Session): number {
  const rows = rawRows(s);
  const base = rows.length ? rows[rows.length - 1].cum : s.seatTotalGames;
  return base + (tailPlayed(s) ?? 0);
}

/** 最後のベル観測（無ければ null＝未記録） */
export function lastBellObservation(s: Session): BellObservation | null {
  const o = bellObservations(s);
  return o.length ? o[o.length - 1] : null;
}

/** 現在わかっているベル累計（null＝未記録、0＝観測済みの0回） */
export function totalBells(s: Session): number | null {
  return lastBellObservation(s)?.bells ?? null;
}

/** 累計ベル確率：最後にベルを実測した時点までの自分の実戦Gで計算（0回・未記録は null） */
export function bellRatioTotal(s: Session): number | null {
  const o = lastBellObservation(s);
  return o ? ratio(o.my, o.bells) : null;
}

/** 最終当選より後のベル観測（途中保存・終了時）の最新値と、直前観測からの差分 */
export function bellTail(s: Session): { obs: BellObservation | null; diff: number | null; games: number | null; ratio: number | null } {
  const obs = bellObservations(s);
  const last = obs[obs.length - 1];
  if (!last || (last.kind !== 'mid' && last.kind !== 'end')) return { obs: null, diff: null, games: null, ratio: null };
  const rows = rawRows(s);
  const lastBonusX = rows.length ? rows[rows.length - 1].cum : -Infinity;
  if (last.x < lastBonusX) return { obs: null, diff: null, games: null, ratio: null };
  const prev = obs.length > 1 ? obs[obs.length - 2] : null;
  const diff = last.bells - (prev?.bells ?? 0);
  const games = last.my - (prev?.my ?? 0);
  return { obs: last, diff, games, ratio: diff > 0 ? ratio(games, diff) : null };
}

/**
 * ベル累計の表示用まとめ。
 * count：「未記録」または回数、ratio：1/X.XX または —、scope：最終実測が現在より前なら「◯G・◯回まで」
 */
export function bellSummary(s: Session): { count: string; ratio: string; scope: string | null; obs: BellObservation | null } {
  const o = lastBellObservation(s);
  if (!o) return { count: '未記録', ratio: '—', scope: null, obs: null };
  const r = ratio(o.my, o.bells);
  const behind = o.x < totalGames(s);
  return {
    count: `${o.bells}回`,
    ratio: probText2(r),
    scope: behind ? `${o.my.toLocaleString('ja-JP')}G・${o.bells}回まで` : null,
    obs: o,
  };
}

/** 要確認の一覧（値は変更せず表示だけ） */
export function sessionIssues(s: Session): string[] {
  const out: string[] = [];
  const rows = rawRows(s);
  rows.forEach((r) => {
    if (r.add < 0) out.push(`#${r.i + 1} 当選G ${r.b.games}G が着席時の表示G ${s.seatCurrentGames}G より小さい（負のG数）`);
  });
  const ids = new Set(s.bonuses.map((b) => b.id));
  (s.bellObs ?? []).forEach((p) => {
    if (p.after != null && !ids.has(p.after)) out.push(`ベル観測（${p.bells}回）の起点の当選が見つからない`);
    if (p.after == null && p.counter < s.seatCurrentGames) out.push(`ベル観測（${p.bells}回）の位置 ${p.counter}G が着席時の表示G ${s.seatCurrentGames}G より小さい`);
  });
  const obs = bellObservations(s);
  obs.forEach((o, k) => {
    const prev = k > 0 ? obs[k - 1] : null;
    const pb = prev?.bells ?? 0;
    const pm = prev?.my ?? 0;
    const where = (x: BellObservation) => `${x.label}（自分${x.my.toLocaleString('ja-JP')}G時点）${x.bells}回`;
    if (o.bells < pb && prev) out.push(`ベル累計が前の記録より少ない：${where(prev)} → ${where(o)}`);
    else if (o.bells === pb && o.my - pm >= 20) out.push(`ベル累計が増えていない：${prev ? where(prev) : '着席時0回'} → ${where(o)}（${o.my - pm}Gで+0回）`);
  });
  if (s.legacyBell) out.push(`時点不明の旧ベル値 ${s.legacyBell.bells}回（${s.legacyBell.reason}）。確率計算には使っていません`);
  return out;
}

/** ベル入力の妥当性（保存前チェック）。x位置に bells を置いたとき前後の観測と矛盾しないか */
export function checkBellAt(s: Session, x: number, bells: number, ignore: { pointId?: string; bonusId?: string } = {}): string | null {
  const obs = bellObservations(s).filter((o) => !(ignore.pointId && o.pointId === ignore.pointId) && !(ignore.bonusId && o.bonusId === ignore.bonusId));
  const before = [...obs].reverse().find((o) => o.x <= x);
  const after = obs.find((o) => o.x > x);
  if (before && bells < before.bells) return `前の記録（${before.label}・自分${before.my.toLocaleString('ja-JP')}G時点）の${before.bells}回より少なくなっています`;
  if (after && bells > after.bells) return `後の記録（${after.label}・自分${after.my.toLocaleString('ja-JP')}G時点）の${after.bells}回より多くなっています`;
  return null;
}

// ---------- 集計 ----------
export interface LampCount { counts: Record<LampColor, number>; miss: number; unrecorded: number; na: number; total: number; excluded: number }
export interface SuikaAgg { sum: number; recorded: number; unrecorded: number; na: number; plus: number }
export interface YesNoAgg { yes: number; no: number; unrecorded: number; na: number }

const zeroLamp = (): Record<LampColor, number> => ({ white: 0, blue: 0, yellow: 0, green: 0, red: 0, purple: 0, rainbow: 0 });

function countLamp(list: Bonus[], key: 'side' | 'end', exclude: Set<string> = new Set()): LampCount {
  const r: LampCount = { counts: zeroLamp(), miss: 0, unrecorded: 0, na: 0, total: list.length, excluded: 0 };
  for (const b of list) {
    if (exclude.has(b.id)) { r.excluded++; continue; }
    const v = b[key];
    if (v === null) r.unrecorded++;
    else if (v === NA) r.na++;
    else if (v === MISS) r.miss++;
    else r.counts[v]++;
  }
  return r;
}
function countSuika(list: Bonus[]): SuikaAgg {
  const r: SuikaAgg = { sum: 0, recorded: 0, unrecorded: 0, na: 0, plus: 0 };
  for (const b of list) {
    if (b.suika === null) r.unrecorded++;
    else if (b.suika === NA) r.na++;
    else { r.sum += b.suika; r.recorded++; if (b.suika === 3) r.plus++; }
  }
  return r;
}
function countYN(list: Bonus[], key: 'retroRight' | 'retroActual'): YesNoAgg {
  const r: YesNoAgg = { yes: 0, no: 0, unrecorded: 0, na: 0 };
  for (const b of list) {
    const v = b[key];
    if (v === null) r.unrecorded++;
    else if (v === NA) r.na++;
    else if (v) r.yes++;
    else r.no++;
  }
  return r;
}

export interface RetroAgg { right: { yes: number; no: number; unknown: number; unrecorded: number }; actual: YesNoAgg; bgm: Record<Exclude<Bgm, null>, number> & { unrecorded: number }; mismatch: number }

function countRetro(list: Bonus[], autoMap: Map<string, RetroAuto>): RetroAgg {
  const r: RetroAgg = {
    right: { yes: 0, no: 0, unknown: 0, unrecorded: 0 },
    actual: countYN(list, 'retroActual'),
    bgm: { normal: 0, retro: 0, big_chain: 0, unconfirmed: 0, unrecorded: 0 },
    mismatch: 0,
  };
  for (const b of list) {
    const auto = autoMap.get(b.id);
    const e = effectiveRight(b, auto);
    if (e === null) r.right.unrecorded++;
    else r.right[e]++;
    if (b.bgm) r.bgm[b.bgm]++;
    else r.bgm.unrecorded++;
    if (manualMismatch(b, auto)) r.mismatch++;
  }
  return r;
}

/** リセットフラッシュありの初回BIG（通常の終了ランプ集計から除外する） */
export function resetFlashBonusIds(s: Session): Set<string> {
  const ids = new Set<string>();
  if (s.resetFlash !== true) return ids;
  const first = s.bonuses.find((b) => b.type === 'BIG');
  if (first && isFreshMachine(s)) ids.add(first.id);
  return ids;
}

export function aggregate(s: Session) {
  const bigs = s.bonuses.filter((b) => b.type === 'BIG');
  const regs = s.bonuses.filter((b) => b.type === 'REG');
  const total = totalGames(s);
  const autoMap = computeRetro(s, getMachine(s.machineId));
  const rfIds = resetFlashBonusIds(s);
  return {
    total, myGames: total - s.seatTotalGames,
    myBig: bigs.length, myReg: regs.length,
    big: s.seatBig + bigs.length, reg: s.seatReg + regs.length,
    bells: totalBells(s), bellRatio: bellRatioTotal(s), bell: bellSummary(s),
    bigSuika: countSuika(bigs), regSuika: countSuika(regs),
    bigSide: countLamp(bigs, 'side'), regSide: countLamp(regs, 'side'),
    bigEnd: countLamp(bigs, 'end', rfIds), regEnd: countLamp(regs, 'end'),
    bigRetro: countRetro(bigs, autoMap), regRetro: countRetro(regs, autoMap),
    counter: currentCounter(s),
  };
}

/**
 * 詳細記録がすべて埋まっているか（対応項目のみ必須。未確認・非対応は必須にしない）。
 * s を渡すとレトロ自動判定・リセットフラッシュを考慮する。
 *  - 自動判定機種：権利の入力は不要。権利あり／不明の当選だけBGM（実発生）を必須
 *  - リセットフラッシュありの初回BIG：終了ランプを必須にしない
 */
export function isComplete(b: Bonus, m: MachineDef, s?: Session): boolean {
  const sp = specOf(m, b.type);
  const need = (f: FieldSpec) => f.support === 'supported';
  const rf = s ? resetFlashBonusIds(s).has(b.id) : false;
  if (need(sp.suika) && b.suika === null) return false;
  if (need(sp.side) && b.side === null) return false;
  if (need(sp.end) && b.end === null && !rf) return false;
  if (need(sp.retro)) {
    const actualDone = b.bgm !== null || b.retroActual !== null;
    if (m.retroRule) {
      const auto = s ? computeRetro(s, m).get(b.id) : undefined;
      const r = auto?.right ?? 'unknown';
      if ((r === 'yes' || r === 'unknown') && !actualDone) return false;
    } else {
      if (b.retroRight === null) return false;
      if (b.retroRight === true && !actualDone) return false;
    }
  }
  return true;
}

/** 累計0G台（着席時 総G=0・BIG=0）か */
export const isFreshMachine = (s: Session): boolean => s.seatTotalGames === 0 && s.seatBig === 0;
/** リセットフラッシュを入力できるボーナス＝累計0G台の1回目BIG（REGは含めない） */
export function isResetFlashTarget(s: Session, bonusId: string): boolean {
  if (!isFreshMachine(s)) return false;
  const firstBig = s.bonuses.find((b) => b.type === 'BIG');
  return firstBig?.id === bonusId;
}
/** リールガックンを入力できる状態＝累計0G台でまだ当選・途中保存なし */
export const canAskGakkun = (s: Session): boolean =>
  isFreshMachine(s) && s.seatCurrentGames === 0 && s.bonuses.length === 0 && s.midGames == null && s.endGames == null;

// ---------- 状態変更（純関数。すべて新しい Session を返す） ----------
const touch = (s: Session): Session => ({ ...s, updatedAt: new Date().toISOString() });

/**
 * ボーナス登録（一括・原子的）。G数・種別・ベル累計を1件の当選として同時に保存する。
 * bells を渡せばその当選時点のベル累計として記録、無ければ未記録(null)。
 * 途中保存などの過去のベル値を新しい当選へコピーしない。途中保存・ヤメは解除（観測記録は残る）。
 */
export function addBonus(s: Session, type: BonusType, games: number, at?: string, bells?: number | null): Session {
  const bellsAt = bells != null ? Math.max(0, Math.floor(bells)) : null;
  const b = { ...newBonus(getMachine(s.machineId), type, games, bellsAt, at), ...(bellsAt != null ? { bellsSrc: 'bonus' as const } : {}) };
  return touch({ ...s, bonuses: [...s.bonuses, b], midGames: null, midAt: null, endGames: null, endedAt: null });
}
/** BGMを記録（レトロ実発生も連動して設定。権利の記録は変更しない） */
export function setBgm(s: Session, id: string, bgm: Bgm): Session {
  return updateBonus(s, id, { bgm, retroActual: actualFromBgm(bgm) });
}
export function updateBonus(s: Session, id: string, patch: Partial<Bonus>): Session {
  return touch({ ...s, bonuses: s.bonuses.map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b)) });
}
export function setBonusType(s: Session, id: string, type: BonusType): Session {
  const m = getMachine(s.machineId);
  return touch({ ...s, bonuses: s.bonuses.map((b) => (b.id === id ? changeType(b, type, m) : b)) });
}
/**
 * 当選を削除。その当選を起点にしていたベル観測は、直前の当選（なければ着席時）を起点に付け替え、
 * 台の累計G上の位置が変わらないよう当選間Gを足し込む。
 */
export function deleteBonus(s: Session, id: string): Session {
  const i = s.bonuses.findIndex((b) => b.id === id);
  if (i < 0) return s;
  const del = s.bonuses[i];
  const prevId = i > 0 ? s.bonuses[i - 1].id : null;
  const bellObs = (s.bellObs ?? []).map((p) => (p.after === id ? { ...p, after: prevId, counter: p.counter + del.games } : p));
  return touch({ ...s, bonuses: s.bonuses.filter((b) => b.id !== id), bellObs });
}
/** 当選後にその当選のベル累計を後入力（当選時点の値として記録） */
export function setBonusBells(s: Session, id: string, n: number): Session {
  return updateBonus(s, id, { bellsAt: Math.max(0, Math.floor(n)), bellsSrc: 'late' });
}

/** ベル累計を後から入れる対象の当選（最新の当選がベル未記録で、その後に途中保存・ヤメ・ベル観測がない） */
export function bellTarget(s: Session): Bonus | null {
  const last = s.bonuses[s.bonuses.length - 1];
  if (!last || last.bellsAt != null || s.midGames != null || s.endGames != null) return null;
  if ((s.bellObs ?? []).some((p) => p.after === last.id)) return null;
  return last;
}

const lastBonusId = (s: Session): string | null => s.bonuses[s.bonuses.length - 1]?.id ?? null;
const point = (s: Session, counter: number, bells: number, src: BellPoint['src'], at: string): BellPoint =>
  ({ id: uid(), after: lastBonusId(s), counter, bells: Math.max(0, Math.floor(bells)), src, at });

/** 途中保存。bells を渡すと「この当選間G時点のベル累計」として観測を追加（過去の観測は保持） */
export function setMid(s: Session, games: number | null, at = new Date().toISOString(), bells?: number | null): Session {
  const bellObs = games != null && bells != null ? [...(s.bellObs ?? []), point(s, games, bells, 'mid', at)] : s.bellObs ?? [];
  return touch({ ...s, midGames: games, midAt: games == null ? null : at, bellObs });
}

/**
 * 実戦終了（初回・修正とも）。ヤメG時点の終了時ベルは bells で指定（null＝未記録）。
 * 既存の終了時ベルは置き換える（修正画面で「そのまま使う」を選んだ場合は呼び出し側が同じ値を渡す）。
 */
export function endSession(s: Session, endGames: number, at = new Date().toISOString(), bells: number | null = null): Session {
  const keep = (s.bellObs ?? []).filter((p) => p.src !== 'end');
  const bellObs = bells != null ? [...keep, point(s, endGames, bells, 'end', s.endedAt ?? at)] : keep;
  return touch({ ...s, endGames, endedAt: s.endedAt ?? at, midGames: null, midAt: null, bellObs });
}
/** 終了時のベル観測（あれば） */
export const endBellPoint = (s: Session): BellPoint | null => (s.bellObs ?? []).find((p) => p.src === 'end') ?? null;

/** 実戦を再開。終了時ベルは「その時点の観測」として途中保存扱いで残す */
export function reopenSession(s: Session): Session {
  const bellObs = (s.bellObs ?? []).map((p) => (p.src === 'end' ? { ...p, src: 'mid' as const } : p));
  return touch({ ...s, endGames: null, endedAt: null, bellObs });
}

/** ヤメ（または途中保存）の当選間Gを入力したときの台累計Gと自分の実戦G。着席時を下回るなら error */
export function previewEnd(s: Session, counter: number): { total: number; my: number; error: string | null } {
  const rows = rawRows(s);
  const base = rows.length ? rows[rows.length - 1].cum : s.seatTotalGames;
  const add = rows.length ? counter : counter - s.seatCurrentGames;
  const total = base + add;
  const error = add < 0
    ? `着席時の当選間G（${s.seatCurrentGames}G）より小さい値です。ヤメ時は着席時以上の値になります`
    : null;
  return { total, my: total - s.seatTotalGames, error };
}

/** 終了・途中保存の位置（台累計G）。checkBellAt と組み合わせて矛盾を検出する */
export const tailX = (s: Session, counter: number): number => previewEnd(s, counter).total;

// ---------- 表示用 ----------
export const suikaText = (v: SuikaValue): string => (v === null ? '未記録' : v === NA ? '-' : v === 3 ? '3+' : String(v));
export const lampText = (v: LampValue): string =>
  v === null ? '未記録' : v === NA ? '-' : v === MISS ? 'ミス' : LAMP_EMOJI[v];
export const ynText = (v: YesNo): string => (v === null ? '未記録' : v === NA ? '-' : v ? 'あり' : 'なし');
const numOr = (v: number | null, unit = ''): string => (v == null ? '未記録' : `${v.toLocaleString('ja-JP')}${unit}`);
const ynOr = (v: boolean | null) => (v == null ? '未記録' : v ? 'あり' : 'なし');
export const rfText = (v: ResetFlash) => (v == null ? '未記録' : v === 'unconfirmed' ? '未確認' : v ? 'あり' : 'なし');
const rightText = (r: 'yes' | 'no' | 'unknown' | null) => (r == null ? '未記録' : r === 'yes' ? 'あり' : r === 'no' ? 'なし' : '不明');
const bgmText = (b: Bonus) => (b.bgm ? BGM_LABEL[b.bgm] : b.retroActual === true ? '(旧)レトロ発生' : b.retroActual === false ? '(旧)発生なし' : b.retroActual === NA ? '-' : '未記録');

/** ランプ集計1行。palette順（showZero=false なら0件の色は省略） */
export function lampLine(c: LampCount, palette: LampColor[], showZero: boolean): string {
  if (c.total === 0) return '記録なし';
  if (c.unrecorded + c.na === c.total && c.miss === 0) return '未記録';
  const body = palette.filter((k) => showZero || c.counts[k] > 0).map((k) => `${LAMP_EMOJI[k]}${c.counts[k]}`).join('');
  const extra: string[] = [];
  if (c.miss) extra.push(`ミス${c.miss}`);
  if (c.unrecorded) extra.push(`未記録${c.unrecorded}`);
  return (body || '0件') + (extra.length ? `（${extra.join('・')}）` : '');
}

const suikaShort = (a: SuikaAgg) => (a.recorded === 0 && a.unrecorded > 0 ? '未記録' : `${a.sum}${a.plus ? '+' : ''}`);
const fmtDate = (d: string) => d.replace(/-/g, '/');
const used = (f: FieldSpec) => f.support !== 'not_applicable';
const nt = (f: FieldSpec) => (f.support === 'unverified' ? '（機種仕様未確認）' : '');

/** 簡易共有のベル表記：未記録／0回(—)／876(1/6.91)／368(1/7.32・2,695G時点まで) */
function simpleBell(s: Session): string {
  const b = bellSummary(s);
  if (!b.obs) return '未記録';
  if (b.obs.bells === 0) return '0回(—)';
  return `${b.obs.bells}(${b.ratio}${b.scope ? `・自分${b.obs.my.toLocaleString('ja-JP')}G時点まで` : ''})`;
}

export function shareSimple(s: Session): string {
  const m = getMachine(s.machineId);
  const a = aggregate(s);
  const suika: string[] = [];
  const unrec: string[] = [];
  if (used(m.big.suika)) { suika.push(`B${suikaShort(a.bigSuika)}`); if (a.bigSuika.unrecorded) unrec.push(`B${a.bigSuika.unrecorded}`); }
  if (used(m.reg.suika)) { suika.push(`R${suikaShort(a.regSuika)}`); if (a.regSuika.unrecorded) unrec.push(`R${a.regSuika.unrecorded}`); }
  const lines = [
    `日付：${fmtDate(s.date)}`,
    `店舗：${s.store || '未入力'}`,
    `台番：${s.tableNo || '未入力'}`,
    `機種：${m.short}`,
    '',
    `累計${a.total}G｜B${a.big}/R${a.reg}｜🔔${simpleBell(s)}` +
      (suika.length ? `｜🍉${suika.join('/')}` : '') + (unrec.length ? `（🍉未記録${unrec.join('/')}）` : ''),
    '',
  ];
  if (used(m.big.side)) lines.push(`BIG後半：${lampLine(a.bigSide, m.big.side.colors ?? [], true)}`);
  if (used(m.reg.side)) lines.push(`REG中サイド：${lampLine(a.regSide, m.reg.side.colors ?? [], true)}`);
  lines.push(`BIG終了：${lampLine(a.bigEnd, m.big.end.colors ?? [], false)}`);
  lines.push(`REG終了：${lampLine(a.regEnd, m.reg.end.colors ?? [], false)}`);
  const rr = (x: RetroAgg) => `権利${x.right.yes}${x.right.unknown ? `(不明${x.right.unknown})` : ''}/発生${x.actual.yes}`;
  lines.push(`レトロ：BIG${rr(a.bigRetro)}・REG${rr(a.regRetro)}${m.retroRule ? '（権利は自動判定・暫定）' : ''}`);
  if (a.bigRetro.bgm.big_chain + a.regRetro.bgm.big_chain) lines.push(`大連続BGM：${a.bigRetro.bgm.big_chain + a.regRetro.bgm.big_chain}回`);
  return lines.join('\n');
}

export function shareDetail(s: Session): string {
  const m = getMachine(s.machineId);
  const a = aggregate(s);
  const rows = timeline(s);
  const sa = (x: SuikaAgg) =>
    `${x.recorded === 0 && x.unrecorded > 0 ? '未記録' : `${x.sum}回`}${x.plus ? `（3回以上を3として${x.plus}件含む）` : ''}［記録${x.recorded}/未記録${x.unrecorded}］`;
  const yn = (x: YesNoAgg) => `あり${x.yes}・なし${x.no}・未記録${x.unrecorded}`;
  const rgt = (x: RetroAgg) => `あり${x.right.yes}・なし${x.right.no}・不明${x.right.unknown}${x.right.unrecorded ? `・未記録${x.right.unrecorded}` : ''}`;
  const autoMap = computeRetro(s, m);
  const rfIds = resetFlashBonusIds(s);
  const status = s.endGames != null ? `実戦終了（${hhmm(s.endedAt)}）` : '実戦中';
  const lastHamari =
    s.endGames != null ? `${s.endGames}G（ヤメ）` : s.midGames != null ? `${s.midGames}G（途中保存 ${hhmm(s.midAt)}）` : `${a.counter}G（途中保存なし）`;
  const fresh = isFreshMachine(s);

  const lines: string[] = [
    '【HANA LOG 詳細記録】',
    `日付：${fmtDate(s.date)}`,
    `店舗：${s.store || '未入力'}`,
    `台番：${s.tableNo || '未入力'}`,
    `機種：${m.name}`,
    `貸し：${s.lendRate == null ? '未記録' : `${s.lendRate}枚/1000円`}`,
    `状態：${status}`,
    '',
    '■着席時（自分の実戦前の値）',
    `累計${s.seatTotalGames}G／表示当選間${s.seatCurrentGames}G／BIG${s.seatBig}・REG${s.seatReg}`,
    fresh ? `リールガックン：${ynOr(s.gakkun)}／リセットフラッシュ（1回目BIG）：${rfText(s.resetFlash)}` : 'リールガックン・リセットフラッシュ：対象外（累計0Gの台ではない）',
    '',
    '■集計',
    `累計${a.total}G（うち自分の実戦${a.myGames}G）`,
    `BIG${a.big}（自分${a.myBig}）・REG${a.reg}（自分${a.myReg}）`,
    `ベル累計：${a.bell.count}（累計確率${a.bell.ratio}${a.bell.obs ? `＝自分の実戦${a.bell.obs.my.toLocaleString('ja-JP')}G÷${a.bell.obs.bells}回、最後にベルを実測した時点（${a.bell.obs.label}・${bellKindText(a.bell.obs)}）まで` : ''}）`,
  ];
  if (used(m.big.suika)) lines.push(`${m.big.suika.label}${nt(m.big.suika)}：${sa(a.bigSuika)}`);
  if (used(m.reg.suika)) lines.push(`${m.reg.suika.label}${nt(m.reg.suika)}：${sa(a.regSuika)}`);
  if (used(m.big.side)) lines.push(`${m.big.side.label}${nt(m.big.side)}：${lampLine(a.bigSide, m.big.side.colors ?? [], true)}`);
  if (used(m.reg.side)) lines.push(`${m.reg.side.label}${nt(m.reg.side)}：${lampLine(a.regSide, m.reg.side.colors ?? [], true)}`);
  lines.push(
    `${m.big.end.label}：${lampLine(a.bigEnd, m.big.end.colors ?? [], true)}`,
    `${m.reg.end.label}：${lampLine(a.regEnd, m.reg.end.colors ?? [], true)}`,
    `レトロ権利の判定：${m.retroRule ? '自動（ニューキングV暫定ルール：外部解析ベース・公式未確認）' : '手動記録（この機種は自動判定ルール未設定）'}`,
    `BIGレトロ権利：${rgt(a.bigRetro)}／実発生：${yn(a.bigRetro.actual)}`,
    `REGレトロ権利：${rgt(a.regRetro)}／実発生：${yn(a.regRetro.actual)}`,
    `BGM：通常${a.bigRetro.bgm.normal + a.regRetro.bgm.normal}・レトロ${a.bigRetro.bgm.retro + a.regRetro.bgm.retro}・大連続${a.bigRetro.bgm.big_chain + a.regRetro.bgm.big_chain}・未確認${a.bigRetro.bgm.unconfirmed + a.regRetro.bgm.unconfirmed}・未記録${a.bigRetro.bgm.unrecorded + a.regRetro.bgm.unrecorded}`,
    ...(a.bigRetro.mismatch + a.regRetro.mismatch ? [`※旧手動の権利記録と自動判定が異なる当選：${a.bigRetro.mismatch + a.regRetro.mismatch}件（履歴の「旧手動」列参照）`] : []),
    ...(a.bigEnd.excluded ? [`※リセットフラッシュありの初回BIG ${a.bigEnd.excluded}件は終了ランプ集計から除外`] : []),
    `最終ハマリ：${lastHamari}`,
    '',
    '■投資・回収',
    `現金投資：${numOr(s.cashInvest, '円')}／使用貯メダル：${numOr(s.medalsUsed, '枚')}／回収：${numOr(s.payout, '枚')}／最終収支：${s.finalBalance == null ? '未記録' : `${s.finalBalance > 0 ? '+' : ''}${s.finalBalance.toLocaleString('ja-JP')}円`}`,
    '',
    '■当選履歴（古い順）',
    'No|時刻|種別|当選G|累計G|ベル累計|ボーナス間ベル|ベル確率|スイカ|サイド|終了|レトロ権利|旧手動権利|BGM|レトロ発生|メモ',
    ...rows.map((r) => {
      const b = r.bonus;
      return [
        r.no, hhmm(b.at), b.type, b.games, r.cumTotal, b.bellsAt ?? '未記録', diffText(r), probText(r.bellRatio), suikaText(b.suika),
        lampText(b.side), rfIds.has(b.id) ? `リセフラ${b.rfLamp ? LAMP_EMOJI[b.rfLamp] : ''}(集計外)` : lampText(b.end),
        rightText(effectiveRight(b, autoMap.get(b.id))),
        m.retroRule ? (b.retroRight === true || b.retroRight === false ? `${ynText(b.retroRight)}${manualMismatch(b, autoMap.get(b.id)) ? '≠自動' : ''}` : '-') : '-',
        bgmText(b), ynText(b.retroActual), b.memo.replace(/[|\n]/g, ' '),
      ].join('|');
    }),
  );
  const bt = bellTail(s);
  const tailBells = bt.obs && (bt.obs.kind === 'end' ? s.endGames != null : true) && bt.obs.x === a.total ? bt : null;
  const tailRow = (label: string, at: string | null, g: number) =>
    `${label}|${hhmm(at)}|-|${g}|${a.total}|${tailBells ? tailBells.obs!.bells : '未記録'}|${tailBells?.diff ?? '-'}|${probText(tailBells?.ratio ?? null)}|-|-|-|-|-|-|-|`;
  if (s.endGames != null) lines.push(tailRow('ヤメ', s.endedAt, s.endGames));
  else if (s.midGames != null) lines.push(tailRow('途中', s.midAt, s.midGames));
  const obsList = bellObservations(s);
  lines.push('', '■ベル観測記録（自分の実戦G時点とセット）', 'No|種類|地点|台累計G|自分の実戦G|ベル累計|累計確率');
  if (obsList.length === 0) lines.push('（ベル未記録）');
  obsList.forEach((o, k) => lines.push([k + 1, bellKindText(o), o.label, o.x, o.my, o.bells, probText2(ratio(o.my, o.bells))].join('|')));
  const issues = sessionIssues(s);
  if (issues.length) lines.push('', '■要確認（値は変更していません）', ...issues.map((t) => `・${t}`));
  if (s.memo) lines.push('', `メモ：${s.memo}`);
  lines.push(
    '',
    '■凡例',
    'サイド＝BIGは後半サイド、REGはREG中サイド／未記録＝観測・入力なし／ミス＝ビタ押しミス等で判別不可／0＝0回を確認／-＝機種の記録対象外／🍉3+＝3回以上（集計は3として加算）／ベル累計＝外部カウンター値／ボーナス間ベル＝直前のベル観測からの差分（(2区間)等は途中にベル未記録の当選を含む、(途中保存から)は途中保存時点からの差分）／累計ベル確率は最後にベルを実測した時点までの自分の実戦Gで計算',
    `🤍白 🟦青 🟡黄 🟢緑 🟥赤 🟣紫 🌈虹 ${MISS_EMOJI}ミス`,
  );
  return lines.join('\n');
}

// ---------- バックアップ ----------
export interface Backup { app: 'HANA LOG'; format: 1; exportedAt: string; state: AppState }

export const exportBackup = (st: AppState): string =>
  JSON.stringify({ app: 'HANA LOG', format: 1, exportedAt: new Date().toISOString(), state: st } satisfies Backup, null, 1);

const isLamp = (v: unknown): v is LampValue =>
  v === null || v === NA || v === MISS || ['white', 'blue', 'yellow', 'green', 'red', 'purple', 'rainbow'].includes(v as string);
const isSuika = (v: unknown): v is SuikaValue => v === null || v === NA || v === 0 || v === 1 || v === 2 || v === 3;
const isYN = (v: unknown): v is YesNo => v === null || v === NA || v === true || v === false;
const numN = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const boolN = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** 読込時の検証・旧データ移行。不正値は捏造せず null（未記録）に落とす */
export function normalizeSession(raw: any): Session {
  const base = newSession();
  const bonuses: Bonus[] = Array.isArray(raw?.bonuses)
    ? raw.bonuses
        .filter((b: any) => b && (b.type === 'BIG' || b.type === 'REG') && typeof b.games === 'number')
        .map((b: any) => ({
          id: typeof b.id === 'string' ? b.id : uid(),
          type: b.type, games: b.games, bellsAt: numN(b.bellsAt), _oldBells: numN(b.bells),
          ...(b.bellsSrc === 'bonus' || b.bellsSrc === 'late' ? { bellsSrc: b.bellsSrc } : {}),
          at: typeof b.at === 'string' ? b.at : new Date(0).toISOString(),
          suika: isSuika(b.suika) ? b.suika : null,
          side: isLamp(b.side) ? b.side : null,
          end: isLamp(b.end) ? b.end : null,
          retroRight: isYN(b.retroRight) ? b.retroRight : null,
          retroActual: isYN(b.retroActual) ? b.retroActual : null,
          bgm: ['normal', 'retro', 'big_chain', 'unconfirmed'].includes(b.bgm) ? b.bgm : null,
          rfLamp: ['white', 'blue', 'yellow', 'green', 'red', 'purple', 'rainbow'].includes(b.rfLamp) ? b.rfLamp : null,
          memo: typeof b.memo === 'string' ? b.memo : '',
        }))
    : [];
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const machineId = str(raw?.machineId, base.machineId);
  return {
    ...base,
    id: str(raw?.id, base.id), date: str(raw?.date, base.date), store: str(raw?.store, ''),
    machineId: machineId === 'newgold-30' ? base.machineId : machineId, tableNo: str(raw?.tableNo, ''),
    lendRate: numN(raw?.lendRate),
    seatTotalGames: numN(raw?.seatTotalGames) ?? 0, seatCurrentGames: numN(raw?.seatCurrentGames) ?? 0,
    seatBig: numN(raw?.seatBig) ?? 0, seatReg: numN(raw?.seatReg) ?? 0,
    gakkun: boolN(raw?.gakkun), resetFlash: raw?.resetFlash === 'unconfirmed' ? 'unconfirmed' : boolN(raw?.resetFlash),
    cashInvest: numN(raw?.cashInvest), medalsUsed: numN(raw?.medalsUsed), payout: numN(raw?.payout),
    finalBalance: numN(raw?.finalBalance),
    ...migrateBells(raw, bonuses),
    bonuses: bonuses.map(({ _oldBells, ...b }: any) => b as Bonus),
    midGames: numN(raw?.midGames), midAt: typeof raw?.midAt === 'string' ? raw.midAt : null,
    endGames: numN(raw?.endGames), endedAt: typeof raw?.endedAt === 'string' ? raw.endedAt : null,
    memo: str(raw?.memo, ''), createdAt: str(raw?.createdAt, base.createdAt), updatedAt: str(raw?.updatedAt, base.updatedAt),
  };
}

/**
 * ベル記録の読込・旧形式からの移行。値は捏造せず、元の値は legacy に保持する。
 *  - 現行形式（bellObs）はそのまま検証して読む。
 *  - 旧形式の「最新ベル累計＋未記録フラグ（bellTotal/bellPending）」は時点を持たないため：
 *      途中保存G（midGames）が残っていればその時点の観測、
 *      終了済み（endGames）なら「ヤメG時点の終了時ベル」として移行（2026-11-18 ユーザー確認済みの移行ルール。migrated で区別）、
 *      どちらも無ければ時点不明として legacyBell（確率計算に使わず要確認表示）。
 *  - v2（区間ベル bonus.bells / curBells）は累計に積み上げてから同じ扱い。v1（session.bells）も同様。
 */
function migrateBells(raw: any, bonuses: any[]): Pick<Session, 'bellObs' | 'legacyBell'> & { legacy?: Record<string, unknown> } {
  const lastId: string | null = bonuses.length ? bonuses[bonuses.length - 1].id : null;
  const ids = new Set(bonuses.map((b) => b.id));
  if (Array.isArray(raw?.bellObs)) {
    const bellObs: BellPoint[] = raw.bellObs
      .filter((p: any) => p && numN(p.counter) != null && numN(p.bells) != null && (p.src === 'mid' || p.src === 'end'))
      .map((p: any) => ({
        id: typeof p.id === 'string' ? p.id : uid(),
        after: typeof p.after === 'string' && ids.has(p.after) ? p.after : typeof p.after === 'string' ? p.after : null,
        counter: p.counter, bells: p.bells, src: p.src, at: typeof p.at === 'string' ? p.at : new Date(0).toISOString(),
        ...(p.migrated === true ? { migrated: true } : {}),
      }));
    const lb = raw?.legacyBell && numN(raw.legacyBell.bells) != null ? { bells: raw.legacyBell.bells, reason: String(raw.legacyBell.reason ?? '時点不明') } : null;
    return { bellObs, legacyBell: lb, ...(raw?.legacy && typeof raw.legacy === 'object' ? { legacy: raw.legacy } : {}) };
  }
  // ---- 旧形式 ----
  const legacy: Record<string, unknown> = {};
  for (const k of ['bellTotal', 'bellPending', 'bells', 'bellsBase', 'curBells']) if (raw && k in raw) legacy[k] = raw[k];
  let total: number | null = null;
  let pending = false;
  if ('bellTotal' in (raw ?? {}) || 'bellPending' in (raw ?? {})) {
    total = numN(raw.bellTotal);
    pending = raw.bellPending === true && total != null;
  } else if (bonuses.some((b) => b._oldBells != null) || numN(raw?.curBells) != null) {
    let acc = numN(raw?.bellsBase) ?? 0;
    let complete = true;
    for (const b of bonuses) {
      if (b._oldBells == null) { complete = false; continue; }
      acc += b._oldBells;
      if (complete) b.bellsAt = acc; // 未入力区間があると以降の累計は確定できないので記録しない
    }
    const cur = numN(raw?.curBells);
    total = complete ? (cur != null ? acc + cur : acc) : null;
    pending = complete && cur != null;
  } else {
    total = numN(raw?.bells) ?? numN(raw?.bellsBase);
    pending = total != null && !bonuses.some((b) => b.bellsAt != null);
  }
  const out: Pick<Session, 'bellObs' | 'legacyBell'> & { legacy?: Record<string, unknown> } = {
    bellObs: [], legacyBell: null, ...(Object.keys(legacy).length ? { legacy } : {}),
  };
  if (!pending || total == null) return out;
  const mid = numN(raw?.midGames);
  const end = numN(raw?.endGames);
  const at = typeof raw?.endedAt === 'string' ? raw.endedAt : typeof raw?.midAt === 'string' ? raw.midAt : new Date(0).toISOString();
  if (mid != null) {
    out.bellObs.push({ id: uid(), after: lastId, counter: mid, bells: total, src: 'mid', at, migrated: true });
  } else if (end != null) {
    out.bellObs.push({ id: uid(), after: lastId, counter: end, bells: total, src: 'end', at, migrated: true });
  } else {
    out.legacyBell = { bells: total, reason: '旧データ：当選・途中保存・終了のどの時点の値か記録されていない' };
  }
  return out;
}

export function normalizePrefs(raw: any): Prefs {
  const stores = Array.isArray(raw?.stores) ? raw.stores.filter((x: unknown) => typeof x === 'string' && x) : [];
  const storeRates: Record<string, number> = {};
  if (raw?.storeRates && typeof raw.storeRates === 'object') {
    for (const [k, v] of Object.entries(raw.storeRates)) if (typeof v === 'number' && isFinite(v)) storeRates[k] = v;
  }
  return { stores, storeRates };
}

export function parseBackup(text: string): AppState {
  const j = JSON.parse(text);
  const st = j?.app === 'HANA LOG' ? j.state : j; // 素の AppState も受け付ける
  if (!st || !Array.isArray(st.sessions)) throw new Error('HANA LOGのバックアップ形式ではありません');
  const sessions = st.sessions.map(normalizeSession);
  const activeId = sessions.some((s: Session) => s.id === st.activeId) ? st.activeId : null;
  return { version: 1, sessions, activeId, prefs: normalizePrefs(st.prefs) };
}
