# 雞王／菇神 線上訂位系統 — 上線前審計與測試報告

> 專案：`chicken-booking`（Firebase 專案 `chicken-booking-tw`）
> 審計日期：2026-05-30 ｜ 狀態：**本輪審計＋測試＋修復完成**
> 技術棧：React 18 + Vite + React Router v6 + Tailwind ｜ 後端：Firebase Cloud Functions（HTTPS）+ Firestore
> 測試方式：Firebase Emulator（functions/firestore/auth）隔離測試，全程不碰正式資料

---

## 0. 重要：本文件已對齊真實架構（2026-05-30 重寫）

舊版本文件描述的是「前端直連 Firestore、`firestore.rules` 全開 `if true`、`functions/index.js` 空白、`/admin` 無保護」的**早期架構**，已**全部過時**。實際程式碼已大幅 hardening。本文件依**實讀原始碼 + emulator 實測**重寫。

原列的三大 P0（rules 全開、admin 無保護、無防重複）**都已修掉**，詳見 §2 已驗證良好項。本輪真正處理的是 F-A～F-H（§4）。

---

## 1. 系統現況（實讀驗證）

| 項目 | 內容 |
|---|---|
| 前端 | React 18 SPA + Vite + React Router v6 + Tailwind，**localStorage 優先**，雲端為同步層 |
| 後端 | Cloud Functions（HTTPS onRequest v2）為唯一資料存取層 |
| Firestore rules | `allow read, write: if false`（全面拒絕客戶端直連，縱深防禦） |
| 資料集合 | `bookings` `tables` `waitlist` `customers` `settings/main` `lineBookingBindings` `notifications` `rateLimits` `system/sync` |
| 後台同步 | 登入員工每 5s `adminPullData` 整份拉取 → 差異合併進 localStorage；操作後 250ms debounce `pushChangedData` 只推 dirty／已刪文件 |
| 客人流程 | `guestGetAvailability` → `guestCreateBooking`（transaction）→ `/confirm`；自助 `guestLookup/Get/Update/CancelBooking` 用 manageToken |
| 後台登入 | Firebase Auth（Google）+ email 白名單；後端 `requireStaff` 驗 ID Token 二次把關 |
| 測試 | 無內建自動化測試；本輪以 emulator 案例矩陣補上（`/tmp/booking_emu_test.mjs`，34 案例全綠） |
| 建置 | `npm run build` ✅；`node --check functions/index.js` ✅ |

---

## 2. 安全與穩定性 — 已驗證良好（不需動）

以下皆已在原始碼確認，並由 emulator 測試佐證（案例編號見 §5）：

- ✅ **Firestore 全 deny**（`firestore.rules`）— 客戶端無法直連讀寫，所有存取必經 Functions。
- ✅ **後台端點驗證**（`functions/index.js` `requireStaff`）— `adminPull/PushData` 需 Firebase ID Token + email 白名單；無 token → 401、非白名單 → 403。(SEC1–4)
- ✅ **防超賣**（`guestCreateBooking` runTransaction）— 原子容量檢查，併發兩筆搶最後座位恰 1 成功 1 衝突。(OV1)
- ✅ **防重複訂位** — 同電話＋同日＋同時段 → 409。(G7)
- ✅ **manageToken 常數時間比對**（`safeTokenEqual` / `crypto.timingSafeEqual`）— 防 timing attack。(M2)
- ✅ **PII 遮罩 + 雙重驗證**（`guestLookupBooking` `safeBookingSummary`）— 姓名/電話遮罩；token 僅在「姓氏+完整電話」或「編號+電話末碼」驗證後給出。(M3/M3b)
- ✅ **LINE webhook HMAC 簽章驗證** — 錯簽章 → 401。(SEC5)
- ✅ **Telegram bot token 移後端**（Secret Manager `defineSecret`）— 不進前端 bundle。
- ✅ **通知 outbox**（重試／退避／dead-letter／每日健檢）。
- ✅ **`/admin` 路由守衛**（`App.jsx` `ProtectedRoute` + `AuthContext`）。
- ✅ **客人端不啟動全量同步**（`BookingContext` `isStaff` 閘門）— 不把顧客個資灌進客人瀏覽器。
- ✅ **送出按鈕防連點**；無前端硬編碼密鑰。

---

## 3. 設計上接受的風險（文件化即可）

- `guestLookupBooking` 在身分驗證後回傳 `manageToken`，是「查我的訂位 → 管理」的必要設計。已用 F-B 的每-IP 速率限制緩解批量擷取；**Firebase App Check（reCAPTCHA v3）是更強的後續防線**，需在 Firebase Console 啟用並於前端配置 provider 後才能開啟（避免未配置就強制 App Check 而打掛線上站）。

---

## 4. 本輪發現與處理（F-A ～ F-J）

| ID | 嚴重度 | 描述 | 處理 | 驗證 |
|---|---|---|---|---|
| **F-A** | 🟠 | **硬刪除 5 秒內復活**：`pushChangedData` 無刪除偵測、`adminPushData` 只做 merge-upsert、`applyCloudSnapshot` 從雲端復原 → 刪桌位/候位/顧客會被下一輪拉取復活 | **已修** | ✅ 已測 |
| **F-B** | 🟠 | **公開端點無速率限制**：可暴力擷取 manageToken／費用型 DoS | **已修（速率限制）** + App Check 列後續 | ✅ 已測 |
| **F-C** | 🟠 | **正式環境 Firebase 設定閘門**：未設 `VITE_FIREBASE_*` 會退回本機假登入、雲端同步靜默 401 | **已修（顯著警示 + 文件）** | 程式碼/建置 |
| **F-D** | 🟠 | **後台儲存/刪除失敗無回饋**：`syncCloudSoon` fire-and-forget，店員以為存檔成功 | **已修（toast 回饋）** | 程式碼/建置 |
| **F-E** | 🟡 | **`guestUpdateBooking` 容量檢查非交易（TOCTOU）**：與 create 不一致 | **已修（改 runTransaction）** | ✅ 已測 |
| **F-F** | 🟡 | **全量推送未分批**：總筆數 > 500 時 Firestore batch 上限會讓整批失敗 | **已修（≤450/批分批提交）** | ✅ 已測 |
| **F-G** | 🟡 | **`adminPullData` 每 5s 整份拉取**：隨資料成長讀取量線性上升 | **暫緩（見下）** | — |
| **F-H** | 🟡 | 雜項 UX/安全小修 | **部分已修** | 程式碼/建置 |
| **F-I** | 🔴 | **顧客填完聯絡資訊送出後白屏**：`ConfirmPage` 在 render（useMemo）呼叫 `googleCalendarUrl`，對異常 `date`/`timeSlot` 做 `new Date(...).toISOString()` 會丟 `RangeError`；且**全 app 無 ErrorBoundary**，任一 render 例外即整棵 React tree 卸載 → 整頁空白 | **已修＋瀏覽器實測** | ✅ 已測 |
| **F-J** | 🔴 | **晚上仍顯示「今天已過的時段」**：`guestGetAvailability` 不過濾過去時段、`validateNewBooking` 只擋過去「日期」不擋過去「時段」；且 Cloud Functions 跑 UTC 但營業是台灣時間 → 晚上 9 點仍能訂今天 18:00 | **已修＋emulator 實測** | ✅ 已測 |

### F-A 刪除同步（已修＋已測）
- 前端 `cloudDataService.js`：`pushChangedData` 新增刪除偵測（`lastSynced` 有、`cur` 無者 → `dataset.deletedIds`）；新增 `pendingDeletes` 集合，`applyCloudSnapshot` 對待刪文件不從雲端復原。
- 後端 `functions/index.js`：`adminPushData` 接受 `dataset.deletedIds`，逐集合 `batch.delete`。
- 驗證：種 DEL 桌 → 帶 `deletedIds` 推送 → DEL 從雲端移除、A1/A2 未誤刪。

### F-B 速率限制（已修＋已測）
- `functions/index.js` 新增 `enforceRateLimit`（Firestore 交易、每-IP 滑動視窗、**fail-open**）：`guestLookupBooking` 30 次/10 分、`guestCreateBooking` 20 次/10 分，超限 → 429。
- 驗證：連續查詢超過上限會出現 429，限額內查詢仍 200（非一律封鎖）。
- **後續建議**：啟用 Firebase App Check（reCAPTCHA v3）作為更強的機器人防線。

### F-C 正式設定閘門（已修）
- `AdminPage.jsx` 後台顯著紅色橫幅 + `LoginPage.jsx` 登入頁警示：未設定 Firebase 時明確告知「資料只在本機、不會上雲」。
- `.env.example` 更正註解：`VITE_FIREBASE_*` 為正式環境**必填**，留空會導致後台同步靜默失敗。

### F-D 操作失敗回饋（已修）
- `BookingContext.jsx` `syncCloudSoon` 推送失敗時以 toast 主動回饋（8 秒節流防洗版）。手動「上傳 Firestore」按鈕（`SettingsView`）本就有 try/catch 回饋。

### F-E 改期容量交易（已修＋已測）
- `guestUpdateBooking` 結構性變更（date/timeSlot/guests）的容量檢查與寫入包進 `runTransaction`，與 `guestCreateBooking` 對齊。
- 驗證：兩筆併發改到同一滿格時段恰 1 成功 1 衝突。

### F-F 分批推送（已修＋已測）
- `adminPushData` 改為 ops 清單 + `commitInChunks(≤450/批)`。
- 驗證：推送 600 桌（跨多批）→ 200，拉回桌數 ≥ 600 無遺漏。

### F-G 拉取日期窗（暫緩，附原因）
- **未實作**。原因：`applyCloudSnapshot` 的合併會丟棄「本機非 dirty 且不在雲端快照」的文件；若直接對 `adminPullData` 加日期窗，會讓視窗外的歷史訂位在各裝置本機被**誤刪**。安全的做法需同時讓合併邏輯「視窗感知」，屬較大改動。此為效能優化（🟡 上線後可改），故暫緩並記錄；資料量明顯成長前不影響上線。

### F-H 雜項（部分已修）
- ✅ `index.html` 加 `<meta name="referrer" content="strict-origin-when-cross-origin">`：避免 `/manage?token=` 經跨來源 Referer 外洩 token。
- ✅ `SettingsView` 首頁廣告刪除加二次確認。
- ✅ 客人端過去日期：`BookingPage` 的 `CalendarPicker` 本就只生成今天起的可選日並停用範圍外日期（伺服器另有硬擋），已足夠。
- ⏭️ `/confirm/:id` 跨裝置直接開會「找不到」（讀本機 booking）：屬體驗議題，未改；可於上線後改為以 id+token 向後端查詢。

### F-I 顧客白屏（已修＋瀏覽器實測）🔴
- **症狀**：顧客填完聯絡資訊按「完成訂位」、導向 `/confirm/:id` 後整頁空白、無法操作。
- **根因（瀏覽器重現確認）**：
  1. `ConfirmPage` 的 `calendarUrl = useMemo(() => googleCalendarUrl(b, settings), …)` 在 **render 階段**執行；`googleCalendarUrl` 對 `b.date`/`b.timeSlot` 做 `new Date(\`${date}T${timeSlot}:00\`).toISOString()`，當日期/時段為空或異常時 Date 為 Invalid → `toISOString()` 丟 `RangeError: Invalid time value`。
  2. 全專案**完全沒有 ErrorBoundary**（已 grep 確認），React 18 對未捕捉的 render 例外會卸載整棵 tree → `#root` 變空 → 全白畫面。console 同時印出 "Consider adding an error boundary to your tree"。
- **修復**：
  - 新增 `src/components/ErrorBoundary.jsx`（class 邊界，`getDerivedStateFromError` + `componentDidCatch` 記錄真實錯誤），在 `App.jsx` 以目前路徑為 `resetKey` 包住所有 `<Routes>`：任何頁面 render 崩潰改顯示可恢復的友善畫面（重新整理／回首頁／來電），切換路由自動恢復。**白屏失效模式整類被消除。**
  - `ConfirmPage.googleCalendarUrl` 對 Invalid Date 先回傳空字串；`calendarUrl`/`lineReceiveUrl` 兩個 useMemo 加 try/catch 後退；「加到行事曆」在無法產生連結時改為**停用按鈕**而非崩潰的 `<a>`。
  - `BookingPage` 的 `slots` useMemo 過濾掉格式不正確的時段，避免 `time.slice` 在 render 丟例外。
- **驗證（dev server + 真實瀏覽器操作）**：
  1. 重現：mock 後端回傳異常 `timeSlot:''` 的訂位 → 修復前 `/confirm` 的 `#root` innerHTML 長度為 **0（全白）**；修復後同條件正常渲染「訂位成功」券、`#root` 長度 8809、「加到行事曆」優雅停用。
  2. 安全網：以臨時丟錯驗證 ErrorBoundary → 顯示友善卡片而非白屏（截圖確認），驗後移除測試碼。
  3. Happy path（合法資料）：確認頁正常、「加到行事曆」啟用並連到 Google Calendar；`npm run build` 通過。

### F-J 晚上仍顯示今天已過時段（已修＋emulator 實測）🔴
- **症狀**：台灣 6/8 晚上 9 點（營業 11:00–19:00），訂位前台仍顯示今天可訂時段、甚至能下訂今天 18:00。
- **根因**：
  1. `generateSlotsServer` 產生整天所有抵達時段，`guestGetAvailability` 不論幾點都原樣回傳，**完全沒有「過去時段」過濾**。
  2. `validateNewBooking` 只擋「過去日期」（`date < today`），不擋「今天但時段已過」，所以繞過前端也能成立今天已過的訂位。
  3. **時區**：Cloud Functions 預設以 UTC 執行，但營業時間是台灣時間（UTC+8）；若用伺服器 UTC 牆鐘判斷會差 8 小時。
- **修復（`functions/index.js`）**：
  - 新增 `STORE_TZ='Asia/Taipei'`、`STORE_UTC_OFFSET='+08:00'` 與 `slotEpochMs(date,time)=Date.parse(\`${date}T${time}:00+08:00\`)`（台灣固定 UTC+8 無日光節約，可直接帶偏移）。
  - `guestGetAvailability`：以 `slotEpochMs(date,time) > Date.now()` 濾掉已過時段（其他日期都在未來，不受影響）。
  - `validateNewBooking`：新增硬擋 `slotEpochMs(date,timeSlot) <= now` → 400「此時段已過，請選擇較晚的時段」。
  - `todayServerStr()` 改用 `Intl.DateTimeFormat(Asia/Taipei)`；`guestEditable` 的「用餐前 2 小時」截止改用 `slotEpochMs`（修正原本差 8 小時）。
  - 前端不需改：客人端時段全由後端 `guestGetAvailability` 提供，回傳空陣列時前台本就顯示「這天目前沒有可訂時段」。
- **驗證（emulator + 重寫測試 `/tmp/booking_time_test.mjs`，9/9 ✅）**：測試環境台灣時間正好 21:26（對應回報情境）。以全天營業驗證「今天只回未過時段、00:00 被濾、23:30 仍可訂、下訂已過時段被擋、明天正常」；再以**真實營業時間 11:00–19:00** 確認 21:26 時今天可訂時段=**0（空）**、明天=17。

---

## 5. Emulator 測試矩陣結果（34/34 ✅）

腳本：`/tmp/booking_emu_test.mjs`（對 functions/firestore/auth emulator，`demo-chicken` 專案；每次執行先清空 Firestore 確保隔離可重複）。

- **安全**：SEC1 無 token→401、SEC2 非白名單→403、SEC3 員工→200、SEC4 push 無 token→401、SEC5 LINE 錯簽章→401。
- **客人功能**：G1 空日剩 8 座、G1b 公開設定不含顧客資料、G2 正常訂位回 booking+token、G3 電話格式→400、G4 過去日期→400、G5a/G5b 人數邊界→400、G6 無效時段→400、G7 重複→409、G8 訂位後剩餘正確。
- **穩定性**：OV1 併發搶最後座位恰 1 成功 1 衝突（transaction）。
- **客人自助**：M1 正確 token→200、M2 錯 token→403、M3/M3b lookup 遮罩+token、M4 改人數→200、M5 取消→cancelled、M6 取消後再改→409。
- **F-A**：deletedIds 推送後 DEL 移除、未誤刪 A1/A2。
- **F-E**：併發改期恰 1 成功 1 衝突。
- **F-F**：600 桌跨多批推送→200、拉回≥600。
- **F-B**：連續查詢超限→429、限額內→200。

---

## 6. 上線檢查清單（Go-Live Gate）

- [x] `npm run build` 通過、`node --check functions/index.js` 通過
- [x] Emulator 安全/功能/穩定性矩陣全綠（34/34）
- [x] F-A/F-B/F-E/F-F 已修並 emulator 驗證
- [x] F-C/F-D/F-H 已修（建置驗證）
- [x] **F-I 顧客白屏已修並瀏覽器實測**（新增全域 ErrorBoundary + ConfirmPage 日期運算加固）
- [x] **F-J 過去時段過濾已修並 emulator 實測**（台灣時區、晚上不再顯示/下訂今天已過時段）
- [ ] **【人工必檢】正式環境已設定 6 個 `VITE_FIREBASE_*`**（缺則後台同步靜默失敗；後台會出現紅色「雲端同步未啟用」橫幅）
- [ ] **【人工必檢】Secret Manager 已設 `LINE_CHANNEL_*`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`**
- [ ] **【人工必檢】`ADMIN_EMAILS`（functions/.env）已設員工白名單**
- [ ] 部署後對正式站做一次後台登入 → 改狀態 → 刪桌位（確認不復活）→ 雙裝置同步煙霧測試
- [ ] （後續建議）啟用 Firebase App Check（reCAPTCHA v3）強化公開端點
- [ ] 簽核：________（日期：______）

> 註：本輪以 emulator 完成後端端到端驗證；**前端後台雲端同步未做瀏覽器端到端煙霧測試**（前端 Firebase Auth SDK 未接 auth emulator，需正式 `VITE_FIREBASE_*` 才能跑真實 Google 登入）。建議部署到 staging/正式後執行上方人工煙霧測試。
