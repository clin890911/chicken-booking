// 用餐時長階段判定：TableShape（地圖色階）、OpsHintBar（超時統計）、opsSweep 共用同一口徑。
// 階段：normal →（用餐時間-30 分起）late →（達用餐時間）overtime →（再過清桌緩衝）buffer-overtime

export function diffMin(isoTime, now = Date.now()) {
  return Math.floor((now - new Date(isoTime).getTime()) / 60000)
}

// 已用餐分鐘（不為負）。🔴 入座時間比畫面時鐘新（多台 iPad 時鐘差幾秒、或剛按下入座的瞬間）時
// diffMin 會算出 -1，桌上就出現「-1 分」，店員以為系統算錯。一律夾到 0。
export function seatedMinutes(isoTime, now = Date.now()) {
  return Math.max(0, diffMin(isoTime, now))
}

// 桌上／卡片的已用餐字樣：未滿 1 分鐘（含時鐘誤差造成的負值）顯示「剛入座」，之後才是「N 分」。
export function seatedElapsedLabel(isoTime, now = Date.now()) {
  const m = seatedMinutes(isoTime, now)
  return m < 1 ? '剛入座' : `${m} 分`
}

export function stageOf(minutes, settings = {}) {
  const diningDuration = Number(settings.diningDurationMin) || 90
  const buffer = Number(settings.cleanupBufferMin) || 10
  const lateThreshold = Math.max(0, diningDuration - 30)
  if (minutes >= diningDuration + buffer) return 'buffer-overtime'
  if (minutes >= diningDuration) return 'overtime'
  if (minutes >= lateThreshold) return 'late'
  return 'normal'
}
