# HANA LOG（ハナハナ実戦記録）

公開URL：https://fishingliferitu6599760-tech.github.io/hana-log/

iPhoneのSafariで開き「共有 → ホーム画面に追加」で、オフラインでも使えるアプリになります。
以前のChatGPT版は `chatgpt-version` ブランチに残しています。

React + TypeScript + Vite。ビルドすると、JS/CSSを内包した単一の `dist/index.html` ができます。

## コマンド
- `npm install`
- `npm run dev` … 開発サーバー
- `npm test` … 計算・共有テキスト・保存/復元の自動テスト（vitest）
- `npm run build` … `dist/index.html` を生成

## 構成
- `src/types.ts` … データモデル（null=未記録 / 0 / white / not_applicable を区別）
- `src/machines.ts` … 機種定義（項目ごとに 対応/未確認/非対応 とランプ色）。機種追加はここに1件足す
- `src/logic.ts` … 累計G計算・集計・共有テキスト・バックアップ（UIに依存しない純関数）
- `src/storage.ts` … IndexedDB（主）＋ localStorage（予備）
- `src/sample.ts` … 10/25実戦の最終値を再現する合成テストデータ
- `src/App.tsx` / `src/styles.css` … UI

## ゲーム数の計算
累計 = 着席時累計 + Σ当選間G − 着席時の表示G（最初の当選だけ）+ 途中保存G or ヤメG
途中保存・ヤメは「最終当選後の表示カウンター値」なので、次の当選で置き換わり二重加算されない。

## PWA化（iPhoneのホーム画面アプリ化）
1. `npm run build` で作った `dist/` を GitHub Pages / Netlify / Cloudflare Pages など HTTPS の静的ホスティングに置く
2. `manifest.webmanifest`（name, icons, display: standalone, theme_color: #0b0b0d）と、オフライン用の Service Worker を追加する（`vite-plugin-pwa` を使うと簡単）
3. iPhoneのSafariでURLを開いて「共有 → ホーム画面に追加」
※ 保存データはURL（ドメイン）ごとに分かれます。移行するときは、旧ページでJSONバックアップを取ってから新ページで復元してください。
