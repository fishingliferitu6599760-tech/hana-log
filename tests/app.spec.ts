import { test, expect, chromium, type Page } from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめの実戦を記録" }).click();
  await page.getByLabel("店舗名", { exact: true }).fill("タイホウ篭山");
  await page.getByLabel("台番号", { exact: true }).fill("1625");
  await page.getByRole("button", { name: "この台で実戦を開始" }).click();
}
async function stored(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("hana-log:data:v1")!),
  );
}
test("仮登録→詳細確定→再読み込み→オフライン記録→共有・JSON復元", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.getByLabel("現在の当選間ゲーム数").fill("400");
  await page.reload();
  await expect(page.getByLabel("現在の当選間ゲーム数")).toHaveValue("400");
  await page.getByLabel("現在の当選間ゲーム数").fill("550");
  await page.getByRole("button", { name: "BIG 仮登録", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".stats")).toContainText("550");
  await page.locator(".history-row").click();
  await page.getByLabel("BIG前半の自然スイカ").fill("2");
  await page
    .getByRole("dialog")
    .locator(".field")
    .filter({ has: page.getByText("BIG後半 サイドランプ", { exact: true }) })
    .getByRole("button", { name: "緑", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .locator(".field")
    .filter({ has: page.getByText("BIG終了時 ランプ", { exact: true }) })
    .getByRole("button", { name: "白", exact: true })
    .click();
  await page.getByRole("button", { name: "詳細を確定する" }).click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await page.getByRole("button", { name: "ベルを1回増やす" }).click();
  await page.getByRole("button", { name: "ベル累計を直接入力" }).click();
  await page.getByLabel("ベル累計", { exact: true }).fill("307");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const before = await stored(page);
  await page.reload();
  expect(await stored(page)).toEqual(before);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel("現在の当選間ゲーム数").fill("8");
  await page.getByRole("button", { name: "REG 仮登録", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(2);
  await expect(page.locator(".stats")).toContainText("558");
  await page.getByRole("button", { name: "ChatGPTに共有" }).click();
  await page.getByRole("button", { name: "詳細共有", exact: true }).click();
  const text = await page
    .getByRole("textbox", { name: "共有テキスト" })
    .inputValue();
  expect(text).toContain("台累計558G");
  expect(text).toContain("自然スイカ2");
  expect(text).toContain("終了白");
  expect(text).toContain("🔔307");
  expect(text).toContain("自然スイカ未記録");
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await page.getByRole("button",{name:"テキストをコピー",exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(text);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "バックアップと設定" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "全実戦をJSONで保存" }).click();
  const download = await dl;
  const backup = await stored(page);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "ベルを1回増やす" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .locator("input[type=file]")
    .setInputFiles((await download.path())!);
  await expect
    .poll(async () => JSON.stringify(await stored(page)))
    .toBe(JSON.stringify(backup));
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/mobile-record.png",
    fullPage: true,
    scale: "css",
  });
});
test("開始位置を分離し、履歴修正・取り消し・実戦終了を保存", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめの実戦を記録" }).click();
  await page.getByLabel("台の総ゲーム数", { exact: true }).fill("1000");
  await page.getByLabel("現在の当選間G", { exact: true }).fill("200");
  await page.getByLabel("着席時 BIG", { exact: true }).fill("3");
  await page.getByRole("button", { name: "この台で実戦を開始" }).click();
  await page.getByLabel("現在の当選間ゲーム数").fill("350");
  await page.getByRole("button", { name: "BIG 仮登録", exact: true }).click();
  await expect(page.locator(".own-line")).toContainText("150 G");
  await page.locator(".history-row").click();
  await page.getByLabel("当選間ゲーム数", { exact: true }).fill("400");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator(".own-line")).toContainText("200 G");
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expect(page.locator(".own-line")).toContainText("150 G");
  await page
    .getByRole("button", { name: "実戦を終了する", exact: true })
    .click();
  await page.getByLabel("最終ハマリゲーム数").fill("284");
  await page.getByRole("button", { name: "記録して実戦を終了" }).click();
  await expect(
    page.getByRole("button", { name: "BIG 仮登録", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".stats")).toContainText("1,434");
  await page.reload();
  await expect(page.locator(".status")).toHaveText("実戦終了");
});
test("フォーム途中の復元、複数実戦の独立保存、狭い画面での表示", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめの実戦を記録" }).click();
  await page.getByLabel("店舗名", { exact: true }).fill("入力途中の店舗");
  await page.reload();
  await page.getByRole("button", { name: "はじめの実戦を記録" }).click();
  await expect(page.getByLabel("店舗名", { exact: true })).toHaveValue(
    "入力途中の店舗",
  );
  await page.getByRole("button", { name: "この台で実戦を開始" }).click();
  await page.getByLabel("現在の当選間ゲーム数").fill("14");
  await page.getByRole("button", { name: "REG 仮登録", exact: true }).click();
  await page.getByRole("button", { name: "新規実戦", exact: true }).click();
  await page.getByLabel("店舗名", { exact: true }).fill("別の台");
  await page.getByRole("button", { name: "この台で実戦を開始" }).click();
  await expect(page.locator(".history-row")).toHaveCount(0);
  await page.getByRole("button", { name: "実戦一覧", exact: true }).click();
  await expect(page.locator(".session-card")).toHaveCount(2);
  await page
    .locator(".session-card")
    .filter({ hasText: "入力途中の店舗" })
    .click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  for (const width of [320, 375, 390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/desktop-record.png",
    fullPage: true,
    scale: "css",
  });
});
test("破損データを上書きしない・不正バックアップを拒否", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("hana-log:data:v1", "broken"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("上書きを防ぐ");
  await page.getByRole("button", { name: "はじめの実戦を記録" }).click();
  await page.getByRole("button", { name: "この台で実戦を開始" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("hana-log:data:v1")),
  ).toBe("broken");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":2}'),
    });
  await expect(page.getByRole("status")).toContainText("復元できません");
  expect(
    await page.evaluate(() => localStorage.getItem("hana-log:data:v1")),
  ).toBe("broken");
});
test("保存失敗を検知し未保存操作を反映しない", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "ベルを1回増やす" }).click();
  await expect(page.getByRole("alert")).toContainText("保存に失敗");
  expect((await stored(page)).sessions[0].bells).toBe(0);
  await expect(
    page.getByRole("button", { name: "BIG 仮登録", exact: true }),
  ).toBeDisabled();
});

test("ブラウザを完全終了しても入力途中の詳細と実戦が復元される",async()=>{
 const profile=await mkdtemp(join(tmpdir(),"hana-log-browser-"));
 const options={executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"],baseURL:"http://127.0.0.1:4173",viewport:{width:390,height:844}};
 let context=await chromium.launchPersistentContext(profile,options);
 try {
  let page=await context.newPage();await start(page);
  await page.getByLabel("現在の当選間ゲーム数").fill("43");await page.getByRole("button",{name:"REG 仮登録",exact:true}).click();await page.locator(".history-row").click();await page.getByLabel("REG中の自然スイカ",{exact:true}).fill("2");
  const before=await stored(page);await context.close();
  context=await chromium.launchPersistentContext(profile,options);page=await context.newPage();await page.goto("/");expect(await stored(page)).toEqual(before);await expect(page.locator(".history-row")).toHaveCount(1);await page.locator(".history-row").click();await expect(page.getByLabel("REG中の自然スイカ",{exact:true})).toHaveValue("2");expect((await stored(page)).sessions[0].bonuses[0].complete).toBe(false);
 } finally {await context.close();await rm(profile,{recursive:true,force:true});}
});

test("他の画面の更新を古いデータで上書きしない",async({page,context})=>{
 await start(page);
 const other=await context.newPage();await other.goto("/");
 await other.getByRole("button",{name:"ベルを1回増やす"}).click();
 await page.getByRole("button",{name:"ベルを1回増やす"}).click();
 await expect(page.getByRole("alert")).toContainText("別のタブ");
 expect((await stored(page)).sessions[0].bells).toBe(1);
 await page.reload();await expect(page.getByRole("button",{name:"ベル累計を直接入力"})).toContainText("1");
});
