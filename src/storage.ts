import { emptyData, parseBackup, type Data } from "./model";
const KEY = "hana-log:data:v1";
let lastSaved: string | null = null;
export class StorageConflict extends Error {}
export function load(): { data: Data; error: string | null } {
  try {
    const raw = localStorage.getItem(KEY);
    lastSaved = raw;
    return { data: raw ? parseBackup(raw) : emptyData, error: null };
  } catch {
    return {
      data: emptyData,
      error:
        "保存データを読み込めません。上書きを防ぐため操作を停止しました。JSONバックアップを復元するか、ブラウザ内の元データを保全してください。",
    };
  }
}
export function persist(d: Data) {
  if (localStorage.getItem(KEY) !== lastSaved) {
    throw new StorageConflict("別のタブで記録が変更されました。上書きを防ぐため停止しました。この画面の必要な記録をJSONで退避し、再読み込みして最新の記録を確認してください。");
  }
  const next = JSON.stringify(d);
  localStorage.setItem(KEY, next);
  lastSaved = next;
}
export function download(d: Data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `hana-log-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
