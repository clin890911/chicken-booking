# LINE Messaging API / LIFF setup

This folder contains Firebase Cloud Functions for the LINE integration.

## Functions

- `lineBind`: called by the LIFF binding page. It stores the booking + LINE user binding in Firestore and pushes a booking Flex Message plus a location message.
- `lineWebhook`: LINE Messaging API webhook with signature verification.
- `linePushBooking`: reusable endpoint for pushing the latest booking notification after edits/cancellations.

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

## Notes

The frontend still supports LocalStorage mode. For full production reliability, bookings should eventually move to Firestore so the backend can validate booking tokens without relying on client-supplied booking snapshots.
