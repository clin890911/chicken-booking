# 雞王訂位頁 GA4 追蹤：設定與分析指南

> 適用範圍：客人端（首頁、`/book`、確認頁、修改/取消、查詢、LINE 綁定）。後台 `/admin`、`/login` 不載入 GA。
> 程式位置：`src/services/analytics.js`（載入與送出）、`src/utils/analyticsSanitize.js`（網址與參數清洗）。

## 一、上線前設定（Barry 做，約 15 分鐘）

1. **建 GA4 資源**：analytics.google.com → 管理 → 建立資源「雞王訂位」→ 時區選台灣、幣別 TWD → 建立「網站」資料串流，網址填 `https://booking.masterofchicken.com`。複製評估 ID（`G-` 開頭）。
2. **🔴 關掉加強型評估裡會外洩 token 的兩項**（資料串流 → 加強型評估 → 齒輪）：
   - 網頁瀏覽 → 進階設定 → **取消勾選「頁面根據瀏覽器記錄事件而變更」**（程式已經自己送清洗過的 page_view，這項不關，gtag 會再多送一筆帶 `?token=` 的原始網址）。
   - **關閉「外連點擊」**（LINE 分享連結裡帶著管理網址與 token）。
   - **關閉「表單互動」「站內搜尋」**（用不到，而且會多出雜訊）。
   - 「捲動」「檔案下載」可以留著。
3. **填環境變數**：Cloudflare Pages → `chicken-booking` 專案 → 設定 → 環境變數（Production）新增 `VITE_GA4_MEASUREMENT_ID=G-XXXXXXX`，然後重新部署一次（Vite 在建置時把值寫進程式，只改變數不重建不會生效）。
4. **資料保留**：管理 → 資料收集和修改 → 資料保留 → 改成 **14 個月**（預設 2 個月，年比會看不到）。
5. **註冊自訂維度**（管理 → 自訂定義 → 建立自訂維度，範圍都選「事件」）。不註冊，報表就看不到這些參數：

   | 維度名稱 | 事件參數 | 用途 |
   |---|---|---|
   | 人數 | `party_size` | 幾人桌最常訂、最常訂不到 |
   | 提前天數 | `days_ahead` | 客人通常提前幾天訂 |
   | 星期 | `weekday` | 哪幾天需求高 |
   | 時段 | `time_slot` | 熱門時段 |
   | 餐期 | `meal_period` | lunch／dinner |
   | 錯誤類型 | `error_type` | 失敗原因 |
   | 在 LINE 內 | `in_line_app` | LINE 內開啟 vs 一般瀏覽器 |
   | LIFF 登入 | `in_liff` | 有沒有帶 LINE 身分訂位 |
   | 取消原因 | `cancel_reason` | 取消原因分佈 |

   `party_size`、`days_ahead` 也可以另外建成「自訂指標」，就能算平均值。
6. **標記主要事件**（管理 → 事件）：把 `booking_complete` 設為「主要事件（Key event）」。之後所有來源報表都會直接顯示每個來源帶來幾筆訂位。

**驗證**：上線後打開 `https://booking.masterofchicken.com/book?ga_debug=1`，到 GA4「管理 → DebugView」應該看到 page_view 和選時段的事件。到確認頁時，事件的 page_location 要是 `/confirm/:id`，**不可以**出現 `token=`。

## 二、送了哪些事件

| 事件 | 什麼時候送 | 主要參數 |
|---|---|---|
| `page_view` | 每次換頁（網址已清洗，bookingId 換成 `:id`，只保留 utm/gclid） | page_path, page_location, page_referrer, page_title |
| `booking_no_availability` | 某天、某人數**完全沒有可訂時段**（同一組合只記一次） | party_size, days_ahead, weekday |
| `booking_find_next` | 按「找最近可訂日」 | found(yes/no), party_size, days_skipped |
| `booking_select_slot` | 選了時段 | party_size, days_ahead, weekday, time_slot, meal_period |
| `booking_begin_info` | 進入填資料步驟 | 同上 |
| `booking_validation_error` | 姓名/電話沒填或格式錯 | fields(name/phone) |
| `booking_submit` | 按「完成訂位」通過驗證 | 同上＋in_liff、retry |
| `booking_complete` ⭐ | 訂位成功 | 同上＋in_liff |
| `booking_error` | 送出失敗 | error_type（full 額滿、auto_closed 接近滿座自動關、duplicate 重複、slot_closed 時段關閉、slot_deadline 過截止、date_past 日期已過、rate_limited 節流、timeout 逾時、network 連不上、server 5xx、invalid 其他 400、recovery_unavailable、uncertain 結果未確認、other）、status |
| `booking_modify` | 客人自己改訂位成功 | 新的人數/日期/時段 |
| `booking_cancel` | 客人自己取消成功 | 原訂位參數＋cancel_reason（「其他」只記 other） |

**不送的**：姓名、電話、email、備註、bookingId、manageToken、LINE 身分。另外也關掉了 Google 信號與廣告個人化。

## 三、怎麼用這些數據分析

### 1. 訂位漏斗：客人卡在哪一步（最重要）
探索 → 新建「漏斗探索」，步驟依序是：
1. `page_view`（page_path = `/book`）
2. `booking_select_slot`
3. `booking_begin_info`
4. `booking_submit`
5. `booking_complete`

怎麼看：
- **1→2 流失大**：客人進來後找不到想要的時段。搭配下面第 2 點的「訂不到」報表一起看；也可能是日期、時段 UI 不好找。
- **3→4 流失大**：填資料這步嚇跑人。看 `booking_validation_error` 的 fields，若多半是 phone，代表電話格式提示要改。
- **4→5 落差**：送出失敗。到 `booking_error` 依 error_type 分組看原因。
- 細分維度加「裝置類別」「在 LINE 內」，比較手機、LINE 內與桌機的轉換率。

### 2. 需求流失：客人想來但訂不到（決定加開桌、調整 8 成自動關門檻）
探索 → 任意形式，事件名稱篩 `booking_no_availability` ＋ `booking_error`（error_type = full / auto_closed），列放「星期」「人數」，值放「事件計數」。
- 週六晚餐 6 人以上常常訂不到 → 可以考慮多留大桌、開放併桌線上訂。
- `auto_closed` 很多 → 8 成自動關的門檻可能太保守，放掉了本來能收的線上客。
- `booking_find_next` found=no 很多 → 整段可訂期間都滿，值得加開場次或延長可訂天數。

### 3. 客人什麼時候訂、訂多遠
- 「提前天數」分佈：多數客人都當天、隔天才訂 → 線上截止時間與現場留位要配合；多數提前一週以上 → 適合提早推播、做早鳥活動。
- 「星期 × 時段」熱度表（用 `booking_select_slot`）：看出真正的熱門時段，排班與備料可以參考。

### 4. 流量來源：哪個管道帶來訂位
報表 → 獲客 → 流量開發，主要維度選「工作階段來源/媒介」，看 `booking_complete` 的主要事件數。
**每個對外連結都要加 utm**，否則只會看到 `(direct)`：

| 管道 | 建議連結 |
|---|---|
| Google 商家「預訂」按鈕 | `https://booking.masterofchicken.com/book?utm_source=google&utm_medium=gbp&utm_campaign=reserve_button` |
| LINE 圖文選單 | `…/book?utm_source=line&utm_medium=richmenu` |
| Facebook／IG 個人簡介 | `…/book?utm_source=instagram&utm_medium=bio` |
| 官網按鈕 | `…/book?utm_source=website&utm_medium=button` |
| 廣告／活動 | `utm_campaign` 寫活動名，例如 `2026xmas` |

### 5. 取消與修改
- `booking_cancel` 依 cancel_reason 分組 → 例如「行程改變」佔多數屬正常；「找不到停車位」這類原因就是可以改善的營運問題。
- `booking_cancel` 的 days_ahead 偏小 → 很多人當天才取消，可以加強前一天的提醒通知。

### 6. 建議每月固定看的 5 個數字
1. 訂位頁轉換率 = `booking_complete` ÷ `/book` 的 page_view 工作階段數
2. 需求流失數 = `booking_no_availability` ＋ `booking_error`（full/auto_closed）
3. 送出失敗率 = `booking_error` ÷ `booking_submit`
4. 各來源訂位數（Google 商家、LINE、IG）
5. 線上自助取消數與主要原因

> 注意：GA 的數字是「行為」，不是帳。實際訂位筆數以後台為準。擋廣告外掛或 iOS 防追蹤會少算 10–30%，看趨勢與比例就好，不要拿來對帳。

## 四、Google 商家（Google Business Profile）放上訂位連結

1. 用管理商家的 Google 帳號在 Google 搜尋「雞王涮涮鍋」，或到 business.google.com，進「編輯商家資料」。
2. **聯絡資訊 → 預訂連結（Reservations / 預約）**：填上面那條帶 utm 的 `/book` 連結。存檔後 Google 審核約數小時到 3 天，通過後搜尋結果與地圖上就會出現「預訂」按鈕。
3. 順便確認「網站」欄填 `https://booking.masterofchicken.com/`（或官網），「菜單連結」有填。
4. 若商家頁上已經有 inline、EZTABLE 這類第三方的「透過 Google 預訂」，Google 可能優先顯示合作夥伴的按鈕。要只留自家系統，就請該平台取消與 Google 的串接。
5. 真正的「Reserve with Google」（在 Google 頁面內直接完成訂位、不跳轉）只開放給 Google 認證的訂位平台串接，自建系統無法申請。用上面的預訂連結，效果是點按鈕後跳到我們的訂位頁。
6. 站內結構化資料（`index.html` 的 JSON-LD）已補上 `acceptsReservations` 與 `ReserveAction` 指向 `/book`，可以幫 Google 搜尋理解訂位入口，但不能取代第 2 步的手動設定。
7. 驗證：GA4「流量開發」裡出現 `google / gbp`，就代表按鈕開始帶客。
