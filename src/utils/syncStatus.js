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
