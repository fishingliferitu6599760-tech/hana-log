/**
 * 実戦分析（グラフ用）の集計。既存の記録データから読み取り専用で計算し、データは一切変更しない。
 * 単位の違う値（回数・確率・ベル）は別系列として返し、1本の曲線に合成しない。
 */
import { getMachine, type FieldSpec } from './machines';
import { aggregate, bellObservations, resetFlashBonusIds, timeline, totalGames, type BellObservation } from './logic';
import { MISS, NA, type BonusType, type LampColor, type Session } from './types';

export interface Pt { x: number; y: number }

// ---------- A. BIG・REG推移（階段状） ----------
export interface BonusStep { no: number; x: number; type: BonusType; games: number; big: number; reg: number }
export interface BonusSeries {
  x0: number; xEnd: number;
  big0: number; reg0: number;
  steps: BonusStep[];
  /** 最終当選（なければ着席時）から現在までのハマリG */
  hamari: number;
}

export function bonusSeries(s: Session): BonusSeries {
  let big = s.seatBig;
  let reg = s.seatReg;
  const steps = timeline(s).map((r) => {
    if (r.bonus.type === 'BIG') big++; else reg++;
    return { no: r.no, x: r.cumTotal, type: r.bonus.type, games: r.bonus.games, big, reg };
  });
  const xEnd = totalGames(s);
  const lastX = steps.length ? steps[steps.length - 1].x : s.seatTotalGames;
  return { x0: s.seatTotalGames, xEnd, big0: s.seatBig, reg0: s.seatReg, steps, hamari: Math.max(0, xEnd - lastX) };
}

/** 横軸の累計G位置での BIG・REG 回数（タップ表示用） */
export function countsAt(bs: BonusSeries, x: number): { big: number; reg: number } {
  let big = bs.big0;
  let reg = bs.reg0;
  for (const st of bs.steps) {
    if (st.x > x) break;
    big = st.big;
    reg = st.reg;
  }
  return { big, reg };
}

export const ratioOf = (games: number, n: number): number | null => (n > 0 && games > 0 ? games / n : null);

/**
 * 合算確率の推移（のこぎり型・厳密値）。当選間は分子だけ増えるので直線で上がり、当選で下がる。
 * 当選が1回も無い間は確率を定義できないので点を作らない。
 */
export function combinedSeries(bs: BonusSeries): Pt[] {
  const pts: Pt[] = [];
  let n = bs.big0 + bs.reg0;
  if (n > 0 && bs.x0 > 0) pts.push({ x: bs.x0, y: bs.x0 / n });
  for (const st of bs.steps) {
    if (n > 0) pts.push({ x: st.x, y: st.x / n });
    n = st.big + st.reg;
    if (st.x > 0) pts.push({ x: st.x, y: st.x / n });
  }
  if (n > 0 && bs.xEnd > (pts.length ? pts[pts.length - 1].x : 0)) pts.push({ x: bs.xEnd, y: bs.xEnd / n });
  return pts;
}

// ---------- B. ベル確率推移（観測点のみ） ----------
export interface BellObs {
  x: number;
  /** 自分の実戦G（着席から） */
  games: number;
  bells: number;
  /** 累計ベル確率 1/X の X */
  ratio: number | null;
  /** 直前の観測点との間にベル未記録の当選がある（＝その区間は観測していない） */
  gapBefore: boolean;
  label: string;
  kind: BellObservation['kind'];
}

/**
 * ベル累計が記録された地点だけを確定観測点とする（未記録区間は推定しない）。
 * ベル累計は着席時0から数える前提（既存の差分計算と同じ）。0回の記録は 0 として扱い、未記録とは区別する。
 */
export function bellSeries(s: Session): BellObs[] {
  const rows = timeline(s);
  return bellObservations(s).map((o, k, arr) => {
    const prevX = k > 0 ? arr[k - 1].x : s.seatTotalGames;
    // 直前の観測との間に、ベル未記録の当選があるか（その区間は観測していない）
    const gap = k > 0 && rows.some((r) => r.cumTotal > prevX && r.cumTotal <= o.x && r.bonus.bellsAt == null);
    return { x: o.x, games: o.my, bells: o.bells, ratio: ratioOf(o.my, o.bells), gapBefore: gap, label: o.label, kind: o.kind };
  });
}

// ---------- C. BIG中スイカ（記録済みBIG1回あたり平均） ----------
export interface SuikaPt { x: number; no: number; avg: number; recorded: number; sum: number; plus: number; unrecorded: number }

/** 未記録BIGは分母に入れない。3回以上(3+)は3として加算（既存集計と同じ） */
export function suikaSeries(s: Session): { pts: SuikaPt[]; support: FieldSpec['support']; label: string } {
  const m = getMachine(s.machineId);
  const pts: SuikaPt[] = [];
  let sum = 0, recorded = 0, plus = 0, unrecorded = 0;
  for (const r of timeline(s)) {
    if (r.bonus.type !== 'BIG') continue;
    const v = r.bonus.suika;
    if (v === null) { unrecorded++; continue; }
    if (v === NA) continue;
    sum += v;
    recorded++;
    if (v === 3) plus++;
    pts.push({ x: r.cumTotal, no: r.no, avg: sum / recorded, recorded, sum, plus, unrecorded });
  }
  return { pts, support: m.big.suika.support, label: m.big.suika.label };
}

// ---------- D. ランプ示唆（色別回数・割合・出現時点） ----------
export type LampKey = 'bigSide' | 'regSide' | 'bigEnd' | 'regEnd';
export interface LampEvent { x: number; no: number; value: LampColor | typeof MISS }
export interface LampStat {
  key: LampKey;
  label: string;
  support: FieldSpec['support'];
  colors: LampColor[];
  counts: Record<LampColor, number>;
  /** 色を観測できた回数（割合の分母。ミス・未記録・除外は含めない） */
  observed: number;
  miss: number;
  unrecorded: number;
  excluded: number;
  events: LampEvent[];
}

/**
 * 詳細判別に出すランプ項目（機種の仕様に従う）。
 * サイドランプは機種で記録する方だけ：ニューキングV＝BIG後半サイド、スター・キング・ドラゴン・ホウオウ＝REG中サイド。
 */
export function lampKeysFor(s: Session): LampKey[] {
  const m = getMachine(s.machineId);
  const side: LampKey[] = [];
  if (m.big.side.support !== 'not_applicable') side.push('bigSide');
  if (m.reg.side.support !== 'not_applicable') side.push('regSide');
  return [...side, 'bigEnd', 'regEnd'];
}

export function lampStat(s: Session, key: LampKey): LampStat {
  const m = getMachine(s.machineId);
  const spec = key === 'bigSide' ? m.big.side : key === 'regSide' ? m.reg.side : key === 'bigEnd' ? m.big.end : m.reg.end;
  const type: BonusType = key === 'bigSide' || key === 'bigEnd' ? 'BIG' : 'REG';
  const field = key === 'bigSide' || key === 'regSide' ? 'side' : 'end';
  const rf = key === 'bigEnd' ? resetFlashBonusIds(s) : new Set<string>();
  const counts: Record<LampColor, number> = { white: 0, blue: 0, yellow: 0, green: 0, red: 0, purple: 0, rainbow: 0 };
  let observed = 0, miss = 0, unrecorded = 0, excluded = 0;
  const events: LampEvent[] = [];
  for (const r of timeline(s)) {
    if (r.bonus.type !== type) continue;
    if (rf.has(r.bonus.id)) { excluded++; continue; }
    const v = r.bonus[field];
    if (v === null) { unrecorded++; continue; }
    if (v === NA) continue;
    if (v === MISS) { miss++; events.push({ x: r.cumTotal, no: r.no, value: MISS }); continue; }
    counts[v]++;
    observed++;
    events.push({ x: r.cumTotal, no: r.no, value: v });
  }
  return { key, label: spec.label, support: spec.support, colors: spec.colors ?? [], counts, observed, miss, unrecorded, excluded, events };
}

// ---------- 判断サポート（事実ベースの短い説明のみ） ----------
export interface WindowCount { from: number; to: number; big: number; reg: number }

/** 直近wGのBIG・REG回数。自分の実戦がwG以上あるときだけ正確に計算できる */
export function recentWindow(s: Session, w: number): WindowCount | null {
  const to = totalGames(s);
  if (to - s.seatTotalGames < w) return null;
  const from = to - w;
  let big = 0, reg = 0;
  for (const r of timeline(s)) if (r.cumTotal > from && r.cumTotal <= to) { if (r.bonus.type === 'BIG') big++; else reg++; }
  return { from, to, big, reg };
}

// ---------- 区間比較（直近1,000G／その前の1,000G） ----------
export interface BellSegment {
  fromLabel: string; toLabel: string;
  /** 自分の実戦G上の範囲 (from, to] */
  fromMy: number; toMy: number;
  games: number; bells: number; ratio: number | null;
  /** 区間内にベル未記録の当選がある（区間の合計は実測だが内訳は不明） */
  gap: boolean;
}

/** 連続するベル観測の間の区間（実測値のみ。着席時0回から開始） */
export function bellSegments(s: Session): BellSegment[] {
  const obs = bellSeries(s);
  const out: BellSegment[] = [];
  let prev = { label: '着席時', my: 0, bells: 0 };
  for (const o of obs) {
    const games = o.games - prev.my;
    const bells = o.bells - prev.bells;
    out.push({ fromLabel: prev.label, toLabel: o.label, fromMy: prev.my, toMy: o.games, games, bells, ratio: bells > 0 ? ratioOf(games, bells) : null, gap: o.gapBefore });
    prev = { label: o.label, my: o.games, bells: o.bells };
  }
  return out;
}

export interface WindowStat {
  label: string;
  /** 自分の実戦G上の範囲 (fromMy, toMy] */
  fromMy: number; toMy: number;
  big: number; reg: number;
  /** この区間に完全に含まれるベル実測区間の合計（推定なし）。含まれる区間が無ければ null */
  bell: { games: number; bells: number; ratio: number | null } | null;
}

/**
 * 直近wGとその前のwG（重ならない区間）。当選は (from, to] に入るものを数え、境界の当選は二重計上しない。
 * 自分の実戦が 2w G 以上のときだけ返す。
 */
export function windowCompare(s: Session, w = 1000): WindowStat[] | null {
  const a = aggregate(s);
  if (a.myGames < w * 2) return null;
  const rows = timeline(s);
  const segs = bellSegments(s);
  const make = (label: string, fromMy: number, toMy: number): WindowStat => {
    let big = 0, reg = 0;
    for (const r of rows) {
      const my = r.cumTotal - s.seatTotalGames;
      if (my > fromMy && my <= toMy) { if (r.bonus.type === 'BIG') big++; else reg++; }
    }
    const inside = segs.filter((g) => g.fromMy >= fromMy && g.toMy <= toMy && g.games > 0);
    const bg = inside.reduce((x, g) => x + g.games, 0);
    const bb = inside.reduce((x, g) => x + g.bells, 0);
    return { label, fromMy, toMy, big, reg, bell: inside.length ? { games: bg, bells: bb, ratio: bb > 0 ? ratioOf(bg, bb) : null } : null };
  };
  const to = a.myGames;
  return [make(`その前の${w.toLocaleString()}G`, to - 2 * w, to - w), make(`直近${w.toLocaleString()}G`, to - w, to)];
}

export const MIN_GAMES = 1000;
export const MIN_BONUS = 8;

export function supportComments(s: Session): string[] {
  const a = aggregate(s);
  const out: string[] = [];
  const myN = a.myBig + a.myReg;
  if (a.myGames < MIN_GAMES || myN < MIN_BONUS) {
    out.push(`現在の記録数では傾向判断に十分な材料がありません（自分の実戦${a.myGames.toLocaleString()}G・ボーナス${myN}回）。`);
    return out;
  }
  if (a.myBig >= a.myReg * 1.5 && a.myBig - a.myReg >= 3) out.push('BIGが先行しています。REG・ベル・設定示唆も合わせて評価してください。');
  else if (a.myReg >= a.myBig * 1.5 && a.myReg - a.myBig >= 3) out.push('REGが先行しています。BIG・ベル・設定示唆も合わせて評価してください。');
  for (const w of [1000]) {
    const rw = recentWindow(s, w);
    if (!rw || a.myGames < w * 2) continue;
    const exp = (a.myReg / a.myGames) * w;
    if (exp >= 2 && rw.reg <= exp * 0.5) {
      out.push(`直近${w.toLocaleString()}GでREG当選ペースが低下しています（直近${rw.reg}回／全体ペースなら約${exp.toFixed(1)}回）。累計値と他の判別要素を確認してください。`);
    } else if (exp >= 1 && rw.reg >= exp * 1.5 && rw.reg - exp >= 2) {
      out.push(`直近${w.toLocaleString()}GはREG当選ペースが全体より速めです（直近${rw.reg}回／全体ペースなら約${exp.toFixed(1)}回）。短期の変動を含むため累計値と合わせて確認してください。`);
    }
  }
  const wc = windowCompare(s);
  if (wc) {
    const [p, q] = wc;
    out.push(`区間比較：その前の1,000G は BIG${p.big}・REG${p.reg}、直近1,000G は BIG${q.big}・REG${q.reg}。1,000G単位は回数のぶれが大きいため、累計値と合わせて確認してください。`);
  }
  const obs = bellSeries(s).filter((o) => o.ratio != null);
  if (obs.length >= 2) {
    const p = obs[obs.length - 2], q = obs[obs.length - 1];
    const seg = ratioOf(q.games - p.games, q.bells - p.bells);
    if (seg != null && q.ratio != null) out.push(`直近のベル実測区間（自分の実戦${p.games.toLocaleString()}〜${q.games.toLocaleString()}G・${q.games - p.games}G・${q.bells - p.bells}回）は1/${seg.toFixed(1)}、累計は1/${q.ratio.toFixed(2)}です。`);
  }
  if (out.length === 0) out.push('記録上、BIG・REGの偏りや直近の大きな変化は見られません。他の判別要素と合わせて確認してください。');
  return out;
}

export const SUPPORT_NOTE = '※判断補助の表示です。設定の断定や続行・撤退の指示ではありません。最終判断はご自身で行ってください。';
