# 客人訂位可靠性：發布與驗收契約

本分支只實作與驗證，未發布、未改正式設定或通知。正式LINE Login Channel ID仍缺，不能以LIFF ID或Messaging Channel猜補。

- 新前端以Web Crypto產生64lowerhex submissionKey，僅存同tab sessionStorage草稿並透過HTTPS POST提交，不放URL、UI或日志。刷新／未知回應保留原payload/key，重試前不能偷偷换意圖；已成功的新訂位才產生新key。
- Server只保存key的SHA256與canonical payloadHash。receipt、booking、初始通知intent同Firestore交易；samekey同payload先查receipt/currentbooking，再套新建時間守門。跨截止／午夜也能recover，取消／完成回當前狀態，刪除410不重建；不同payload409不吐token。不靠phone/date給管理token。
- key是第二種長期secret capability；它能恢復此訂位當前管理token，管理token rotation不自動撤销submission capability。須保護瀏覽器sessionStorage，不能貼到issue或共享log。
- legacy無key仍可建立但recoverySupported=false；舊分頁失回覆不具capability恢復，請重新整理以用新流程。舊電話duplicate仍409、不回管理token。
- 只有明確prewrite business validation回bookingOutcome=not-created；commit成功但SDK ACK丢失、網路／5xx、payload conflict／deleted receipt皆保持unknown，不解鎖為新intent。
- 新客人建立／選時段／改期目標一律以台灣servernow、以客人選的預計抵達時段往前算至少提前2小時（120分鐘），exact120可訂、119拒（2026-10 店主決定，由60改120）。onlineBookingPolicy=arrival-lead-120-v1／onlineMinimumLeadMinutes=120為權威模式，唯一真相是functions/lib/guestReliability.js的MIN_GUEST_LEAD_MINUTES；前端文案常數src/utils/guestPolicy.js由測試鎖成一致。原onlineSessionCutoffMin保留相容資料但不再控制客人。設定頁明示「至少提前 2 小時」。原訂位管理修改人數／取消的用餐前2小時限制（guestEditable）是另一條規則，保留不變。我的訂位改期頁尊重後端closed（原時段保留可選）。
- create／guest update／cancel／LINE binding的狀態與durable intent同交易。queue intent→outbox也以交易一次推進；存不了outbox時保留pendingintent供retryNotifications補償，不以catch當可靠成功。
- 補償只掃新版notificationIntents，不掃歷史bookings發舊卡。pending舊event遇目前取消／改期或更高版本標superseded，不補送誤導的成功／舊時間。
- 每事件有穩定ID／版本與LINE lastQueuedByEvent cursor。A→B→A為新revision；同event callback/旧前端触发重用intent。legacy只有真的sent outbox證據可迁移成功；光lastPush marker不能當成功。
- Sender以transaction claim/60秒lease防並發。同outbox成功送出後才標sent；永久失敗及queue重試按event/channel聚合顯示，別的channel成功不能蓋掉警告。admin generic snapshot不可改通知權威字段。
- 第三方已接收但回覆/mark-sent ACK遺失，lease逾期重試仍可能重送。這是at-least-once外部交付，並非對LINE/Telegram保證exactly-once；已在途的舊通知也無法撤回。
- OAuth48hex state嚴格expiry、transaction consume；missing/expired/malformed/deletion失敗均不得exchange。LINE設定ready只表示欄位/安全URL檢查，不能取代真channel/secret/callback登録與真人送達驗收。缺資料不预取授權或宣稱已送達。
- admin其他既有pipeline保留：新版enqueue已耐久化，但admin狀態提交後、第一個intent建立本身若失敗，仍沒有同交易補償保證。本輪原子保證限客人create/update/cancel/bind；不能將此宣告為全站所有admin變更的原子通知。

## 發布順序（需另行授權）

先發布相依Consumer Functions與sender/scheduler，再發布前端並刷新現場/客人分頁。至少涵蓋guestGetAvailability、guestCreateBooking、guestGetBooking、guestUpdateBooking、guestCancelBooking、lineBind、lineLoginStart、lineLoginCallback、linePushBooking、lineGetBooking、lineMyBookings、lineWebhook、retryNotifications，以及adminPushData（server-owned通知字段）。變更sharedhelper的caller須按實際部署source審核；不得用全量force順手發布無關函式。
Firestore rules仍全部client deny，receipt/intent不進generic同步；單where+limit查詢不新增複合索引。Secrets不改、不由前端輸入。正式LINE四項配置由line-settings-apply-plan.json準備，但Channel ID未證實所以apply仍blocked。

上線後需受控驗收：原單lostreply／刷新恢復、秒級60邊界、queue failure補償、並發lease／第三方ACKlost限制、expired/並發OAuth callback、LINE真人登入／綁定／實際送達。此分支的假資料測試不等於正式送達。
