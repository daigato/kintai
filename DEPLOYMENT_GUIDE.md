# 勤怠管理システム デプロイ＆実用化運用ガイド

本ドキュメントは、Cloudflare + LINE（Messaging API / LIFF）を用いた勤怠管理システムの現在の構成、デプロイ情報、および実用化（現場運用）に向けた設定手順と機能ロードマップをまとめたものです。

---

## 1. 現在のデプロイ環境情報

| 項目 | 設定値 / URL |
| :--- | :--- |
| フロントエンド (Cloudflare Pages) | `https://<your-frontend>.pages.dev`（または Workers URL） |
| バックエンドAPI (Cloudflare Workers) | `https://<your-backend>.<your-subdomain>.workers.dev` |
| LINE Webhook URL | `https://<your-backend>.<your-subdomain>.workers.dev/webhook` |
| LINE LIFF ID | `YOUR_LIFF_ID` |
| LIFF URL（LINE内で開くリンク） | `https://liff.line.me/YOUR_LIFF_ID` |
| D1 Database Name | `kinntai-db` |
| D1 Database ID | `YOUR_D1_DATABASE_ID` |

### 実装済み機能の一覧
- LINEトークから「出勤」「退勤」メッセージで打刻
- 友達追加時にLINE表示名で自動ユーザー登録 + 案内メッセージ返信
- LIFF画面（Webダッシュボード）からの出勤・退勤・休憩開始・休憩終了の打刻
- カレンダー表示による月間勤怠一覧
- 管理者ダッシュボード（従業員一覧・全員の勤怠閲覧）

---

## 2. 日常のデプロイ・更新コマンド

### バックエンドの変更を反映する場合
```bash
cd backend
npx wrangler deploy --minify src/index.ts --config wrangler.toml
```
※ `npm run deploy` ではルートの `wrangler.jsonc` が優先される場合があるため、上記のように `--config wrangler.toml` を明示するのが確実です。

### フロントエンドの変更を反映する場合
```bash
# プロジェクトルートで実行
npm run build
npx wrangler pages deploy dist --project-name=kinntai-frontend
```

### ローカル開発サーバーを起動する場合
```bash
# フロントエンド（ポート5173）
npm run dev

# バックエンドローカル（別ターミナル・backendディレクトリ）
cd backend
npm run dev
```
※ ローカルのバックエンドを使う場合は `.env` の `VITE_API_URL` を `http://127.0.0.1:8787` に変更してください。

---

## 3. 実用化のための初期設定チェックリスト

実際の業務で運用を始める前に、以下の設定を順に確認・実施してください。

### ① LINE公式アカウントの応答設定（必須）
標準の自動返信と勤怠ボットの返信が二重に送られるのを防ぐ設定です。

1. [LINE Official Account Manager](https://manager.line.biz/) にログインします。
2. 対象のアカウントを選択し、右上の「設定」>「応答設定」を開きます。
3. 以下のように設定を変更します。
   - 応答モード: 「Bot」
   - あいさつメッセージ: オフにする（友達追加時のあいさつはWebhookから自動送信されるため）
   - 応答メッセージ: 「オフ」
   - AI応答メッセージ: 「オフ」
   - Webhook: 「オン」

### ② Webhook URLの設定確認（必須）
1. [LINE Developers コンソール](https://developers.line.biz/ja/) の「Messaging API」チャネルを開きます。
2. 「Messaging API設定」タブを開きます。
3. Webhook URL に `https://<your-backend>.<your-subdomain>.workers.dev/webhook` が設定されていることを確認します。
4. 「Webhookの利用」がオンになっていることを確認します。
5. 「検証」ボタンを押して、成功（200 OK）が返ることを確認します。

### ③ LIFFのエンドポイントURL設定確認（必須）
1. [LINE Developers コンソール](https://developers.line.biz/ja/) の「LINEログイン」チャネルを開きます。
2. 「LIFF」タブを開き、対象のLIFFアプリを選択します。
3. エンドポイントURL が `https://<your-frontend>.pages.dev`（またはデプロイ先URL）になっていることを確認してください。

### ④ リッチメニューの作成・設置（強く推奨）
トーク画面下部にメニューを固定表示し、ワンタップで打刻や画面起動ができるようにします。
専用の3分割リッチメニュー画像（`public/richmenu.png`）を用意済みです。

1. [LINE Official Account Manager](https://manager.line.biz/) の「トークルーム管理」>「リッチメニュー」を開きます。
2. 「作成」をクリックし、タイトル・表示期間を設定します。
3. 「コンテンツ設定」で「デザインの作成」または「画像をアップロード」を選びます。
   - テンプレート: 小サイズ「3分割（横1列）」を選択
   - 背景画像: プロジェクト内の `public/richmenu.png` をアップロード（または公開先URLからダウンロード）
4. 各ボタンのアクションを以下のように割り当てます。
   - 領域A（左・出勤）: タイプ「テキスト」/ テキスト「出勤」
   - 領域B（中央・退勤）: タイプ「テキスト」/ テキスト「退勤」
   - 領域C（右・勤怠画面）: タイプ「リンク」/ URL「https://liff.line.me/YOUR_LIFF_ID」
5. 「保存」をクリックすると、LINEトーク画面に即時反映されます。

### ⑤ 動作確認テスト
1. LINEアプリでこのLINE公式アカウントを友達追加し、あいさつメッセージが返ることを確認します。
2. トークで「出勤」と送信し、打刻確認メッセージが返ることを確認します。
3. トークで「退勤」と送信し、退勤メッセージが返ることを確認します。
4. LIFF URL（`https://liff.line.me/YOUR_LIFF_ID`）を開き、ダッシュボード画面が表示されることを確認します。
5. Cloudflare ダッシュボード（https://dash.cloudflare.com/ ）の D1 > `kinntai-db` > `users` テーブルにユーザーが登録されていることを確認します。

---

## 4. 管理者向け情報

### データベースの直接確認
1. https://dash.cloudflare.com/ にログインします。
2. 左メニューの「Workers & Pages」>「D1 SQL データベース」を開きます。
3. `kinntai-db` を選択すると、以下のテーブルを直接閲覧できます。
   - `users`: 従業員一覧（id, name, role, line_user_id）
   - `attendance_records`: 打刻履歴（user_id, date, clock_in, clock_out 等）

### 管理者権限の付与
特定のユーザーを管理者にするには、D1のコンソールから以下のSQLを実行します。
```sql
UPDATE users SET role = 'admin' WHERE name = '管理者の名前';
```
または、backendディレクトリから以下のコマンドで実行できます。
```bash
npx wrangler d1 execute kinntai-db --remote --command "UPDATE users SET role = 'admin' WHERE name = '管理者の名前';"
```

---

## 5. 実用化に向けた機能拡張ロードマップ

業務運用をより円滑にするための推奨機能一覧です。

### 優先度：高（実務運用の核となる機能）
1. 勤怠データの CSV / Excel エクスポート
   - 月末の締め日や給与計算ソフト（freee、マネーフォワード、弥生給与など）にインポート可能な形式でダウンロードする機能。
2. 打刻修正・管理者承認機能
   - 打刻忘れや時刻ミスの申請・修正、および管理者による確認・承認フロー。
3. LINEトークでの休憩・再開打刻対応
   - 現在LINEトークからは「出勤」「退勤」のみ対応。「休憩」「再開」メッセージにも対応させる。

### 優先度：中（利便性の向上）
4. 従業員名の編集機能
   - LINE表示名ではなく本名で管理するための名前編集機能（管理者画面から変更）。
5. 有給休暇・代休・シフト管理
   - 休日出勤時の代休自動付与、有給休暇の残日数計算と消化管理。
6. 打刻忘れ防止リマインダー
   - 定時（例: 朝9:00や退勤時刻）に打刻がない場合、LINEへ自動リマインド通知を送信（Cloudflare Cron Triggers連携）。

### 優先度：低（ブランディング・拡張）
7. カスタム独自ドメインの適用
   - `kintai.yourdomain.com` などの独自ドメインでのアクセス設定。
8. CORSオリジン制限（セキュリティ強化）
   - 現在はすべてのオリジンからAPIアクセスが可能。本番運用ではフロントエンドの公開ドメインのみに限定する。
