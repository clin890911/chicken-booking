# 測試指南 — 雞王訂位系統

這套**回歸測試**用來確保「用戶端（線上訂位/查詢/修改）」與「管理端（指派/入座/候位/顧客/設定）」共用的**領域邏輯**在每次改動後仍正常運作。**功能上線前一定要先跑過、且全綠。**

## 快速開始

```bash
npm test            # 單元/整合測試（Vitest，快、CI / 上線前必跑）
npm run test:watch  # 開發時即時重跑（改檔自動跑）
npm run test:coverage   # 產生覆蓋率報告（coverage/ 目錄）
npm run test:e2e    # E2E（Playwright，真實瀏覽器跑用戶端訂位 / 管理端指派主線）
```

> 兩層測試：**Vitest** 守邏輯層（快、每次改動都跑）；**Playwright E2E** 守兩條最重要的使用者主線（真實瀏覽器、較慢、上線前跑一次）。

Vitest 全綠長這樣：

```
 Test Files  11 passed (11)
      Tests  537 passed (537)
```

## 測什麼

測試聚焦在**領域邏輯層**（`src/services/*`、`src/utils/*`）——這是訂位/桌位/候位/顧客/容量的「引擎」，用戶端與管理端都靠它，bug 最常藏在這裡，也最適合做穩定、快速、可重複的測試。

| 測試檔 | 覆蓋對象 | 重點 |
|---|---|---|
| `tests/utils/timeSlots.test.js` | 時段/日期工具 | 產生可訂時段、日期格式、過去日判定 |
| `tests/utils/validation.test.js` | 表單驗證 | 台灣手機/市話格式（用戶端訂位表單） |
| `tests/utils/capacity.test.js` | **可用量引擎** | 某時段剩餘可訂人數、時間窗重疊、團體整桌保留、已取消/no-show 不佔位 |
| `tests/services/bookingService.test.js` | 訂位 CRUD | 建立/狀態流轉/no-show 分級/客人自助改訂位與取消/管理權杖驗證 |
| `tests/services/tableService.test.js` | 桌位 | 狀態轉移、併桌、停用、刪除防呆 |
| `tests/services/seatingService.test.js` | **營運整合層** | 指派→入座→離席→釋出、換桌、候位入座、散客入座、防呆 |
| `tests/services/customerService.test.js` | 顧客檔 | upsert 去重、VIP/黑名單/歸檔、搜尋、統計 |
| `tests/services/settingsService.test.js` | 設定 | 預設值合併、數值/布林回退 |
| `tests/services/waitlistService.test.js` | 候位 | 取號序號、叫號/入座/棄號、預估等待 |
| `tests/integration/flows.test.js` | **跨流程端到端** | 線上訂位→指派→入座→釋出、候位→入座、no-show、客人改時間解除指派、取消回補容量 |

## E2E 主線（Playwright，真實瀏覽器）

`npm run test:e2e`（會自動起 / 重用 `npm run dev` 的本機站台）。涵蓋兩條最重要的使用者主線；**所有 E2E 都攔截後端 `admin*` / `guest*` 端點回假資料，絕不打正式 Cloud Functions、不碰 production 資料**。

| E2E 檔 | 主線 | 步驟 |
|---|---|---|
| `e2e/customer-booking.spec.js` | 用戶端訂位 | 選時段 → 填姓名/電話 → 送出 → 進確認頁；另測電話格式錯誤擋送出 |
| `e2e/customer-manage.spec.js` | 用戶端查詢/修改 | 開管理連結 → 驗證電話末碼 → 改時段更新成功 / 取消訂位成功 |
| `e2e/admin-assign.spec.js` | 管理端指派 | 同仁登入 → 今日列表看到訂位 → 指派桌位（A6 二步確認）→ 指派成功 |
| `e2e/waitlist-seat.spec.js` | 管理端候位 | 登入 → 取號 → 叫號 → 入座（A6 二步確認）→ 入座成功 |

> 客人端訂位走後端 `guestGetAvailability` / `guestCreateBooking`，E2E 以 `page.route` mock 這兩個端點的回應，故不需後端即可跑、且結果穩定。

## 上線前檢查清單（每次部署前照做）

1. `npm test` → **必須全綠**（Vitest 邏輯層）。有紅燈先修到綠再上。
2. `npm run test:e2e` → **必須全綠**（用戶端訂位 + 管理端指派主線）。
3. `npm run build` → 必須成功（無編譯錯誤）。
4. 若這次有改 UI 細節，另外用 preview / 實機快速點一輪受影響頁面（自動測試不涵蓋每個畫面細節）。
5. 部署後，到線上站確認 bundle 已更新（見 `README` / Zeabur 後台）。

## 加新功能時怎麼維護

- **改了某個 service/util** → 對應的 `tests/**/*.test.js` 要同步更新或補測試，確保新行為被涵蓋、舊行為沒被破壞。
- **加了新的 service** → 在 `tests/services/` 新增一個 `<名稱>.test.js`，比照現有檔案的寫法（每個 export 函式至少一個測試：正常 + 邊界 + 錯誤路徑）。
- **測試慣例**：
  - `tests/setup.js` 已自動在每個測試前後清空 `localStorage`，各測試彼此隔離、不需手動清。
  - 時間相依的邏輯用 `vi.useFakeTimers()` + `vi.setSystemTime(...)` 固定時間，`afterEach` 用 `vi.useRealTimers()` 還原。
  - 全域已開啟 `describe / it / expect / vi`（免 import）。

## 建置測試時發現並修復的 bug（已修）

| 問題 | 影響 | 修法 |
|---|---|---|
| `settingsService` 的 `heroBanners` 跨呼叫共用同一陣列參考 | 首頁廣告設定被某處 mutate 後會污染後續讀取 | `withDefaults` 改回傳獨立副本 (`slice()`) |
| 客人自助改時段/取消後，原指派桌仍停在 `reserved`（孤兒桌） | 桌看似有人預約、實際無綁定，新客無法被指派該桌 | `bookingService` 解除指派/取消時一併 `clearTable` 釋放原桌 |
| `isValidTwPhone` 會把夾雜字母的字串去字母後誤判為合法電話 | "0912abc345678" 被當成有效電話 | 含英文字母直接拒（仍允許空白/連字號等分隔符） |
| `customerService` 電話主鍵未統一去符號，含括號/點號的同一電話會建重複顧客檔 | 同一客以不同格式輸入 → 重複帳 | `normalize` 改為只留數字；並修正 `search` 純文字查詢誤 match 全部的連帶問題 |

## 已知小限制（測試已記錄行為、低風險、待評估）

這些是建測時 agent 標記的次要疑慮，影響小或落在外部整合/旅行社並行開發中的檔案，**目前未改**，測試以「現況行為」記錄，避免日後誤判為新 bug：

- **`settingsService`**：`cleanupBufferMin`／`diningDurationMin` 設為 `0` 會被當 falsy 回退預設（無法設 0 緩衝）。要支援 0 需同步改 `capacity.occupancyMinutes` 的 `|| 預設` 防呆。
- **`tableService.mergeTables`**：距離檢查用 `dx>200 && dy>200`（兩軸皆過遠才擋），故同列水平排很開的兩桌仍可併。偏鬆但屬店員手動操作、低風險。
- **`tableService.addTable`**：自動桌號從 `A1/B1` 起算，與現行「雞王座號圖」的 `101/201` 數字體系不一致（僅影響後台手動新增桌）。
- **`waitlistService` 取號序號**：以「當日筆數+1」計算，若中途 `remove()` 刪除記錄可能重號（實際 UI 用 `leave()` 不刪除，故一般不會發生）。
- **`seatingService` walk-in/候位入座**：`date` 取 UTC 日期、`timeSlot` 取本地時刻，台灣午夜時段理論上可能不一致（營業時間 11:00–19:00，實務不觸發）。
- **`bookingService.listUpcoming`**：時段比較固定用「今天」的時鐘，僅適用查當日（即時通知用途）。

## 目前「不」涵蓋的範圍（已知取捨）

- **React 元件渲染 / 互動**：未做 component test（畫面層改動請用 preview 或實機驗證）。
- **E2E 廣度**：已用 Playwright 涵蓋四條主線——用戶端訂位、用戶端查詢/修改、管理端指派、管理端候位入座（見上）。團體預排（旅行社）等其他流程尚未加 E2E，可日後依同樣模式（mock `guest*`/`admin*` 端點 + 驅動 UI）擴充。
- **網路 / Firebase / Telegram / LINE**：`firebase.js`、`cloudDataService.js`、`telegramService.js`、`lineService.js` 屬外部整合，不在單元測試範圍（測了也只是測 mock）。
- **後端 `functions/`**：本套件為前端領域邏輯；後端 Cloud Functions 若有邏輯需另立測試。

> 設計理念：先用一套**快速、穩定、可重複**的邏輯層測試守住「核心訂位/營運規則不被改壞」這條底線；UI 與 E2E 可日後增量補上。
