// 用餐時長階段判定：TableShape（地圖色階）、OpsHintBar（超時統計）、opsSweep 共用同一口徑。
// 階段：normal →（用餐時間-30 分起）late →（達用餐時間）overtime →（再過清桌緩衝）buffer-overtime

export function diffMin(isoTime, now = Date.now()) {
  return Math.floor((now - new Date(isoTime).getTime()) / 60000)
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
