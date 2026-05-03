# 🐔 雞王刷刷鍋訂位系統 chicken-booking

Master of Chicken 訂位管理系統。React + Vite + Tailwind CSS。

## 路由

| 路徑 | 說明 |
|------|------|
| `/` | 首頁（客人 / 同仁入口） |
| `/book` | 客人線上訂位 |
| `/confirm/:id` | 訂位確認頁 |
| `/login` | 同仁登入 |
| `/admin` | 管理後台（需登入） |

## 開發

```bash
npm install
npm run dev
```

## 部署

推送到 GitHub 後，Zeabur 自動建置部署。`zeabur.json` 已設定 SPA 路由。

## 資料層

目前所有資料存在 localStorage，service 層已封裝好，未來換 Firestore 只改 `src/services/*.js` 即可。

| Key | 說明 |
|-----|------|
| `chicken_bookings_v1` | 訂位資料 |
| `chicken_tables_v1` | 桌位設定（33 張四人桌 + 19 張六人桌） |
| `chicken_settings_v1` | 系統設定 |
| `chicken_noshow_v1` | No-show 記錄 |
| `chicken_auth_v1` | 登入 session |

## 預設管理員

`berrylin0911@gmail.com`（透過 `VITE_ADMIN_EMAILS` 可加更多，逗號分隔）
