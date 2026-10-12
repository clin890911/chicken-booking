# 候位穩定性隔離驗證（2026-10-12）

本報告區分資料一致性與速度；測試結果不代表正式雲端 SLA、真人 LINE 可達率或三台 iPad 硬體驗收。

## 隔離與執行方式

- Firestore emulator 1.21.0，只接受 `127.0.0.1:8080`、`GCLOUD_PROJECT=demo-waitlist-stability`，未設定時測試略過，明確不容許 ADC/正式 Firestore fallback。
- 使用產品 `functions/lib/waitlistCommands.js` 的 `createWaitlistHandler`、真正 Firestore transaction；HTTP harness 不自行實作發號、版本檢查或入座邏輯。
- browser auth 僅在 Playwright 攔截 Firebase module 回傳固定測試 token；HTTP server localhost:5201；Vite localhost:5199；Chromium 封鎖外網 DNS 並攔截全部 HTTPS。
- 通知為 DI stub，不取得正式 token、不送 TG/LINE、不載入正式 `.env`。測試仍消耗本機 CPU/記憶體；沒有付費雲端請求。
- 最終 Node runtime：`/tmp/gs-waitlist-runtime-20261012/node-v22.22.0-darwin-arm64/bin/node`。初步基線使用 Node 25.9.0。

```bash
PATH=/tmp/gs-waitlist-runtime-20261012/node-v22.22.0-darwin-arm64/bin:$PATH \
firebase emulators:exec --only firestore --project demo-waitlist-stability \
'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-waitlist-stability ./node_modules/.bin/vitest run tests/functions/waitlistCommands.emulator.test.js'

PATH=/tmp/gs-waitlist-runtime-20261012/node-v22.22.0-darwin-arm64/bin:$PATH \
firebase emulators:exec --only firestore --project demo-waitlist-stability \
'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-waitlist-stability ./node_modules/.bin/playwright test --config scripts/test/waitlist-playwright.config.js'
```

兩條命令必須依序執行：共用同一本機 emulator project/port，測試會清除該 demo project 的所有資料。Vite config 禁止 reuseExistingServer，避免跑到其他 checkout。

## 改善前基線：必須保留

真 transaction、100 同時 create、尚無 FIFO factory 的第一輪：4 個測試通過，100 組取得唯一且連續 1–100 號；丟棄 ACK 重試不多發號，同候位 call/leave 與不同候位搶同桌均只有一個成功。

|基線|結果|
|---|---|
|100 create＋一次 receipt replay|101 transaction 呼叫，828 callback attempts|
|整批耗時|114,130 ms|
|個別操作 elapsed p95|110,605 ms|

這些是同一台機器上「in-process handler＋local emulator」量測，**不是 HTTP p95、不是正式雲端估算**。結果暴露單日 counter 文件的爭用；雖資料安全通過，速度不能稱為尖峰順暢。

## 改善後與三 context 證據

Node 22.22.0 emulator 測試先 **8/8 通過**，補上已釋放團體梯次案例後，最終 **9/9 通過**。下表保留同一輪量測，包含 FIFO 等候、Firestore transaction 重試與本機 emulator 處理，不含 HTTP/browser 往返。3 個 factory 各自持有自己的排程 Map，只共用 Firestore；沒有以共用 mutex 假裝跨 instance 一致性。

|場景|同時 create 數|總 ms|個別 elapsed p95 ms|transaction / callback attempts|失敗|
|---|---:|---:|---:|---:|---:|
|1 factory、counter 起初不存在|100|1,641|1,575|100 / 100|0|
|3 獨立 factory、counter 起初不存在|100|6,719|6,669|100 / 105|0|
|1 factory、先寫 counter=0|3|36|36|3 / 3|0|
|1 factory、先寫 counter=0|10|114|114|10 / 10|0|
|1 factory、先寫 counter=0|50|535|515|50 / 50|0|
|3 獨立 factory、先寫 counter=0|3|3,153|3,153|3 / 5|0|
|3 獨立 factory、先寫 counter=0|50|9,620|9,595|50 / 57|0|

warm counter 方法為每組測試清空 demo project、seed tables/settings、直接寫當日 counter=0，再一次 Promise.all 提交該數量的 create；**不是先累積 50 組再送 50 組**。Firestore 衝突 backoff 有變動，本機 3-factory 場景仍超过 3 秒，所以不能宣布「三台均 3 秒內」或正式容量已達標。

前一 Node 22 輪（同架構）1 factory 100 的 p95 1,525 ms、3 factory 100 的 p95 6,891 ms；基線 p95 110,605 ms 保留於上節。改善降低同 instance counter 爭用，跨 instance 則仍依 Firestore conflict/retry。

補 group-releasedAt 的最終 9/9 輪：1 factory 100 總 1,776 ms／p95 1,711 ms／100 attempts；3 factory 100 總 3,910 ms／p95 3,859 ms／102 attempts，皆零失敗。warm 1 factory 3／10／50 總為 38／113／1,102 ms；warm 3 factory 3／50 總為 3,278／7,601 ms、p95 3,278／7,580 ms、attempts 6／53，仍不符合全都 3 秒內的宣稱。未做挑最快一輪的容量結論。

8 項測試包含：兩種 100 burst/replay；warm counter 不同 factory 數；同候位 call/leave 版本競爭；跨組同桌 seat 原子性；auth/kitchen/跨日拒絕；counter 缺失時從旧候位最大號（含空洞）初始化、删除最高候位後不重用 counter；改 body/換 actor 不得拿 receipt，以及 afterCommit provider 失效不撤銷已提交結果。3-factory callback attempts > transaction calls，證實真 SDK 發生重試。

Node 22.22.0、Chrome 真瀏覽器 E2E 最終 **3/3 通過**（40.2 秒）。三個獨立 browser contexts 是桌機 Chromium 的 iPad 尺寸模擬（1024×1366）；每台有獨立 localStorage。首項測試由三台實際 frontend service client 同時 call 同候位，結果 200/409/409；兩组搶同桌 seat 為 200/409，仅一筆 booking、三台 reload 後讀到同一版本與桌況。這部分是 browser service 命令競爭，沒有把程式呼叫聲稱為真機觸控操作。

第二項以真 handler 建立 50 組，再開三個獨立 context，驗 cloud pull 各台 50 組與 localStorage 隔離；真 UI 取號在 `context.setOffline(true)` 下只保留待確認、不在 DB 發號；恢復連線後 reload＋點「確認／重試原操作」增為 51 組。另一次 UI 取號先 `route.fetch()` 讓真 HTTP handler 完成 Firestore commit，再 `route.abort('failed')` 確定丟棄 ACK；DB 已為 52 組、裝置保原 command，reload＋原操作重試仍 52 組且 pending 清除。三台最後均讀到 52 組。曾嘗試直接 socket reset，Chromium 透明重送使原操作立即確認；改用 fetch-then-abort，避免透明重送掩蓋未確認狀態。

截圖（假資料、三台最後 reload 狀態；不能當真 iPad 證據）：[裝置 1](waitlist-evidence/waitlist-stability-device-1.png)、[裝置 2](waitlist-evidence/waitlist-stability-device-2.png)、[裝置 3](waitlist-evidence/waitlist-stability-device-3.png)。候位數、版本與 DB 原子性以測試斷言為證，截圖僅輔助。

新增第三項使用真渲染的現場候位頁：真 handler 先建 50 組，三台各自點同一張「UI組1」卡片的「叫號」；只在測試 transport 暫扣三個請求，待全部送出才同時放行，三次均交給產品 handler/真 Firestore，未替代 domain 邏輯。候位版本僅增至 2，三台畫面均同步為「已叫號」。隨後兩台分別在 UI組2／UI組3 卡片點「入座」→桌圖 101→確認按鈕；同樣只同步放行兩個真請求，DB 只有一個 seated 候位及一筆 booking，另一組保留 waiting，桌 101 對應勝方 booking；三台 localStorage 都只有一筆 seated、一筆 booking，不留敗方本機幽靈占桌或孤兒 booking。[UI 競爭裝置 1](waitlist-evidence/waitlist-stability-ui-race-1.png)、[裝置 2](waitlist-evidence/waitlist-stability-ui-race-2.png)、[裝置 3](waitlist-evidence/waitlist-stability-ui-race-3.png)。

待確認畫面實際包含原操作提醒與「確認／重試原操作」按鈕，而非只有 badge：[送前斷網](waitlist-evidence/waitlist-stability-pending-offline.png)、[commit 後 ACK 遺失](waitlist-evidence/waitlist-stability-pending-lost-ack.png)。後者保留上一筆成功取號 #51 的 toast，新的未確認操作沒有宣稱取得 #52；其 DB commit／恢復由測試斷言核實。

最終 9/9 除上述 8 項，還覆蓋 confirmed 團體同桌同時段 batch 已有 `releasedAt`，桌況 vacant 時 seat 不需覆蓋同意即可成功，與現場已釋放梯次不再 hold 桌的行為一致。

通知界線：目前 production export 是 `createWaitlistHandler({db,requireStaff})`，此輪專用候位 commands 沒有掛正式通知 callback。harness 通知 stub 為零，不把「沒發訊」宣稱成 LINE 功能驗收；也不以人工實作去重 callback 假證產品通知去重。

## 尚未驗收

- 真機三台 iPad Safari、實際店內 Wi-Fi、鎖屏喚醒／睡眠網路行為。
- 正式 Functions 的 region、CPU、memory、concurrency、minInstances、冷啟動與實際配額。
- 真人 LINE 授權、好友／封鎖、push 接收／點擊確認及 SMS／人工電話補援。
- 合併、部署及正式 production 寫入；本輪隔離驗證沒有做上述動作。

## 最後修復、版本界線與發布限制

### Legacy E2E 的雲端契約遷移

`e2e/waitlist-seat.spec.js` 與 `e2e/waitlist-multi-seat.spec.js` 原本用本機模擬登入、admin pull 回 `ok:false` 並依 localStorage 假定候位成功；新版專用雲端 command 不應提供該成功 bypass。現在保留原 7 個案例及其 UX 目的，改為隔離 demo Firestore／真 handler／測試 auth；多桌種子沿用 `INITIAL_TABLES` 全店 schema 與只留 105／106／109 空桌的原情境。沒有刪除案例、放回本機成功或以 skip 代替 PASS。

新增離線 pending 保稱呼／人數草稿、復線確認只發一號，及 11 人使用 10 基本席＋每桌擠一擠餘量、同時段預配警示確認／5 秒真命令復原候位、兩桌、原預配的回歸。加上 3 個新版穩定性案例，專項 config 共 12 個 E2E，需上述 demo emulator 及 localhost 端點，未設隔離條件應拒絕，不能碰正式後端。

遷移初輪原 7＋新 3 共 10 個案例為 8 PASS／2 FAIL：其一是錯把取號 toast 改為「已確認取號」的測試 locator，已修為產品實際「已取號」並增加 DB 斷言；另一是雲端分支遺失既有「查看」toast 操作。後者由產品作者恢復「查看」＋5 秒 undo，不能擅自刪掉原查看桌況驗收。加上新案例的第一輪 12 項為 11 PASS／1 FAIL：稀有姓的舊 locator 匹配到 modal 姓名預覽，使新 DB 斷言早於 ACK；改為實際候位 card 與 DB poll，沒有降低 server 確認要求。

作者 READY／source freeze 後，Node 22.22＋demo 真 Firestore 的專項最後一輪為 **12/12 PASS，約 1 分鐘，零 skip**：原單桌 3 案、多桌及內嵌表單 4 案全部保留；另有離線保草稿、擠一擠／預配確認／5 秒原子復原 2 案及三 context 穩定性 3 案。單桌「查看」確實開桌況抽屜，11 人使用 10 基本席成功後點復原，驗證原候位 waiting、105／109 vacant、原預配回 109、無 arrived 孤兒 booking。此為測試作者的重跑結果，root 的 fresh acceptance／immutable SHA 另列，不能混稱。

全 root unit suite 的 17 項 skip 僅限未啟用 emulator 的環境 gating，**不是 17 項 PASS**；本文件的 emulator 命令另行跑真 Firestore 案例。亦不能從 unit suite 綠燈推論 legacy UI E2E、真 iPad 或正式雲端已驗收。

上述 9/9、3/3 與性能數字是本報告記錄的隔離測試輪次，不能自動延伸為後續每個修改的最終驗收。最新修復的最終獨立驗收數字由 root 的 acceptance 結果補入；本節不預寫 PASS。

來源版本分為起始 main `624d0c6` 與此隔離工作樹的未提交修改。測試執行時工作樹尚未有對應 immutable commit，因此不把當時 HEAD 當作「已測完精確版本」，也不使用報告所在 commit 自我引用。root 建立 commit 後，應由獨立驗收記錄實際 checked SHA，並把新結果與上文歷史量測分開。

- **P1 checkout ACK**：普通 adminPushData 回傳 canonical 操作資料及 `writtenVersions`，client 只有在雲端 ACK 仍對應其已提交版本時才能清除 critical dirty；較新資料不能被較舊回應蓋掉。這與候位 command 的專用原子 transaction 是不同的寫入路徑。
- **P1b module reload**：刷新頁面後，雲端較高 operational version 為權威，捨棄本機 stale critical 狀態、保留 layout 編輯並提示；缺少可確認版本的 ACK 採 fail-closed，不把未確認 critical 狀態當成功。first-pull 既有測試 fixture 更新仍須保留「新裝置先 pull、不用 seed／舊本機資料覆蓋雲端」的原目的。
- **P2 releasedAt**：已釋放的團體 batch 不再形成同桌、同時段 hold；對應 emulator 案例在前述 9/9 輪有驗證。最終版本仍需 acceptance 以實際 SHA 重跑。
- **Undo 資料界線**：復原需要的完整舊快照改存 private command receipt；public waitlist、直接 command 回覆、receipt replay 回覆及一般 pull projection 都不應含 internal snapshots／舊 token。復原仍須保留原資料字段；驗收使用固定假字串即可，不讀出實際 token 或客人個資。此修復晚於上文最初 UI／性能輪次，其最終驗收待獨立 acceptance 記錄。
- **既有 regression 初輪**：Node 20 全 root suite 初次出現 3 項舊 fixture 失敗；修正 fixture 與 first-pull 的設定須維持原測試目的。這不是最新 acceptance 的結果，不能只以改 fixture 後的歷史輪次宣布全 repo 最終通過。

發布計畫先限於 `adminWaitlistTransition`、`adminPushData`、`adminPullData`，並核對既有 `retryNotifications` intent consumer 是否需要相容版本。不得因此改成全量 Functions deployment，也不以移除舊安全保障方式讓不安全旧 client 通過；店內 iPad 必須刷新載入新版，實際多台 Safari／Wi-Fi／鎖屏恢復仍需真機驗收。

普通 bulk 同步保留既有分片、可能部分 commit 的語義，不能宣稱整包原子；候位 create/call/seat/leave 等專用命令始終以 transaction 原子提交。部署／合併／正式驗證仍由 root 分別記錄，不能與本機模式、三個 Chromium contexts、通知 stub 或 emulator 結果混在一起。此處沒有新增部署授權或正式寫入。
