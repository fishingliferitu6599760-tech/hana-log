import { newSession } from './logic';
import type { AppState, Session } from './types';

/** 中断中（未終了）の実戦。新しい順 */
export const unfinishedSessions = (st: AppState): Session[] =>
  st.sessions.filter((s) => s.endGames == null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** 終了済みの実戦。新しい順 */
export const endedSessions = (st: AppState): Session[] =>
  st.sessions.filter((s) => s.endGames != null).sort((a, b) => (b.endedAt ?? b.updatedAt).localeCompare(a.endedAt ?? a.updatedAt));

export const lastEndedSession = (st: AppState): Session | null => endedSessions(st)[0] ?? null;

/** 直近に触った実戦（ホームの「同じ店舗で次の台」の基準） */
export const latestSession = (st: AppState): Session | null =>
  [...st.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

/**
 * 同じ店舗で次の台：日付・店舗・貸し枚数だけを引き継ぐ。
 * 機種・台番号・着席時データ・投資・ベル・当選履歴・ランプは引き継がない（新しい独立した実戦）。
 */
export function nextSessionSameStore(prev: Session): Session {
  return newSession({ date: prev.date, store: prev.store, lendRate: prev.lendRate });
}
