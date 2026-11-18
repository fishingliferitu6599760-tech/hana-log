// HANA LOG データモデル
// 値の区別：null = 未記録 / 0 = 0回を確認 / 'white' = 白を確認 / 'miss' = ビタ押しミス等で判別不可
//           / 'not_applicable' = 機種非対応

export type LampColor = 'white' | 'blue' | 'yellow' | 'green' | 'red' | 'purple' | 'rainbow';
export const NA = 'not_applicable' as const;
export type NotApplicable = typeof NA;
export const MISS = 'miss' as const;

export type LampValue = LampColor | typeof MISS | null | NotApplicable;
/** 自然スイカ：0,1,2 は実数。3 は「3回以上」 */
export type SuikaValue = 0 | 1 | 2 | 3 | null | NotApplicable;
export type YesNo = boolean | null | NotApplicable;
export type BonusType = 'BIG' | 'REG';
/** ボーナス中BGM：通常／レトロ／大連続／未確認（聞き取れなかった等）。null = 未記録 */
export type Bgm = 'normal' | 'retro' | 'big_chain' | 'unconfirmed' | null;
/** リセットフラッシュ：あり／なし／未確認。null = 未記録 */
export type ResetFlash = boolean | 'unconfirmed' | null;

export interface Bonus {
  id: string;
  type: BonusType;
  /** 当選間ゲーム数（台の表示カウンター値） */
  games: number;
  /** この当選時点のベル累計（外部カウンター値。null = 未記録、0 = 観測済みの0回） */
  bellsAt: number | null;
  /** bellsAt の入力経路：当選時に一括入力／当選後に後入力 */
  bellsSrc?: 'bonus' | 'late';
  /** 登録時刻 ISO */
  at: string;
  suika: SuikaValue;
  side: LampValue;
  end: LampValue;
  /** レトロ権利の手動記録（旧方式・自動判定ルールがない機種用）。自動判定機種では新規入力しない */
  retroRight: YesNo;
  /** レトロ実発生（あり/なし/未記録）。BGM入力から自動で設定 */
  retroActual: YesNo;
  /** ボーナス中BGM */
  bgm: Bgm;
  /** リセットフラッシュ時のランプ色（任意。通常の終了ランプ集計には含めない） */
  rfLamp: LampColor | null;
  memo: string;
}

/**
 * 当選間（途中保存・終了時）のベル観測。必ずG時点とセットで持つ。
 * 位置＝after の当選の累計G ＋ counter（after=null は着席時：着席時総G − 着席時表示G ＋ counter）
 */
export interface BellPoint {
  id: string;
  /** 区間の起点となる当選のID（null＝着席時から最初の当選まで） */
  after: string | null;
  /** その区間の当選間G（台の表示カウンター値） */
  counter: number;
  /** その時点のベル累計（着席時0から） */
  bells: number;
  src: 'mid' | 'end';
  at: string;
  /** 旧データから移行した値（ユーザー確認のうえヤメ時点として確定） */
  migrated?: boolean;
}

export interface Session {
  id: string;
  date: string; // YYYY-MM-DD
  store: string;
  machineId: string;
  tableNo: string;
  /** 貸し枚数（1000円あたり） */
  lendRate: number | null;
  /** 着席時の累計G（データ表示機の総G） */
  seatTotalGames: number;
  /** 着席時の当選間G（表示カウンター）。seatTotalGames に含まれている前提 */
  seatCurrentGames: number;
  seatBig: number;
  seatReg: number;
  /** リールガックン（累計0G台のみ） */
  gakkun: boolean | null;
  /** リセットフラッシュ（累計0G台の1回目BIGのみ） */
  resetFlash: ResetFlash;
  cashInvest: number | null;
  medalsUsed: number | null;
  payout: number | null;
  finalBalance: number | null;
  /** 当選間のベル観測（途中保存・終了時）。当選時のベルは各 Bonus.bellsAt */
  bellObs: BellPoint[];
  /** 時点を確定できない旧データのベル値（確率計算には使わず「要確認」表示） */
  legacyBell: { bells: number; reason: string } | null;
  /** 旧形式から移行したときの元の値（原データ保持用） */
  legacy?: Record<string, unknown>;
  bonuses: Bonus[]; // 当選順（古い→新しい）
  /** 途中保存：最終ボーナス後（または着席後）の表示カウンター値 */
  midGames: number | null;
  midAt: string | null;
  /** 実戦終了時の当選間G（ヤメG） */
  endGames: number | null;
  endedAt: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export interface Prefs {
  /** 追加した店舗（その他で入力したもの） */
  stores: string[];
  /** 店舗ごとの貸し枚数（最後に使った値を記憶） */
  storeRates: Record<string, number>;
}

export interface AppState {
  version: 1;
  sessions: Session[];
  activeId: string | null;
  prefs: Prefs;
}
