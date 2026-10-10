// 雲端同步狀態機（純函式，供 BookingContext 使用）。
//
// 抽出來的理由：這裡的狀態轉移有一條極易寫錯、又完全看不出來的規則——
// 「拉取成功」不等於「本機變更都上雲了」。差異推送可能有部分集合因角色權限被拒
// （partial push 的 rejected），那些變更只存在本機。若拉取成功時無條件把狀態設成
// 'synced'，每 5 秒的輪詢會在幾秒內把警示洗掉，設定頁的橫幅與「放棄這些變更」按鈕
// 跟著消失，店員永遠不會發現畫面上有雲端根本不存在的資料。
//
// 狀態：idle（尚未同步）/ syncing / synced / rejected（部分變更被權限擋下）/ offline。
// 'rejected' 只能由「乾淨的推送成功」或「使用者主動放棄」清除，拉取不得清除它。

// 推送被 cloudDataService 的「首拉閘門」延後（這台裝置還沒成功拉取過雲端，見
// cloudDataService.PUSH_AWAITING_FIRST_PULL）。既不是成功也不是失敗/被拒：呼叫端不得據此把
// 狀態改成 synced / offline / rejected，維持原狀態（idle / syncing 會由拉取收尾、offline 保留
// 拉取失敗的原因），等首拉成功開閘後再推。
export const PUSH_DEFERRED_MESSAGE = '尚未從雲端取得資料，請稍候再試'
export function isPushDeferred(result) {
  return result?.skipped === true && result?.reason === 'awaiting-first-pull'
}

// 推送結果 → 狀態。有 rejected 就進入 'rejected'，否則視為完全同步。
export function statusFromPushResult(result, nowIso) {
  if (result?.rejected) {
    const message = result.rejectedMessage || '部分變更因權限不足未能上雲'
    // message 一併存進 rejected：中途若插入一次 offline，error 會被錯誤訊息蓋掉，
    // 之後回線時要靠這裡把警示文案原樣還原。
    return {
      state: 'rejected',
      lastSyncAt: nowIso,
      error: message,
      rejected: { ...result.rejected, message },
    }
  }
  return { state: 'synced', lastSyncAt: nowIso, error: '', rejected: null }
}

// 拉取成功 → 狀態。🔴 仍有 rejected 時必須回到 'rejected'（而不是沿用 prev.state——
// 中間可能經歷過 offline，沿用會讓警示卡在離線態、回線後再也回不去）。
// 🔴 上次推送失敗（pushFailed）時也不可洗成 synced：拉取成功只代表「讀得到雲端」，本機變更仍沒上雲。
//   維持 offline＋原錯誤訊息，等補推成功（statusFromPushResult）才轉 synced。
export function statusAfterPull(prev, nowIso) {
  if (prev?.rejected) {
    return {
      ...prev,
      state: 'rejected',
      error: prev.rejected.message || '部分變更因權限不足未能上雲',
      lastSyncAt: nowIso,
    }
  }
  if (prev?.pushFailed) {
    return { ...prev, state: 'offline', error: prev.error || 'cloud-push-failed', lastSyncAt: nowIso }
  }
  return { state: 'synced', lastSyncAt: nowIso, error: '', rejected: null }
}

// 推送/拉取失敗 → offline。保留 rejected：離線不會讓「被拒的變更」消失，
// 回復連線後仍要繼續警示。
export function statusAfterError(prev, message, fallback) {
  return { ...prev, state: 'offline', error: message || fallback }
}

// 推送失敗 → offline，並標記 pushFailed：之後的拉取成功不得把它洗成 synced（見 statusAfterPull），
// 只有下一次推送成功（statusFromPushResult 回新物件）才清除。
export function statusAfterPushError(prev, message, fallback) {
  return { ...statusAfterError(prev, message, fallback), pushFailed: true }
}

// 拉取成功後「要不要真的換掉 cloudStatus 物件」。
//
// 背景（後台卡頓根因之一）：拉取每 5 秒一次，statusAfterPull 每次都回新物件（lastSyncAt
// 變了），BookingContext 的 value 跟著換參考 → 所有 useBooking() 的元件每 5 秒整棵重繪。
// 但 lastSyncAt 只有設定頁的「最近同步 hh:mm:ss」在看，沒必要每 5 秒逼整個後台重畫。
// 規則：state / error / rejected 任一有變 → 一定要換（那是警示語意）；
//       都沒變、只有時間前進 → 距上次落地的 lastSyncAt 不到 minIntervalMs 就沿用舊物件。
// 首次拉取（prev.lastSyncAt 為 null）一定換：newBookingAlerts 靠 lastSyncAt 判斷「資料備妥」。
export function shouldCommitPullStatus(prev, next, { minIntervalMs = 30000 } = {}) {
  if (!prev || !next) return true
  if (!prev.lastSyncAt) return true
  if (prev.state !== next.state || (prev.error || '') !== (next.error || '')) return true
  if (JSON.stringify(prev.rejected || null) !== JSON.stringify(next.rejected || null)) return true
  const a = new Date(prev.lastSyncAt).getTime()
  const b = new Date(next.lastSyncAt).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true
  return b - a >= minIntervalMs
}

// 本機同步基準線落地失敗（cloudDataService.persistSyncState）的「旗標翻轉才主動提醒」判斷。
//
// 背景：這個故障的後果是「下次整頁重新整理，剛排好的佈局可能消失」——店主大多停留在
// 現場帶位頁，很少主動點進設定頁看靜態警示列，所以旗標一翻成 true 就要主動跳 toast，
// 不能只靠他自己發現。但輪詢每 4 秒跑一次，若每次 degraded=true 都跳，會變成疲勞轟炸、
// 反而被忽略——只在「上一次還是 false，這一次變成 true」的那個瞬間提醒一次；
// 持續是 true（還沒解決）不重複跳；解決後回到 false、之後又再次故障，才可以再跳一次。
//
// 純函式抽出來方便單測，不必掛載整個 BookingProvider（見 tests/components/*Undo.test.js
// 的既有慣例：BookingProvider 需要 AuthProvider/ToastProvider/ConfirmProvider 才跑得起來，
// 不划算，核心判斷邏輯抽成純函式最省事）。
export function shouldAlertPersistDegraded(prevDegraded, nextDegraded) {
  return !!nextDegraded && !prevDegraded
}

// === 推送失敗後的自動補推政策（拉取成功時判斷要不要補推）===
// 只有「等一下可能自己好」的錯誤才自動補推：網路斷線（沒有 HTTP status）、逾時、5xx、候位 409 衝突
// （下一次拉取會改採雲端候位，見 cloudDataService）。其他 4xx（例如 413 推送過大、400 格式錯）重推也
// 一樣失敗，不自動補推——照舊顯示失敗，等店員下一個動作才推，避免每 5 秒重推＋錯誤 toast 洗版。
// 指數退避 5→10→30→60 秒（上限 60 秒），推送成功一次就歸零。
export const PUSH_RETRY_BACKOFF_MS = [5000, 10000, 30000, 60000]
// 拉取每 5 秒一次、推送失敗時間點落在兩次拉取之間：留 1 秒寬限，第一次補推才不會被拖到 10 秒。
export const PUSH_RETRY_SLACK_MS = 1000

export function isRetryablePushError(err) {
  if (!err) return false
  if (err.waitlistConflict) return true
  const status = Number(err.status) || 0
  if (!status) return true   // fetch 斷線（TypeError）、逾時（code 'timeout'）、取不到 token 都沒有 HTTP status
  // 401：iPad 休眠喚醒時 token 過期／換發失敗（cloudDataService 已強制換新重送一次仍失敗）。
  // 連線穩了就會好；真的被登出時補推最多每 60 秒一次、toast 不重跳，無害。
  if (status === 401) return true
  return status >= 500
}

// 推送失敗要不要立刻跳錯誤 toast。
// iPad 前台最常見的「雲端同步失敗」其實是暫時性的：喚醒當下 Wi‑Fi 還沒接上、換手、雲端函式冷啟動逾時，
// 5 秒後的自動補推通常就成功了——第一次就跳紅字只會嚇到店員（而且資料其實已補上雲）。
// 規則：可自動補推的暫時性錯誤，第一次失敗不跳，連續第 2 次仍失敗才跳；
//       候位 409 衝突（要店員確認候位）與不會自己好的錯誤（413、400…）照舊第一次就跳。
// retryState：nextPushRetryState 的結果（null＝不補推）。
export const PUSH_TOAST_AFTER_FAILURES = 2
export function shouldDeferPushErrorToast(err, retryState) {
  if (!retryState || err?.waitlistConflict) return false
  return retryState.failures < PUSH_TOAST_AFTER_FAILURES
}

// 「同一種錯誤」的判別鍵：退避期間的自動補推遇到同一種錯誤不重跳 toast。
export function pushErrorKey(err) {
  if (err?.waitlistConflict) return 'waitlist-conflict'
  return `${Number(err?.status) || 'network'}:${err?.code || ''}`
}

// 推送失敗後的補推狀態：不可補推的錯誤回 null（不自動補推）；可補推的累計失敗次數並算下一次時間。
export function nextPushRetryState(prev, err, now) {
  if (!isRetryablePushError(err)) return null
  const failures = (prev?.failures || 0) + 1
  const delay = PUSH_RETRY_BACKOFF_MS[Math.min(failures, PUSH_RETRY_BACKOFF_MS.length) - 1]
  return { failures, nextAt: now + delay }
}

export function isPushRetryDue(state, now) {
  return !!state && now + PUSH_RETRY_SLACK_MS >= state.nextAt
}
