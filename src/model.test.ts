import { describe, it, expect } from "vitest";
import {
  newSession,
  register,
  totals,
  share,
  parseBackup,
  type Session,
} from "./model";
function hit(s: Session, type: "BIG" | "REG", gap: number) {
  return register({ ...s, currentGap: gap }, type);
}
describe("ゲーム数・履歴を正しく再計算", () => {
  it("14R / 8B / 43R / 476B → 541G", () => {
    let s = newSession();
    for (const [g, type] of [
      [14, "REG"],
      [8, "BIG"],
      [43, "REG"],
      [476, "BIG"],
    ] as const)
      s = hit(s, type, g);
    expect(totals(s).rows.map((b) => b.total)).toEqual([14, 22, 65, 541]);
  });
  it("400Gの途中経過は550G当選に置き換える", () => {
    let s = { ...newSession(), currentGap: 400 };
    s = hit(s, "BIG", 550);
    expect(totals(s).total).toBe(550);
    expect(s.currentGap).toBe(0);
  });
  it("仮登録の詳細を確定しても二重加算しない・スイカ2回", () => {
    const s = hit(newSession(), "BIG", 200);
    expect(s.bonuses).toHaveLength(1);
    expect(s.bonuses[0].complete).toBe(false);
    expect(s.bonuses[0].watermelon).toBeNull();
    const edited = {
      ...s,
      bonuses: s.bonuses.map((b) => ({ ...b, watermelon: 2, complete: true })),
    };
    expect(totals(edited).ownBig).toBe(1);
    expect(totals(edited).bigWater).toEqual({ sum: 2, unknown: 0 });
    expect(totals(edited).total).toBe(200);
  });
  it("過去の当選間G修正で後続累計も更新する", () => {
    let s = hit(hit(newSession(), "BIG", 100), "REG", 200);
    s = {
      ...s,
      currentGap: 30,
      bonuses: s.bonuses.map((b, i) => (i === 0 ? { ...b, gap: 150 } : b)),
    };
    expect(totals(s).rows.map((b) => b.total)).toEqual([150, 350]);
    expect(totals(s).total).toBe(380);
  });
  it("着席時の当選間を他人の実戦から分離する", () => {
    let s = {
      ...newSession(),
      startTotal: 1000,
      startGap: 200,
      currentGap: 200,
      startBig: 3,
      startReg: 2,
    };
    expect(totals(s).own).toBe(0);
    s = hit(s, "BIG", 350);
    expect(totals(s)).toMatchObject({
      total: 1150,
      own: 150,
      big: 4,
      ownBig: 1,
      reg: 2,
    });
  });
  it("開始位置より前の初回当選は拒否する", () => {
    const s = {
      ...newSession(),
      startTotal: 500,
      startGap: 200,
      currentGap: 100,
    };
    expect(() => register(s, "REG")).toThrow();
  });
  it("終了後の登録を拒否する", () =>
    expect(() =>
      register({ ...newSession(), endedAt: new Date().toISOString() }, "BIG"),
    ).toThrow());
});
describe("指定の最終集計（当選間の全履歴未提供につき合成データ）", () => {
  const fixture = () => {
    let s = newSession();
    for (let i = 0; i < 31; i++)
      s = hit(s, i < 16 ? "BIG" : "REG", i === 30 ? 365 : 180);
    s = {
      ...s,
      store: "検証店舗",
      table: "1625",
      currentGap: 284,
      endedAt: new Date().toISOString(),
      bells: 876,
      bonuses: s.bonuses.map((b, i) => ({
        ...b,
        watermelon: i < 16 ? (i < 10 ? 1 : 0) : i < 19 ? 1 : 0,
        side:
          i < 16 ? (i < 6 ? "青" : i < 10 ? "黄" : i < 13 ? "緑" : "赤") : null,
        end: i === 15 || i === 30 ? "青" : "白",
        retroRight: i < 16 ? true : null,
        retroPlayed: i < 16 ? i === 0 : null,
        complete: true,
      })),
    };
    return s;
  };
  it("5765+284=6049、すべての指定集計を再現", () => {
    const t = totals(fixture());
    expect(t).toMatchObject({
      total: 6049,
      big: 16,
      reg: 15,
      retroRight: 16,
      retroPlayed: 1,
    });
    expect(t.bigWater.sum).toBe(10);
    expect(t.regWater.sum).toBe(3);
    expect(t.side).toMatchObject({ 青: 6, 黄: 4, 緑: 3, 赤: 3 });
    expect(t.bigEnd).toMatchObject({ 白: 15, 青: 1 });
    expect(t.regEnd).toMatchObject({ 白: 14, 青: 1 });
    expect(t.rows.at(-1)?.total).toBe(5765);
  });
  it("JSON往復後もデータ・累計・共有テキストが一致", () => {
    const s = fixture(),
      d = { version: 1, sessions: [s], activeId: s.id };
    const restored = parseBackup(JSON.stringify(d));
    expect(restored).toEqual(d);
    expect(totals(restored.sessions[0])).toEqual(totals(s));
    const text = share(restored.sessions[0], true);
    expect(text).toBe(share(s, true));
    for (const piece of ["台累計6049G", "B16/R15", "🔔876", "最終当選間：284Gヤメ"]) {
      expect(text).toContain(piece);
    }
    expect(text.split("｜自然スイカ")).toHaveLength(32);
  });
});
describe("バックアップ・共有の境界", () => {
  it("未入力とゼロを別々に出力", () => {
    let s = hit(newSession(), "BIG", 10);
    expect(share(s, true)).toContain("自然スイカ未記録");
    s.bonuses[0].watermelon = 0;
    s.bonuses[0].end = "白";
    expect(share(s, true)).toContain("自然スイカ0");
    expect(share(s, true)).toContain("終了白");
  });
  it.each([
    null,
    {},
    { version: 2, sessions: [] },
    { version: 1, sessions: [], activeId: "missing" },
  ])("不正な形式を拒否 %j", (v) =>
    expect(() => parseBackup(JSON.stringify(v))).toThrow(),
  );
  it("負数・重複ID・不正ランプ・開始位置の矛盾を拒否", () => {
    const s = hit(newSession(), "REG", 20);
    for (const change of [
      { bells: -1 },
      { bonuses: [s.bonuses[0], s.bonuses[0]] },
      { bonuses: [{ ...s.bonuses[0], end: "赤" }] },
      { startGap: 100, startTotal: 50 },
    ])
      expect(() =>
        parseBackup(
          JSON.stringify({
            version: 1,
            sessions: [{ ...s, ...change }],
            activeId: s.id,
          }),
        ),
      ).toThrow();
  });
});
