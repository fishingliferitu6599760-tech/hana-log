import type { LampColor } from './types';

/**
 * 機種定義。共通の記録機能と機種別入力項目を分離する。
 * support:
 *  - 'supported'      … 入力対象（入力完了の判定に含む）
 *  - 'unverified'     … 仕様未確認。入力はできるが「仕様未確認」と明示し、必須にしない
 *  - 'not_applicable' … 非対応。入力欄を出さず、記録上は not_applicable
 * miss: ビタ押しミス等で「判別不可」を選べる項目
 */
export type Support = 'supported' | 'unverified' | 'not_applicable';

export interface FieldSpec {
  support: Support;
  label: string;
  colors?: LampColor[];
  miss?: boolean;
}

export interface BonusSpec { suika: FieldSpec; side: FieldSpec; end: FieldSpec; retro: FieldSpec }

export interface MachineDef {
  id: string;
  name: string;
  short: string;
  big: BonusSpec;
  reg: BonusSpec;
}

const SIDE5: LampColor[] = ['blue', 'yellow', 'green', 'red', 'rainbow'];
const NA_F = (label: string): FieldSpec => ({ support: 'not_applicable', label });
const RETRO: FieldSpec = { support: 'supported', label: 'レトロサウンド' };

/** スター・キング・ドラゴン・ホウオウ共通（シゲヒロさん指定の仕様） */
const standard = (id: string, name: string, short: string): MachineDef => ({
  id, name, short,
  big: {
    suika: { support: 'supported', label: 'BIG中スイカ' },
    side: NA_F('BIG中サイド'),
    end: { support: 'supported', label: 'BIG終了トップランプ', colors: ['white', 'blue', 'yellow', 'green', 'red', 'rainbow'] },
    retro: RETRO,
  },
  reg: {
    suika: NA_F('REG中スイカ'),
    side: { support: 'supported', label: 'REG中サイドランプ', colors: SIDE5, miss: true },
    end: { support: 'supported', label: 'REG終了トップランプ', colors: ['white', 'blue', 'yellow', 'green', 'red', 'rainbow'] },
    retro: RETRO,
  },
});

export const MACHINES: MachineDef[] = [
  {
    id: 'new-king-v30',
    name: 'ニューキングハナハナV-30',
    short: 'ニューキングV-30',
    big: {
      suika: { support: 'supported', label: 'BIG前半スイカ' },
      side: { support: 'supported', label: 'BIG後半サイドランプ', colors: SIDE5, miss: true },
      end: { support: 'supported', label: 'BIG終了トップランプ', colors: ['white', 'blue', 'yellow', 'green', 'purple', 'rainbow'] },
      retro: RETRO,
    },
    reg: {
      suika: { support: 'supported', label: 'REG中スイカ' },
      side: NA_F('REG中サイド'),
      end: { support: 'supported', label: 'REG終了トップランプ', colors: ['white', 'blue', 'yellow', 'green', 'purple'] },
      retro: RETRO,
    },
  },
  standard('star-30', 'スターハナハナ-30', 'スターハナハナ-30'),
  standard('king-30', 'キングハナハナ-30', 'キングハナハナ-30'),
  standard('dragon-30', 'ドラゴンハナハナ～閃光～30', 'ドラゴン閃光-30'),
  standard('houou-30', 'ハナハナホウオウ～天翔～30', 'ホウオウ天翔-30'),
];

export const getMachine = (id: string): MachineDef => MACHINES.find((m) => m.id === id) ?? MACHINES[0];

export const DEFAULT_STORES = ['タイホウ篭山', 'タイホウ鳴海', 'タイホウ相原', 'プレイランドキャッスル東郷'];
export const LEND_RATES = [46, 47, 50];

export const LAMP_EMOJI: Record<LampColor, string> = {
  white: '🤍', blue: '🟦', yellow: '🟡', green: '🟢', red: '🟥', purple: '🟣', rainbow: '🌈',
};
export const LAMP_LABEL: Record<LampColor, string> = {
  white: '白', blue: '青', yellow: '黄', green: '緑', red: '赤', purple: '紫', rainbow: '虹',
};
export const LAMP_CSS: Record<LampColor, string> = {
  white: '#f2f2f2', blue: '#2f7bff', yellow: '#ffd60a', green: '#30d158', red: '#ff453a', purple: '#bf5af2',
  rainbow: 'linear-gradient(135deg,#ff453a,#ffd60a,#30d158,#2f7bff,#bf5af2)',
};
export const MISS_EMOJI = '✖';
