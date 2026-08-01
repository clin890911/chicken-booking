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
export function statusAfterPull(prev, nowIso) {
  if (prev?.rejected) {
    return {
      ...prev,
      state: 'rejected',
      error: prev.rejected.message || '部分變更因權限不足未能上雲',
      lastSyncAt: nowIso,
    }
  }
  return { state: 'synced', lastSyncAt: nowIso, error: '', rejected: null }
}

// 推送/拉取失敗 → offline。保留 rejected：離線不會讓「被拒的變更」消失，
// 回復連線後仍要繼續警示。
export function statusAfterError(prev, message, fallback) {
  return { ...prev, state: 'offline', error: message || fallback }
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
