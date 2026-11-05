export const machine = {
  id: "new-king-v",
  name: "ニューキングハナハナV-30",
  sideColors: ["青", "黄", "緑", "赤", "虹"],
  endColors: ["白", "青", "黄", "緑", "紫", "虹"],
};
export type BonusType = "BIG" | "REG";
export type Bonus = {
  id: string;
  at: string;
  type: BonusType;
  gap: number;
  watermelon: number | null;
  side: string | null;
  end: string | null;
  retroRight: boolean | null;
  retroPlayed: boolean | null;
  memo: string;
  complete: boolean;
};
export type Session = {
  id: string;
  date: string;
  store: string;
  machineId: string;
  table: string;
  startTotal: number;
  startGap: number;
  startBig: number;
  startReg: number;
  currentGap: number;
  bells: number;
  cash: number | null;
  medals: number | null;
  recovered: number | null;
  reset: boolean | null;
  resetColor: string | null;
  memo: string;
  bonuses: Bonus[];
  endedAt: string | null;
};
export type Data = { version: 1; sessions: Session[]; activeId: string | null };
export const emptyData: Data = { version: 1, sessions: [], activeId: null };
export const uid = () => crypto.randomUUID();
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function newSession(): Session {
  return {
    id: uid(),
    date: localDate(),
    store: "",
    machineId: machine.id,
    table: "",
    startTotal: 0,
    startGap: 0,
    startBig: 0,
    startReg: 0,
    currentGap: 0,
    bells: 0,
    cash: null,
    medals: null,
    recovered: null,
    reset: null,
    resetColor: null,
    memo: "",
    bonuses: [],
    endedAt: null,
  };
}
export function totals(s: Session) {
  let total = s.startTotal - s.startGap;
  const rows = s.bonuses.map((b) => ({ ...b, total: (total += b.gap) }));
  const counts = (type: BonusType) => s.bonuses.filter((b) => b.type === type);
  const water = (type: BonusType) => ({
    sum: counts(type).reduce((n, b) => n + (b.watermelon ?? 0), 0),
    unknown: counts(type).filter((b) => b.watermelon === null).length,
  });
  const lamps = (type: BonusType, field: "side" | "end") =>
    Object.fromEntries(
      [...new Set([...machine.sideColors, ...machine.endColors, "未記録"])].map(
        (c) => [
          c,
          counts(type).filter((b) => (b[field] ?? "未記録") === c).length,
        ],
      ),
    );
  return {
    rows,
    total: total + s.currentGap,
    own: total + s.currentGap - s.startTotal,
    big: s.startBig + counts("BIG").length,
    reg: s.startReg + counts("REG").length,
    ownBig: counts("BIG").length,
    ownReg: counts("REG").length,
    bigWater: water("BIG"),
    regWater: water("REG"),
    side: lamps("BIG", "side"),
    bigEnd: lamps("BIG", "end"),
    regEnd: lamps("REG", "end"),
    retroRight: counts("BIG").filter((b) => b.retroRight === true).length,
    retroPlayed: counts("BIG").filter((b) => b.retroPlayed === true).length,
  };
}
export function register(s: Session, type: BonusType): Session {
  if (s.endedAt) throw new Error("終了した実戦です");
  if (s.bonuses.length === 0 && s.currentGap < s.startGap)
    throw new Error("着席時の当選間G以上を入力してください");
  return {
    ...s,
    currentGap: 0,
    bonuses: [
      ...s.bonuses,
      {
        id: uid(),
        at: new Date().toISOString(),
        type,
        gap: s.currentGap,
        watermelon: null,
        side: null,
        end: null,
        retroRight: null,
        retroPlayed: null,
        memo: "",
        complete: false,
      },
    ],
  };
}
const known = (n: number | null) => (n === null ? "未記録" : String(n));
const yes = (v: boolean | null) =>
  v === null ? "未記録" : v ? "あり" : "なし";
const lampText = (v: Record<string, number>) =>
  Object.entries(v)
    .filter(([, n]) => n)
    .map(([c, n]) => `${c}${n}`)
    .join("・") || "記録なし";
export function share(s: Session, detail = false) {
  const t = totals(s);
  const w = (v: { sum: number; unknown: number }) =>
    `${v.sum}${v.unknown ? `（未記録${v.unknown}件）` : ""}`;
  const head = `日付：${s.date}\n店舗：${s.store || "未記録"}\n機種：${machine.name}\n台番：${s.table || "未記録"}\n台累計${t.total}G｜B${t.big}/R${t.reg}｜🔔${s.bells}｜自然🍉B${w(t.bigWater)}/R${w(t.regWater)}\n自分の実戦：${t.own}G｜B${t.ownBig}/R${t.ownReg}（ベル・スイカ・ランプは自分の実戦分）`;
  if (!detail) return head;
  return `${head}\n着席時：総${s.startTotal}G・当選間${s.startGap}G・B${s.startBig}/R${s.startReg}\n朝一リセットフラッシュ：${yes(s.reset)}・色${s.resetColor ?? "未記録"}\nBIG後半サイド：${lampText(t.side)}\nBIG終了：${lampText(t.bigEnd)}\nREG終了：${lampText(t.regEnd)}\nレトロ権利：${t.retroRight}（未記録${s.bonuses.filter((b) => b.type === "BIG" && b.retroRight === null).length}件）\nレトロ実発生：${t.retroPlayed}（未記録${s.bonuses.filter((b) => b.type === "BIG" && b.retroPlayed === null).length}件）\n現金投資：${known(s.cash)}円｜使用貯メダル：${known(s.medals)}枚｜回収：${known(s.recovered)}枚\nメモ：${s.memo || "未記録"}\n\n当選履歴（古い順）\n${t.rows.map((b) => `${new Date(b.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}｜${b.gap}G｜${b.type}｜台累計${b.total}G｜自然スイカ${known(b.watermelon)}｜サイド${b.side ?? "未記録"}｜終了${b.end ?? "未記録"}${b.type === "BIG" ? `｜レトロ権利${yes(b.retroRight)}・実発生${yes(b.retroPlayed)}` : ""}｜${b.complete ? "詳細確定" : "仮登録"}${b.memo ? `｜メモ：${b.memo}` : ""}`).join("\n") || "記録なし"}\n${s.endedAt ? "最終" : "現在の"}当選間：${s.currentGap}G${s.endedAt ? "ヤメ" : ""}\n状態：${s.endedAt ? "実戦終了" : "実戦中"}`;
}
// バックアップは信頼せず、すべてのフィールドを検証してから使用する。
export function parseBackup(text: string): Data {
  const d = JSON.parse(text);
  const obj = (v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const num = (v: unknown) =>
    Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 100000000;
  const nullableNum = (v: unknown) => v === null || num(v);
  const str = (v: unknown) => typeof v === "string" && v.length <= 10000;
  const tri = (v: unknown) => v === null || typeof v === "boolean";
  const color = (v: unknown, colors: string[]) =>
    v === null || colors.includes(v as string);
  const stamp = (v: unknown) =>
    str(v) && !Number.isNaN(Date.parse(v as string));
  const ids = new Set<string>();
  const unique = (id: unknown) => {
    if (!str(id) || !id || ids.has(id as string)) return false;
    ids.add(id as string);
    return true;
  };
  if (
    !obj(d) ||
    d.version !== 1 ||
    !Array.isArray(d.sessions) ||
    d.sessions.length > 1000
  )
    throw new Error("対応していないバックアップ形式です");
  for (const s of d.sessions) {
    if (
      !obj(s) ||
      !unique(s.id) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
      !stamp(s.date) ||
      !str(s.store) ||
      !str(s.table) ||
      s.machineId !== machine.id ||
      ![
        "startTotal",
        "startGap",
        "startBig",
        "startReg",
        "currentGap",
        "bells",
      ].every((k) => num(s[k])) ||
      s.startGap > s.startTotal ||
      !["cash", "medals", "recovered"].every((k) => nullableNum(s[k])) ||
      !tri(s.reset) ||
      !color(s.resetColor, machine.endColors) ||
      !str(s.memo) ||
      !(s.endedAt === null || stamp(s.endedAt)) ||
      !Array.isArray(s.bonuses) ||
      s.bonuses.length > 10000
    )
      throw new Error("実戦データに不正な値があります");
    for (const b of s.bonuses)
      if (
        !obj(b) ||
        !unique(b.id) ||
        !stamp(b.at) ||
        !["BIG", "REG"].includes(b.type) ||
        !num(b.gap) ||
        !nullableNum(b.watermelon) ||
        !color(b.side, machine.sideColors) ||
        !color(b.end, machine.endColors) ||
        !tri(b.retroRight) ||
        !tri(b.retroPlayed) ||
        !str(b.memo) ||
        typeof b.complete !== "boolean"
      )
        throw new Error("当選履歴に不正な値があります");
    if ((s.bonuses[0]?.gap ?? s.currentGap) < s.startGap)
      throw new Error("着席時より前のゲーム数です");
  }
  if (
    d.activeId !== null &&
    !d.sessions.some((s: Session) => s.id === d.activeId)
  )
    throw new Error("実戦の参照が不正です");
  return d as Data;
}
