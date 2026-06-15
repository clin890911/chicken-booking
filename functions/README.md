# LINE Messaging API / LIFF setup

This folder contains Firebase Cloud Functions for the LINE integration.

## Functions

- `lineLoginStart` / `lineLoginCallback`（**目前主要綁定方式**）：LINE Login（OAuth 2.0）網頁授權綁定，
  取代易卡「一直載入」的 LIFF 自動綁定。`lineLoginStart` 驗證訂位後寫一次性 `state` 並 302 導去
  LINE 授權頁（`scope=profile openid`、`bot_prompt=aggressive` 同步加好友）；`lineLoginCallback`
  以授權碼換 token、驗 `id_token` 取 userId/profile、查 friendFlag，沿用 `attachLineBindingAndPush`
  寫綁定並推播確認卡，最後 302 導回 SPA `/line/bind?bound=1`（未加好友帶 `&needFriend=1`）。
  全程純伺服器重導，不依賴 client SDK。
- `lineBind`（**舊版 LIFF 路徑，保留相容**）：LIFF 綁定頁呼叫，存綁定 + 推播。新流程不使用。
- `lineWebhook`: LINE Messaging API webhook with signature verification（follow 事件自動補發未加好友期間的訂位卡）。
- `linePushBooking`: reusable endpoint for pushing the latest booking notification after edits/cancellations.
- `lineMyBookings`: 「LINE 我的訂位」清單查詢（rich menu 入口）。輸入 LIFF `idToken`，
  後端打 `https://api.line.me/oauth2/v2.1/verify` 驗明身分後列出該 LINE 使用者綁定的訂位。
  不綁任何 secret；依賴後台設定 `lineLoginChannelId`（驗證 aud）與 `publicSiteUrl`（組 manageUrl）。

## Required Firebase secrets

```bash
firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN   # Messaging API channel access token（push）
firebase functions:secrets:set LINE_CHANNEL_SECRET         # Messaging API channel secret（webhook 驗簽）
firebase functions:secrets:set LINE_LOGIN_CHANNEL_SECRET   # LINE Login channel secret（OAuth 換 token）
```

## Required app settings

In the admin settings page:

- LINE Official Account URL
- **LINE Login Channel ID**（綁定 + 我的訂位查詢共用）
- **LINE Login 回呼網址** `lineLoginCallbackUrl`，= 部署後的 `lineLoginCallback` 函式網址
  （例：`https://<region>-<project>.cloudfunctions.net/lineLoginCallback`）
- LINE Login 綁定入口 `lineLoginStartEndpoint`（選填；未填用前端預設，建議部署後填入
  `https://<region>-<project>.cloudfunctions.net/lineLoginStart`）
- `publicSiteUrl`（訂位網站正式網址）：OAuth 完成後導回 SPA、以及 LINE 卡片「管理 / 修改訂位」按鈕都需要它
- LINE push endpoint URL, for example `https://<region>-<project>.cloudfunctions.net/linePushBooking`
- Store name / address / phone / Google Maps URL / latitude / longitude
- （LIFF URL / LIFF ID / 「使用 LIFF 自動綁定」為舊版，建議保持關閉）

## LINE Developers console

- Enable Messaging API.
- Enable webhook（follow 事件用於「先綁定、後加好友」的自動補發，務必開啟）.
- Set webhook URL to the deployed `lineWebhook` endpoint.
- **LINE Login channel**：
  - scopes 需含 `openid` + `profile`。
  - **Callback URL** 一字不差加入部署後的 `lineLoginCallback` 函式網址（與後台 `lineLoginCallbackUrl` 相同）。
  - **Linked OA**：把此 Login channel 連動到 Messaging API 官方帳號，`bot_prompt=aggressive` 的「加入好友」
    勾選才會生效（綁定與加好友一步完成）。未加好友時後端跳過首封推播並引導加入，加入後由 follow 事件自動補發。
- （舊版 LIFF：如需保留，建立 `profile` scope 的 LIFF app 並設 endpoint；新流程不依賴。）

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
