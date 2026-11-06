import { getMachine, LAMP_EMOJI, MISS_EMOJI, type BonusSpec, type FieldSpec, type MachineDef } from './machines';
import {
  MISS, NA, type AppState, type Bonus, type BonusType, type LampColor, type LampValue, type Prefs, type Session,
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
    bellTotal: null, bellPending: false, bonuses: [], midGames: null, midAt: null, endGames: null, endedAt: null, memo: '',
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
export const probText = (r: number | null): string => (r == null ? '―' : `1/${r.toFixed(1)}`);
export const diffText = (r: { bellDiff: number | null; bellSpan: number }): string =>
  r.bellDiff == null ? '-' : `${r.bellDiff}${r.bellSpan > 1 ? `(${r.bellSpan}区間)` : ''}`;

export interface TimelineRow {
  bonus: Bonus; no: number; cumTotal: number; played: number; warn: boolean;
  /** 前回ベル累計からの差分（ボーナス間ベル）。ベル累計未入力なら null */
  bellDiff: number | null;
  /** 差分を数えた区間のG（前回ベル累計入力時点から） */
  bellGames: number | null;
  /** 差分が何回分の当選区間にまたがるか（途中でベル累計未入力の当選があると2以上） */
  bellSpan: number;
  bellRatio: number | null;
}

/** 古い順の当選履歴と、各当選時点の累計G・ボーナス間ベル（ベル累計の差分）と確率 */
export function timeline(s: Session): TimelineRow[] {
  let cum = s.seatTotalGames;
  let lastBells = 0; // 着席時に外部カウンターを0から数える前提
  let gamesSince = 0;
  let span = 0;
  return s.bonuses.map((b, i) => {
    const add = addedGames(s, i);
    cum += add;
    gamesSince += add;
    span++;
    const row: TimelineRow = { bonus: b, no: i + 1, cumTotal: cum, played: add, warn: add < 0, bellDiff: null, bellGames: null, bellSpan: 0, bellRatio: null };
    if (b.bellsAt != null) {
      row.bellDiff = b.bellsAt - lastBells;
      row.bellGames = gamesSince;
      row.bellSpan = span;
      row.bellRatio = row.bellDiff > 0 ? ratio(gamesSince, row.bellDiff) : null;
      lastBells = b.bellsAt;
      gamesSince = 0;
      span = 0;
    }
    return row;
  });
}

/** 最後にベル累計が記録された当選の値（無ければ0） */
function lastKnownBells(s: Session): number {
  for (let i = s.bonuses.length - 1; i >= 0; i--) if (s.bonuses[i].bellsAt != null) return s.bonuses[i].bellsAt as number;
  return 0;
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
  const rows = timeline(s);
  const base = rows.length ? rows[rows.length - 1].cumTotal : s.seatTotalGames;
  return base + (tailPlayed(s) ?? 0);
}

/** 現在のベル累計 */
export function totalBells(s: Session): number {
  if (s.bellPending && s.bellTotal != null) return s.bellTotal;
  const known = s.bonuses.some((b) => b.bellsAt != null);
  return known ? lastKnownBells(s) : s.bellTotal ?? 0;
}

/** 最終当選以降（未記録の当選を含む）のベル差分と、その区間のG・確率 */
export function bellTail(s: Session): { diff: number | null; games: number | null; ratio: number | null } {
  if (!s.bellPending || s.bellTotal == null) return { diff: null, games: null, ratio: null };
  const diff = s.bellTotal - lastKnownBells(s);
  let g = 0;
  for (let i = s.bonuses.length - 1; i >= 0 && s.bonuses[i].bellsAt == null; i--) g += addedGames(s, i);
  const tp = tailPlayed(s);
  if (tp == null) return { diff, games: null, ratio: null };
  g += tp;
  return { diff, games: g, ratio: diff > 0 ? ratio(g, diff) : null };
}

/** 全体のベル確率：ベル累計が分かっている最後の時点までのGで計算 */
export function bellRatioTotal(s: Session): number | null {
  let g = 0;
  let known: { g: number; n: number } | null = null;
  timeline(s).forEach((r) => {
    g += r.played;
    if (r.bonus.bellsAt != null) known = { g, n: r.bonus.bellsAt };
  });
  const tp = tailPlayed(s);
  if (s.bellPending && s.bellTotal != null && tp != null) known = { g: g + tp, n: s.bellTotal };
  const k = known as { g: number; n: number } | null;
  return k ? ratio(k.g, k.n) : null;
}

// ---------- 集計 ----------
export interface LampCount { counts: Record<LampColor, number>; miss: number; unrecorded: number; na: number; total: number }
export interface SuikaAgg { sum: number; recorded: number; unrecorded: number; na: number; plus: number }
export interface YesNoAgg { yes: number; no: number; unrecorded: number; na: number }

const zeroLamp = (): Record<LampColor, number> => ({ white: 0, blue: 0, yellow: 0, green: 0, red: 0, purple: 0, rainbow: 0 });

function countLamp(list: Bonus[], key: 'side' | 'end'): LampCount {
  const r: LampCount = { counts: zeroLamp(), miss: 0, unrecorded: 0, na: 0, total: list.length };
  for (const b of list) {
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

export function aggregate(s: Session) {
  const bigs = s.bonuses.filter((b) => b.type === 'BIG');
  const regs = s.bonuses.filter((b) => b.type === 'REG');
  const total = totalGames(s);
  return {
    total, myGames: total - s.seatTotalGames,
    myBig: bigs.length, myReg: regs.length,
    big: s.seatBig + bigs.length, reg: s.seatReg + regs.length,
    bells: totalBells(s), bellRatio: bellRatioTotal(s),
    bigSuika: countSuika(bigs), regSuika: countSuika(regs),
    bigSide: countLamp(bigs, 'side'), regSide: countLamp(regs, 'side'),
    bigEnd: countLamp(bigs, 'end'), regEnd: countLamp(regs, 'end'),
    bigRetroRight: countYN(bigs, 'retroRight'), bigRetroActual: countYN(bigs, 'retroActual'),
    regRetroRight: countYN(regs, 'retroRight'), regRetroActual: countYN(regs, 'retroActual'),
    counter: currentCounter(s),
  };
}

/** 詳細記録がすべて埋まっているか（対応項目のみ必須。未確認・非対応は必須にしない） */
export function isComplete(b: Bonus, m: MachineDef): boolean {
  const sp = specOf(m, b.type);
  const need = (f: FieldSpec) => f.support === 'supported';
  if (need(sp.suika) && b.suika === null) return false;
  if (need(sp.side) && b.side === null) return false;
  if (need(sp.end) && b.end === null) return false;
  if (need(sp.retro)) {
    if (b.retroRight === null) return false;
    if (b.retroRight === true && b.retroActual === null) return false;
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

/** ボーナス仮登録。直前に入力したベル累計をこの当選に記録。途中保存・ヤメは解除 */
export function addBonus(s: Session, type: BonusType, games: number, at?: string): Session {
  const b = newBonus(getMachine(s.machineId), type, games, s.bellPending ? s.bellTotal : null, at);
  return touch({ ...s, bonuses: [...s.bonuses, b], bellPending: false, midGames: null, midAt: null, endGames: null, endedAt: null });
}
export function updateBonus(s: Session, id: string, patch: Partial<Bonus>): Session {
  return touch({ ...s, bonuses: s.bonuses.map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b)) });
}
export function setBonusType(s: Session, id: string, type: BonusType): Session {
  const m = getMachine(s.machineId);
  return touch({ ...s, bonuses: s.bonuses.map((b) => (b.id === id ? changeType(b, type, m) : b)) });
}
export function deleteBonus(s: Session, id: string): Session {
  return touch({ ...s, bonuses: s.bonuses.filter((b) => b.id !== id) });
}
/** 当選後にその当選のベル累計を入力（順番自由入力）。最新の当選なら現在のベル累計も更新 */
export function setBonusBells(s: Session, id: string, n: number): Session {
  const v = Math.max(0, Math.floor(n));
  const isLast = s.bonuses[s.bonuses.length - 1]?.id === id;
  const next = updateBonus(s, id, { bellsAt: v });
  return isLast ? { ...next, bellTotal: v, bellPending: false } : next;
}

/** ベル累計を後から入れる対象の当選（最新の当選がベル未入力で、その後ベル入力・途中保存・ヤメがない） */
export function bellTarget(s: Session): Bonus | null {
  const last = s.bonuses[s.bonuses.length - 1];
  if (!last || last.bellsAt != null || s.bellPending || s.midGames != null || s.endGames != null) return null;
  return last;
}

export function setMid(s: Session, games: number | null, at = new Date().toISOString()): Session {
  return touch({ ...s, midGames: games, midAt: games == null ? null : at });
}
/** ベル累計を入力（外部カウンター値。加算せず置き換え）。次のボーナス登録時にその当選へ記録される */
export function setBellTotal(s: Session, n: number | null): Session {
  return touch({ ...s, bellTotal: n == null ? null : Math.max(0, Math.floor(n)), bellPending: n != null });
}
export function endSession(s: Session, endGames: number, at = new Date().toISOString()): Session {
  return touch({ ...s, endGames, endedAt: at, midGames: null, midAt: null });
}
export function reopenSession(s: Session): Session {
  return touch({ ...s, endGames: null, endedAt: null });
}

// ---------- 表示用 ----------
export const suikaText = (v: SuikaValue): string => (v === null ? '未記録' : v === NA ? '-' : v === 3 ? '3+' : String(v));
export const lampText = (v: LampValue): string =>
  v === null ? '未記録' : v === NA ? '-' : v === MISS ? 'ミス' : LAMP_EMOJI[v];
export const ynText = (v: YesNo): string => (v === null ? '未記録' : v === NA ? '-' : v ? 'あり' : 'なし');
const numOr = (v: number | null, unit = ''): string => (v == null ? '未記録' : `${v.toLocaleString('ja-JP')}${unit}`);
const ynOr = (v: boolean | null) => (v == null ? '未記録' : v ? 'あり' : 'なし');

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
    `累計${a.total}G｜B${a.big}/R${a.reg}｜🔔${a.bells}${a.bellRatio ? `(${probText(a.bellRatio)})` : ''}` +
      (suika.length ? `｜🍉${suika.join('/')}` : '') + (unrec.length ? `（🍉未記録${unrec.join('/')}）` : ''),
    '',
  ];
  if (used(m.big.side)) lines.push(`BIG後半：${lampLine(a.bigSide, m.big.side.colors ?? [], true)}`);
  if (used(m.reg.side)) lines.push(`REG中サイド：${lampLine(a.regSide, m.reg.side.colors ?? [], true)}`);
  lines.push(`BIG終了：${lampLine(a.bigEnd, m.big.end.colors ?? [], false)}`);
  lines.push(`REG終了：${lampLine(a.regEnd, m.reg.end.colors ?? [], false)}`);
  lines.push(`レトロ：BIG権利${a.bigRetroRight.yes}/発生${a.bigRetroActual.yes}・REG権利${a.regRetroRight.yes}/発生${a.regRetroActual.yes}`);
  return lines.join('\n');
}

export function shareDetail(s: Session): string {
  const m = getMachine(s.machineId);
  const a = aggregate(s);
  const rows = timeline(s);
  const sa = (x: SuikaAgg) =>
    `${x.recorded === 0 && x.unrecorded > 0 ? '未記録' : `${x.sum}回`}${x.plus ? `（3回以上を3として${x.plus}件含む）` : ''}［記録${x.recorded}/未記録${x.unrecorded}］`;
  const yn = (x: YesNoAgg) => `あり${x.yes}・なし${x.no}・未記録${x.unrecorded}`;
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
    fresh ? `リールガックン：${ynOr(s.gakkun)}／リセットフラッシュ（1回目BIG）：${ynOr(s.resetFlash)}` : 'リールガックン・リセットフラッシュ：対象外（累計0Gの台ではない）',
    '',
    '■集計',
    `累計${a.total}G（うち自分の実戦${a.myGames}G）`,
    `BIG${a.big}（自分${a.myBig}）・REG${a.reg}（自分${a.myReg}）`,
    `ベル累計：${a.bells}回（${probText(a.bellRatio)}、ベル累計が分かっている時点までのGで計算）`,
  ];
  if (used(m.big.suika)) lines.push(`${m.big.suika.label}${nt(m.big.suika)}：${sa(a.bigSuika)}`);
  if (used(m.reg.suika)) lines.push(`${m.reg.suika.label}${nt(m.reg.suika)}：${sa(a.regSuika)}`);
  if (used(m.big.side)) lines.push(`${m.big.side.label}${nt(m.big.side)}：${lampLine(a.bigSide, m.big.side.colors ?? [], true)}`);
  if (used(m.reg.side)) lines.push(`${m.reg.side.label}${nt(m.reg.side)}：${lampLine(a.regSide, m.reg.side.colors ?? [], true)}`);
  lines.push(
    `${m.big.end.label}：${lampLine(a.bigEnd, m.big.end.colors ?? [], true)}`,
    `${m.reg.end.label}：${lampLine(a.regEnd, m.reg.end.colors ?? [], true)}`,
    `BIGレトロ権利：${yn(a.bigRetroRight)}／実発生：${yn(a.bigRetroActual)}`,
    `REGレトロ権利：${yn(a.regRetroRight)}／実発生：${yn(a.regRetroActual)}`,
    `最終ハマリ：${lastHamari}`,
    '',
    '■投資・回収',
    `現金投資：${numOr(s.cashInvest, '円')}／使用貯メダル：${numOr(s.medalsUsed, '枚')}／回収：${numOr(s.payout, '枚')}／最終収支：${s.finalBalance == null ? '未記録' : `${s.finalBalance > 0 ? '+' : ''}${s.finalBalance.toLocaleString('ja-JP')}円`}`,
    '',
    '■当選履歴（古い順）',
    'No|時刻|種別|当選G|累計G|ベル累計|ボーナス間ベル|ベル確率|スイカ|サイド|終了|レトロ権利|レトロ発生|メモ',
    ...rows.map((r) => {
      const b = r.bonus;
      return [
        r.no, hhmm(b.at), b.type, b.games, r.cumTotal, b.bellsAt ?? '未記録', diffText(r), probText(r.bellRatio), suikaText(b.suika),
        lampText(b.side), lampText(b.end), ynText(b.retroRight), ynText(b.retroActual), b.memo.replace(/[|\n]/g, ' '),
      ].join('|');
    }),
  );
  const bt = bellTail(s);
  const tailRow = (label: string, at: string | null, g: number) =>
    `${label}|${hhmm(at)}|-|${g}|${a.total}|${s.bellPending ? s.bellTotal : '未記録'}|${bt.diff ?? '-'}|${probText(bt.ratio)}|-|-|-|-|-|`;
  if (s.endGames != null) lines.push(tailRow('ヤメ', s.endedAt, s.endGames));
  else if (s.midGames != null) lines.push(tailRow('途中', s.midAt, s.midGames));
  if (s.memo) lines.push('', `メモ：${s.memo}`);
  lines.push(
    '',
    '■凡例',
    'サイド＝BIGは後半サイド、REGはREG中サイド／未記録＝観測・入力なし／ミス＝ビタ押しミス等で判別不可／0＝0回を確認／-＝機種の記録対象外／🍉3+＝3回以上（集計は3として加算）／ベル累計＝外部カウンター値／ボーナス間ベル＝前回ベル累計からの差分（(2区間)等は途中にベル累計未入力の当選を含む）',
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
          at: typeof b.at === 'string' ? b.at : new Date(0).toISOString(),
          suika: isSuika(b.suika) ? b.suika : null,
          side: isLamp(b.side) ? b.side : null,
          end: isLamp(b.end) ? b.end : null,
          retroRight: isYN(b.retroRight) ? b.retroRight : null,
          retroActual: isYN(b.retroActual) ? b.retroActual : null,
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
    gakkun: boolN(raw?.gakkun), resetFlash: boolN(raw?.resetFlash),
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
 * ベルの旧形式を累計方式へ移行。
 * v1：session.bells＝累計 → bellTotal。v2：bonus.bells＝区間ベル・curBells＝現在区間 → 累計に積み上げ。
 */
function migrateBells(raw: any, bonuses: any[]): { bellTotal: number | null; bellPending: boolean } {
  if ('bellTotal' in (raw ?? {}) || 'bellPending' in (raw ?? {})) {
    return { bellTotal: numN(raw.bellTotal), bellPending: raw.bellPending === true && numN(raw.bellTotal) != null };
  }
  const hasInterval = bonuses.some((b) => b._oldBells != null) || numN(raw?.curBells) != null;
  if (hasInterval) {
    let acc = numN(raw?.bellsBase) ?? 0;
    let complete = true;
    for (const b of bonuses) {
      if (b._oldBells == null) { complete = false; continue; }
      acc += b._oldBells;
      if (complete) b.bellsAt = acc; // 未入力区間があると以降の累計は確定できないので記録しない
    }
    const cur = numN(raw?.curBells);
    return { bellTotal: complete && cur != null ? acc + cur : complete ? acc : null, bellPending: complete && cur != null };
  }
  const old = numN(raw?.bells) ?? numN(raw?.bellsBase);
  return { bellTotal: old, bellPending: false };
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
  const activeId = sessions.some((s: Session) => s.id === st.activeId) ? st.activeId : sessions[0]?.id ?? null;
  return { version: 1, sessions, activeId, prefs: normalizePrefs(st.prefs) };
}
