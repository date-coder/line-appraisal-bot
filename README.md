# line-appraisal-bot

LINEのWebhookを受ける最小のExpressボットです。本番向けにRender/Railwayへそのままデプロイできます。

## 必要環境
- Node.js 18+
- LINE Developersで取得した Messaging API チャネル（`CHANNEL_ACCESS_TOKEN` / `CHANNEL_SECRET`）

## ローカル起動
1. 依存をインストール
   ```bash
   npm install
   ```
2. 環境変数を設定して起動
   ```bash
   export CHANNEL_ACCESS_TOKEN=xxxxx
   export CHANNEL_SECRET=xxxxx
   npm start
   ```
   Windows PowerShell:
   ```powershell
   setx CHANNEL_ACCESS_TOKEN "xxxxx"
   setx CHANNEL_SECRET "xxxxx"
   npm start
   ```

## Webhook URL（開発中）
- ngrokなどで公開し、`https://<ngrok>.ngrok.io/webhook` を LINE Developers の Webhook URL に設定 → Verify → Use webhook 有効化。

## デプロイ（Render）
1. GitHubにpush
2. Render → New → Web Service → リポジトリ選択
3. Start Command: `node app.js`（または `npm start`）
4. Environment → `CHANNEL_ACCESS_TOKEN` / `CHANNEL_SECRET` を登録
5. 公開URLの末尾に `/webhook` を付けて LINE Developers に設定 → Verify

## デプロイ（Railway）
1. New Project → Deploy from GitHub
2. Variables に `CHANNEL_ACCESS_TOKEN` / `CHANNEL_SECRET` を登録
3. 付与されたURLの `/webhook` を LINE Developers に設定 → Verify

## フォルダ構成
```
line-appraisal-bot/
├─ app.js
├─ package.json
├─ .gitignore
├─ lib/
│   └─ flexConfirm.js
└─ templates/
    └─ confirm.json
```
