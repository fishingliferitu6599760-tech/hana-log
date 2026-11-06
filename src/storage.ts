import type { AppState } from './types';
import { emptyState, parseBackup } from './logic';

/**
 * 保存方式：IndexedDB（主）＋ localStorage（予備ミラー）。
 * どちらもこのブラウザ・この端末内だけに保存される。クラウド同期はしない。
 */
const DB = 'hanalog';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'hanalog.state.v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDb());

async function idbGet(): Promise<string | null> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    r.onsuccess = () => res((r.result as string) ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(v: string): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export type SaveStatus = 'idb' | 'local' | 'none';

export async function loadState(): Promise<{ state: AppState; via: SaveStatus }> {
  const candidates: Array<{ text: string; via: SaveStatus }> = [];
  try {
    const t = await idbGet();
    if (t) candidates.push({ text: t, via: 'idb' });
  } catch { /* IndexedDB 不可 */ }
  try {
    const t = localStorage.getItem(LS_KEY);
    if (t) candidates.push({ text: t, via: 'local' });
  } catch { /* localStorage 不可 */ }
  // 新しい方を採用（片方の書込みが失敗していても復元できる）
  let best: { state: AppState; via: SaveStatus; ts: number } | null = null;
  for (const c of candidates) {
    try {
      const j = JSON.parse(c.text);
      const st = parseBackup(c.text);
      const ts = Number(j.savedAt ?? 0);
      if (!best || ts > best.ts) best = { state: st, via: c.via, ts };
    } catch { /* 壊れたデータは無視 */ }
  }
  return best ? { state: best.state, via: best.via } : { state: emptyState(), via: 'none' };
}

export async function saveState(st: AppState): Promise<SaveStatus> {
  const text = JSON.stringify({ ...st, savedAt: Date.now() });
  let via: SaveStatus = 'none';
  try { localStorage.setItem(LS_KEY, text); via = 'local'; } catch { /* noop */ }
  try { await idbSet(text); via = 'idb'; } catch { /* noop */ }
  return via;
}
