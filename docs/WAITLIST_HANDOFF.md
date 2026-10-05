# 候位暫過號與現場交班待辦

本分支疊在 PR #140（已入座整組換桌）之上。未部署；不得將本機或假資料驗收當成正式跨裝置/通知驗收。

## 行為

- 今日 waiting/called 可暫過號；保留 ID、原號、原取號時間、聯絡資料、人數。過號不參與呼叫、帶下一組或需處理數。
- 「回來了」恢復 waiting，按原取號時間、號碼與 ID 穩定排序；由同仁人工帶位，不自動搶桌。seated/left/前日票不可復列。跨日掃除也會結掉過號票。
- 交班由桌位抽屜／客人卡快速新增，預設需回電、等兒童椅、需協助，也可輸入 80 字內短事項。日期分頁顯示待辦／已完成，可完成及恢復。
- bookingId 任務動態跟隨該訂位的新桌；純 tableNumber 任務留在原桌。已取消／完成／刪除的關聯清楚標示，任務不隱性刪除。
- actor 與建立／完成日期時間由 server 設定。前端只存 refs，不保存姓名電話副本；manager/floor/host 可寫、kitchen 唯讀。

## 儲存與衝突

- `adminHandoff` 操作 `handoffTasks/{id}`：逐筆 Firestore transaction，以 expectedVersion 守門；獨立 command receipt 確保相同 commandId 重試不重建／重完成，改 body 重用 ID 拒絕。
- 交班不加入 generic adminPush 集合；不允 generic upsert/delete。成功 GET 不 seed，逐 record 只接受較新版本，舊快照不復活已完成。
- `adminWaitlistTransition` 專用過號／復列，server 重驗角色、當日、狀態與 queueVersion。
- generic 候位上傳同時守版本与 terminal 狀態，不能用舊 waiting 復活 seated/left，也不能繞專用命令直接復列。含候位的同次 booking/table 寫入以同一 transaction 提交；超過 450 個 transaction writes 拒絕，不退化為部分提交。
- 同 generic payload 重試以 receipt 去重，版本已前進則 409、不重寫桌位或重發通知。非候位的既有同步仍沿用原 batch 管線。
- 前端 server ack 才宣告過號／交班儲存；失敗保留草稿與同 commandId 可重試。逾時沿既有 20 秒 HTTP timeout；若 lost response 後 pull 已證實結果，清除過期錯誤。交班使用 server 儲存，不依賴 localStorage 假冒跨裝置。
- 過號／回來不重走取號或發新的客人通知；既有取號／實際入座通知保持。

## 發布需求

需先發布 **adminHandoff、adminWaitlistTransition、adminPushData** 三個 Functions，再發布前端並請所有現場裝置重新整理。舊前端未刷新時，候位衝突會 fail closed，不得以解除版本檢查繞過。
Firestore rules 維持全部客戶端 deny，Functions 以 requireStaff 與角色矩陣守門；不新增 index，不直接開放客戶端 Firestore。無 Secret 設定變更。

正式驗收仍需使用受控假客人測試兩台裝置：建立／完成／恢复交班、並發衝突與斷線重試、過號／復列與選桌中狀態變動；另確認原有取號／入座通知僅一次。未取得授權前不操作正式資料、通知或部署。
