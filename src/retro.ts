import type { MachineDef } from './machines';
import type { Bgm, Bonus, Session } from './types';

/**
 * レトロサウンド権利の自動判定。
 * ルールは機種ごとに切り替える。ルールの無い機種は 'manual'（従来どおり手動記録）。
 *
 * ニューキングV 暫定ルール（外部解析資料ベース・公式仕様ではない）：
 *  - 当選間100G以内の当選を「連続」、101G以上で連続状態を解除
 *  - 連続中のBIG2回目からレトロ対象（間にREGを挟んでも100G以内なら継続）
 *  - BIG2連達成後は100G以内のREGも対象
 *  - BIG5連以降は大連続BGM優先で対象外
 *  - 0G台（着席時 総G・BIG・REGすべて0）の初回当選は100G以内でも対象外
 *  - 着席前の当選履歴が分からず、連続中か判断できない場合は「不明」
 */
export type RetroRight = 'yes' | 'no' | 'unknown' | 'manual';

export interface RetroAuto {
  right: RetroRight;
  /** 連続中のBIG回数（不明・手動なら null） */
  chainBig: number | null;
  /** 判定理由（表示用） */
  reason: string;
  /** 大連続BGMが想定される当選 */
  bigChain: boolean;
}

export const CHAIN_LIMIT = 100;
export const BIG_CHAIN_FROM = 5;

/** 0G台（過去の当選履歴がない台）か */
export const isZeroStart = (s: Session): boolean => s.seatTotalGames === 0 && s.seatBig === 0 && s.seatReg === 0;

export function computeRetro(s: Session, m: MachineDef): Map<string, RetroAuto> {
  const out = new Map<string, RetroAuto>();
  if (m.retroRule !== 'nkv-provisional') {
    s.bonuses.forEach((b) => out.set(b.id, { right: 'manual', chainBig: null, reason: 'この機種は自動判定ルール未設定（手動記録）', bigChain: false }));
    return out;
  }
  let known = isZeroStart(s);
  let chainBig = 0;
  s.bonuses.forEach((b, i) => {
    const isBig = b.type === 'BIG';
    if (i === 0 && known) {
      chainBig = isBig ? 1 : 0;
      out.set(b.id, { right: 'no', chainBig, reason: '0G台の初回当選（対象外）', bigChain: false });
      return;
    }
    if (b.games > CHAIN_LIMIT) {
      known = true;
      chainBig = isBig ? 1 : 0;
      out.set(b.id, { right: 'no', chainBig, reason: `${CHAIN_LIMIT + 1}G以上（連続解除）`, bigChain: false });
      return;
    }
    if (!known) {
      out.set(b.id, { right: 'unknown', chainBig: null, reason: '着席前の当選履歴が不明で連続状態を判定できない', bigChain: false });
      return;
    }
    if (isBig) {
      chainBig += 1;
      if (chainBig >= BIG_CHAIN_FROM) out.set(b.id, { right: 'no', chainBig, reason: `BIG${chainBig}連（大連続BGM優先・対象外）`, bigChain: true });
      else if (chainBig >= 2) out.set(b.id, { right: 'yes', chainBig, reason: `BIG${chainBig}連目`, bigChain: false });
      else out.set(b.id, { right: 'no', chainBig, reason: '連続中のBIG1回目（対象外）', bigChain: false });
      return;
    }
    if (chainBig >= BIG_CHAIN_FROM) out.set(b.id, { right: 'no', chainBig, reason: `BIG${chainBig}連中のREG（大連続中・対象外）`, bigChain: true });
    else if (chainBig >= 2) out.set(b.id, { right: 'yes', chainBig, reason: `BIG${chainBig}連達成後のREG`, bigChain: false });
    else out.set(b.id, { right: 'no', chainBig, reason: 'BIG2連前のREG（対象外）', bigChain: false });
  });
  return out;
}

/** 実際に使う権利（自動判定機種は自動値、手動機種は手動記録） */
export function effectiveRight(b: Bonus, auto: RetroAuto | undefined): 'yes' | 'no' | 'unknown' | null {
  if (!auto || auto.right === 'manual') {
    if (b.retroRight === true) return 'yes';
    if (b.retroRight === false) return 'no';
    return b.retroRight === null ? null : 'no';
  }
  return auto.right;
}

/** 旧手動記録と自動判定が食い違うか（自動判定機種のみ。手動記録が無ければ false） */
export function manualMismatch(b: Bonus, auto: RetroAuto | undefined): boolean {
  if (!auto || auto.right === 'manual' || auto.right === 'unknown') return false;
  if (b.retroRight !== true && b.retroRight !== false) return false;
  return (b.retroRight ? 'yes' : 'no') !== auto.right;
}

/** BGM入力 → レトロ実発生（あり/なし/未記録） */
export function actualFromBgm(bgm: Bgm): boolean | null {
  if (bgm === 'retro') return true;
  if (bgm === 'normal' || bgm === 'big_chain') return false;
  return null;
}

export const BGM_LABEL: Record<Exclude<Bgm, null>, string> = {
  normal: '通常', retro: 'レトロ', big_chain: '大連続', unconfirmed: '未確認',
};
