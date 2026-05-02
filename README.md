# pacific-stagebook

太平洋岸自転車道を銚子から和歌山へ少しずつ走破するための、静的な計画台帳 + 可視化ツールです。

## What It Does

- OpenStreetMap/Leafletの地図タイル上に、公式KML由来のルート、採用チェックポイント、走破状態を重ねます。
- チェックポイント候補、区間距離、公共交通アクセス、走破記録をJSONで管理します。
- 公共交通アクセスは出発時刻、到着時刻、経路、費用、乗換、輪行条件を手入力で保存します。
- 1日の距離は50-70kmを標準、70km超を注意、90km超を強い警告として判定します。
- 走破記録は連続して進んだフロンティアと、途中を先に走った区間を分けて扱います。
- GitHub Pagesでそのまま配信できます。APIサーバーや認証付き共同編集は持ちません。

## Files

- `index.html`, `styles.css`, `src/app.js`: GitHub Pagesで配信するアプリ本体。
- `data/app-data.json`: 分割データのマニフェスト。通常は編集しません。
- `data/meta.json`: 公式距離、出典、更新日などのメタデータ。
- `data/members.json`: 参加者の表示名と拠点駅。実名ではなく拠点名で管理します。
- `data/checkpoints.json`: チェックポイント。
- `data/accessOptions.json`: 各チェックポイントへの往復アクセス。
- `data/segments.json`: チェックポイント間の区間。
- `data/plans.json`: 採用する計画。
- `data/rides.json`: 実走ログ。計画ステータスとは分けて管理します。
- `data/route.json`: 公式KMLから生成した簡略ルート。
- `data/sources/kml/*.kml`: 公式ページから取得した県別KML。
- `scripts/import-kml.mjs`: KMLを読み、`data/route.json`を再生成します。
- `tests/privacy-check.test.mjs`: 公開データに住所・電話・予約番号らしき値がないかを簡易検査します。

## Local Run

このアプリは静的サイトです。`npm run serve` は npm 製の開発サーバーではなく、`package.json` のショートカットとして Python の標準HTTPサーバーを起動しています。ブラウザ側のHTML/CSS/JavaScriptが実体で、Pythonはファイル配信だけを担当します。

```bash
npm run serve
```

Then open `http://localhost:4173/`.

## JavaScript

このプロジェクトはVanilla JSで進めます。TypeScriptは使わず、「依存を少なく、JSONを編集して即反映できる」ことを優先します。

## Update Route Data

公式KMLを更新したら、`data/sources/kml/` に置いてから再生成します。

```bash
npm run import:kml
```

静岡KMLの公式ファイル名は `Route_shizuoka_.kml` ですが、リポジトリ内では扱いやすく `Route_shizuoka.kml` として保存しています。

## Edit Planning Data

`data/checkpoints.json`, `data/segments.json`, `data/accessOptions.json`, `data/plans.json`, `data/rides.json` を編集してコミットします。`data/app-data.json` は読み込み用のマニフェストです。

`plans.status` は予定の状態を表します。実際に走った日、参加者、部分走破、先行走破は `rides.json` の実走ログとして分けて残します。

公開GitHub Pages前提なので、以下は入れません。

- 詳細住所
- 電話番号
- 予約番号
- 厳密な未来の集合時刻
- 宿泊予約や決済情報

## Verify

```bash
npm test
```

This runs the domain tests and the public-data privacy check.

## Sources

- [太平洋岸自転車道 公式](https://www.kkr.mlit.go.jp/road/pcr/index.html)
- [アクセス・ルートマップ / KML](https://www.kkr.mlit.go.jp/road/pcr/map/index.html)
- [サイクルトレイン・フェリー](https://www.kkr.mlit.go.jp/road/pcr/cycletrain/index.html)
- [トラブル・修理](https://www.kkr.mlit.go.jp/road/pcr/trouble/cycleshop.html)
- [GitHub Pages Docs](https://docs.github.com/pages/getting-started-with-github-pages)
