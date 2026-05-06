# 🐔 雞王刷刷鍋訂位系統 chicken-booking

Master of Chicken 訂位 + 現場座位管理系統。React + Vite + Tailwind CSS。

## 功能總覽

- **🪑 現場營運**：1F / 2F 桌位地圖（按實體平面圖配置）、5 種狀態即時顯示、抽屜操作、即將到達訂位、候位側欄
- **📋 訂位**：今日 / 日曆 / 新增 三 sub-tabs，含「指派桌」一鍵串接到桌位地圖
- **🚦 候位**：取號、叫號、棄號、拖到空桌一鍵入座
- **👥 顧客檔**：自動由訂位/候位 upsert，支援 VIP 等級、過敏紀錄、黑名單
- **⚙️ 設定**：營業時段、桌位啟用、no-show 查詢、CSV 匯出、危險操作（重設）
- **🌐 客人前端**：步驟式訂位（人數 → 日期 → 時段 → 個資 → 確認）

## 路由

| 路徑 | 說明 |
|------|------|
| `/` | 首頁（客人 / 同仁入口） |
| `/book` | 客人線上訂位（步驟式） |
| `/confirm/:id` | 訂位確認頁 |
| `/login` | 同仁登入 |
| `/admin` | 管理後台（需登入，桌面版側邊導航 + 手機版底部導航） |

## 開發

```bash
npm install
npm run dev
```

如果 build 報 EPERM（macOS dist 鎖死）：

```bash
rm -rf dist node_modules package-lock.json
npm install
npm run build
```

## 部署

推送到 GitHub 後，Zeabur 自動建置部署。`zeabur.json` 已設定 SPA 路由。

## 資料層

目前所有資料存在 LocalStorage，service 層已封裝好，未來換 Firestore 只改 `src/services/*.js` 即可。

| Key | 說明 |
|-----|------|
| `chicken_bookings_v1` | 訂位資料（含 `assignedTableId`） |
| `chicken_tables_v2` | 桌位設定（52 桌，含 1F/2F 平面座標、狀態、瓦斯型態） |
| `chicken_waitlist_v1` | 候位記錄 |
| `chicken_customers_v1` | 顧客檔（phone 為主鍵自動去重） |
| `chicken_settings_v1` | 系統設定（營業時段） |
| `chicken_noshow_v1` | No-show 黑名單記錄 |
| `chicken_auth_v1` | 登入 session |

## 桌位平面圖

按鹿芝谷主場館實體配置：

- **1F 主用餐區**：17 桌（7 × 6P + 10 × 4P）
  - 西側靠牆：B1–B4（6P）
  - 中央：A1–A4（4P）/ B5–B7（6P）/ A5–A10（4P）
- **2F 用餐區**：35 桌（12 × 6P + 23 × 4P）
  - 北區（天然氣）：B8–B15、A11–A16
  - 南左區（天然氣）：A17–A26
  - 南右區（瓦斯桶）：A27–A33、B16–B19

桌位座標可在 `src/data/tables.js` 調整。UI 後台拖拉編輯為 P2 功能。

## 角色權限

四種角色，由 `VITE_ROLE_MAP` 環境變數定義（JSON 字串）：

| 角色 | 權限 |
|------|------|
| `manager` 店長 | 全部權限（含設定、員工管理、刪除、危險操作） |
| `floor` 外場 | 操作桌位、訂位、候位、合併桌、設定不可用 |
| `host` 訂位專員 | 訂位 CRUD、候位管理、指派桌（不能改桌位狀態） |
| `kitchen` 廚房 | 唯讀訂位、桌位、候位 |

預設管理員：`berrylin0911@gmail.com`（manager）。

範例 `.env.local`：
```
VITE_ADMIN_EMAILS=berrylin0911@gmail.com,floor1@example.com,host1@example.com
VITE_ROLE_MAP={"berrylin0911@gmail.com":"manager","floor1@example.com":"floor","host1@example.com":"host"}
```

## 操作流程速查

**散客現場入座**：現場頁 → 點空桌 → 「散客直接入座」

**線上訂位 → 入座**：客人 `/book` 完成 → 訂位頁顯示 → 「指派桌位」按鈕 → 自動切到現場頁進入指派模式 → 點符合容量空桌 → 確認 → 客人到時點「客人到了」入座

**現場候位**：現場頁右側候位 chip 按 + → 取號 → 叫號 → 「入座」進入入座模式 → 點空桌

**併桌**：選一張空桌 → 「併桌」→ 點相鄰桌 → 自動合併

**結帳離席 → 清桌**：點用餐中桌位 → 「結帳離席」變橘色 → 「清桌完成」→ 釋出

## 相關專案

- 設計參考：`seat-map-v0.html`（v0 純 HTML 原型，保留作為 UX 參考）
- 姐妹站：菇神 `gs1688.com.tw`、鹿芝谷 `deervalley.com.tw`
