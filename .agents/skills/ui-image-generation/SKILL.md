---
name: ui-image-generation
description: >-
  Rules and procedures for generating UI illustrations, mockups, and visual assets using generate_image.
  Use whenever creating screenshots, manual illustrations, or UI mockups for this project.
---

# UI画像生成スキルガイドライン

このスキルは、マニュアルやドキュメント、UIデザイン用の画像を生成（generate_image）する際に厳守すべき品質・デザインルールとプロンプト設計手順を定義します。
今後新しいルールを追加・拡張しやすいよう、カテゴリ別に整理されています。

---

## 1. 構図・背景ルール（最優先）

- 背景の写実的なオブジェクトは不要:
  オフィス環境、デスク、キーボード、PC、観葉植物、ユーザーの手や指などの実写・装飾背景は一切含めない。
- 背景の処理:
  画像の外側は、無地の白（#FFFFFF）の完全単色とする。グラデーションや影、葉の陰影なども含めない。
- 純粋なUI画面・コンポーネントのみを描画:
  UIカード、ダイアログ、またはモバイル画面そのものに焦点を当てる。

---

## 2. 端末フレーム・形状の統一ルール（端末のブレ防止）

- スマートフォン本体の形状・フレームを厳密に統一する:
  画像のたびに機種（ホームボタン付き、古いノッチ、Dynamic Islandなど）がバラバラになることを防ぐため、以下のいずれかの規格に厳密に固定する。
  - 基本仕様: スリムな黒ベゼルと上部Dynamic Islandを備えた最新フラットスマートフォン形状（または、物理端末の外枠を描かず角丸スクリーンUIのみを配置するベゼルレス仕様）。
  - 端末フレームの色: つや消しダークグレー/ブラックに固定（シルバーやカラフルな枠は使用しない）。
  - ディスプレイ比率: 縦長の角丸スクリーン（アスペクト比 3:4 または 9:16）で統一。

---

## 3. アプリ実装（コードベース）との完全整合ルール

画像内に表示するテキスト・メッセージ・UI表記は、リポジトリ内の実装（backend/src/index.ts や src/ 配下のコンポーネント）と完全に一致させる。

### LINEトーク画面のメッセージ仕様
- LINE公式アカウントのヘッダー表示: 「kinntai 勤怠管理」
- 従業員からの送信メッセージ（右側の緑吹き出し）:
  - 「出勤」または「退勤」のみ（ユーザー名ラベルなどは出さない、LINEトーク本来のUI）。
- 公式Botからの返信メッセージ（左側の吹き出し）:
  - 出勤打刻時:
    「〇〇さん、おはようございます。
    出勤を打刻しました（08:55）」
  - 退勤打刻時:
    「〇〇さん、お疲れ様でした。
    退勤を打刻しました（18:00）」
  - すでに出勤打刻済みの場合（二重打刻防止）:
    「〇〇さん、本日はすでに出勤打刻済みです（08:55）。
    時刻を変更する場合は勤怠画面から修正してください。」
  - グループ通知（LINEグループ画面の場合）:
    「【出勤通知】
    〇〇さんが出勤しました（08:55）」

### 勤怠アプリ（LIFF）画面のUI仕様
- ヘッダー・表示名: 「kinntai」または従業員名
- デジタル時計: 現在時刻（例: 08:55）
- 振替残高バッジ: 「振替残高: 〇時間〇分」
- メインアクションボタン:
  - 「出勤する」（緑色のプライマリボタン）
  - 「退勤する」（アウトラインまたはセカンダリボタン）
- 下部ナビゲーション:
  - 「打刻」「カレンダー」「各種申請」

---

## 4. プロンプト生成テンプレート

generate_image を呼び出す際は、必ず以下の要素をプロンプトに含めること。

1. 端末フレーム統一指定:
   "Isolated modern smartphone device mockup with slim black bezels and subtle dynamic island, centered, flat minimalist design"
2. 背景排除指定:
   "Pure solid white background #FFFFFF, absolutely no hands, no fingers, no desk, no table, no office, no plants, no shadows, no background clutter"
3. UI内容・正確なテキスト指定:
   コードベースの実装に合致した正確な日本語文面（「〇〇さん、おはようございます。出勤を打刻しました（08:55）」等）
4. スタイル指定:
   "Clean flat Japanese mobile UI illustration, crisp typography, official LINE app aesthetic with green (#06C755) and white colors"

---

## 5. ルール変更・追加履歴

- 2026-10-20: 初版作成。背景不要ルールを定義。
- 2026-10-20: 端末フレーム形状の統一仕様（スリム黒ベゼル/Dynamic Island固定）およびアプリ実装コード（backend/src/index.ts）と完全一致させるメッセージ仕様を追加。
- 2026-10-20: 使い方ガイド向けの全画像（友だち追加、トーク打刻、LIFF打刻、各種申請モーダル、カレンダービュー）の仕様確立と生成を実施。
