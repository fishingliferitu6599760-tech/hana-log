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
  /** この当選時点のベル累計（外部カウンター値。null = 未入力） */
  bellsAt: number | null;
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
  /** 最新のベル累計（🔔=累計で入力した値） */
  bellTotal: number | null;
  /** 最後の当選以降にベル累計が入力され、まだ当選に記録されていない */
  bellPending: boolean;
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
