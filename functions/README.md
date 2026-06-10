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

## 「LINE 我的訂位」查詢（rich menu）設定

1. **LIFF 加開 `openid` scope**（LINE Developers → LIFF app → Scope 勾 `openid`）。
   漏開的症狀：`liff.getIDToken()` 回 null，查詢頁全員退回電話查詢。
2. **抄 LINE Login Channel ID**：LINE Developers → LIFF 所屬的 **LINE Login channel**
   （⚠️ 不是 Messaging API channel）→ Basic settings → Channel ID。
   填到後台「設定 → LINE → LINE Login Channel ID」。填錯 channel 的症狀：verify 全部 401、全員退回電話查詢。
3. **Rich menu**：LINE Official Account Manager → 聊天室相關 → 圖文選單 → 動作「連結」→
   `https://{訂位網站網址}/line/my-bookings`。LINE in-app browser 內 `liff.login()` 為無感自動登入。
4. **上線前先實測**：先在 LINE 聊天室貼上該連結用真機驗證（自動登入、清單、管理連結、未綁定 fallback），
   通過後再設 rich menu。
5. **Plan B**：若 liff.login 因 LIFF Endpoint URL 範圍限制拒絕從 /line/my-bookings 發起，
   另建第二個 LIFF app（Endpoint URL 直接指 `/line/my-bookings`），rich menu 改指該 app 的
   deep link（`https://liff.line.me/{新liffId}`）——LIFF browser 內連登入跳轉都沒有。

## Notes

The frontend still supports LocalStorage mode. For full production reliability, bookings should eventually move to Firestore so the backend can validate booking tokens without relying on client-supplied booking snapshots.
