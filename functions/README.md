# LINE Messaging API / LIFF setup

This folder contains Firebase Cloud Functions for the LINE integration.

## Functions

- `lineBind`: called by the LIFF binding page. It stores the booking + LINE user binding in Firestore and pushes a booking Flex Message plus a location message.
- `lineWebhook`: LINE Messaging API webhook with signature verification.
- `linePushBooking`: reusable endpoint for pushing the latest booking notification after edits/cancellations.
- `lineMyBookings`: 「LINE 我的訂位」清單查詢（rich menu 入口）。輸入 LIFF `idToken`，
  後端打 `https://api.line.me/oauth2/v2.1/verify` 驗明身分後列出該 LINE 使用者綁定的訂位。
  不綁任何 secret；依賴後台設定 `lineLoginChannelId`（驗證 aud）與 `publicSiteUrl`（組 manageUrl）。

## Required Firebase secrets

```bash
firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
firebase functions:secrets:set LINE_CHANNEL_SECRET
```

## Required app settings

In the admin settings page:

- LINE Official Account URL
- LIFF URL
- LIFF ID
- LINE bind endpoint URL, for example `https://<region>-<project>.cloudfunctions.net/lineBind`
- LINE push endpoint URL, for example `https://<region>-<project>.cloudfunctions.net/linePushBooking`
- Store name
- Store address
- Store phone
- Google Maps URL
- Store latitude and longitude

## LINE Developers console

- Enable Messaging API.
- Enable webhook（follow 事件用於「先綁定、後加好友」的自動補發，務必開啟）.
- Set webhook URL to the deployed `lineWebhook` endpoint.
- Create a LIFF app with `profile` scope.
- Set the LIFF endpoint URL to the deployed frontend route or LIFF URL used by the app.
- **Add friend option 設為 aggressive**：LINE Login channel 連結官方帳號後，授權畫面會同時出現
  「加入好友」勾選，讓加好友與授權一步完成（綁定頁也會用 `liff.getFriendship()` 檢查好友狀態，
  未加好友會跳過首封推播並引導加入，加入後由 follow 事件自動補發）。
- 後台設定需填 `publicSiteUrl`（訂位網站正式網址），LINE 卡片才會有「管理 / 修改訂位」按鈕。

## LINE-first 訂位閉環（LIFF Endpoint = 站根）

**架構（2026-06 重構）**：LIFF Endpoint URL 設為**站根**（`https://chicken-booking.zeabur.app/`），
所有頁面用 path-style deep link 進入；LINE 會把 path+query 編進 `?liff.state=` 帶到站根，
由 `src/main.jsx` 的 `resolveLiffStatePath` shim（`src/utils/liffState.js`）在 React 掛載前落地目標頁。

Path-style deep link 清單（rich menu / 文宣用）：

| 用途 | URL |
|---|---|
| **我要訂位**（主入口：LIFF 內訂位＝訂位即綁定＋確認卡即達） | `https://liff.line.me/2009996489-f1SCb75q/book` |
| 查詢 / 管理訂位 | `https://liff.line.me/2009996489-f1SCb75q/line/my-bookings` |
| 綁定通知（確認頁 CTA 自動產生，無需手設） | `https://liff.line.me/2009996489-f1SCb75q/line/bind?bookingId=...` |

訂位即綁定的後端流：`guestCreateBooking` 收 `line.idToken`（LIFF 內前端靜默附帶）→
`verifyLineIdToken` 驗明身分（userId 一律取 claims.sub）→ `attachLineBindingAndPush`
（與 lineBind 端點共用 `lib/lineBinding.js` 的 record 形狀）→ 確認卡即時推播。
全程 best-effort，綁定失敗絕不影響訂位成功。

**Rich menu 建議版面**（LINE OA Manager → 圖文選單）：
大格「我要訂位」＋「查詢訂位」＋「導航到店」（storeMapUrl）＋「撥打電話」（tel:）。

**回退 SOP（順序不可反）**：先在 OA Manager 下架 rich menu → 再把 LIFF Endpoint 改回
`/line/bind`。順序反了 path-style deep link 會全部落在綁定頁。

## 「LINE 我的訂位」查詢設定（前置，均已於 2026-06-10 完成）

1. **LIFF scopes = `openid` + `profile`**。漏開 openid 的症狀：`liff.getIDToken()` 回 null，全員退回電話查詢。
2. **LINE Login Channel ID**（2009996489，抄自 LIFF 所屬 **LINE Login channel**、非 Messaging API channel）
   填在後台「設定 → LINE → LINE Login Channel ID」。填錯 channel 的症狀：verify 全部 401。
3. **上線前先實測**：在 LINE 聊天室貼 deep link 真機驗證，通過後再設 rich menu。

## Notes

The frontend still supports LocalStorage mode. For full production reliability, bookings should eventually move to Firestore so the backend can validate booking tokens without relying on client-supplied booking snapshots.
