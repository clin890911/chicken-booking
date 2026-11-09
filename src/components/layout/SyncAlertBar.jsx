// 常駐同步警示小條（呈現層）：雲端拒收／離線時，現場頁也看得到，不必靠 4 秒 toast 或進設定頁。
// 只讀 cloudStatus，不改狀態轉移（見 utils/syncStatus.js）。flex-shrink-0，不碰一面式版面。
// 拒收條 44px（h-11）：「查看」鈕撐滿條高＝觸控 ≥44px（原 h-7 只有 28px）；離線條沒有鈕，維持 36px。
import { memo } from 'react'

export function countRejected(rejected) {
  if (!rejected) return 0
  return (rejected.writes?.length || 0) + (rejected.deletes?.length || 0) + (rejected.settings ? 1 : 0)
}

function SyncAlertBar({ cloudStatus, onView }) {
  const state = cloudStatus?.state
  if (state === 'rejected') {
    const n = Math.max(1, countRejected(cloudStatus.rejected))
    return (
      <div role="alert" data-testid="sync-alert-rejected"
        className="mb-2 flex h-11 flex-shrink-0 items-stretch justify-between gap-2 overflow-hidden rounded-lg border border-red-300 bg-red-600 pl-3 text-white">
        <p className="min-w-0 self-center truncate text-sm font-bold">有 {n} 筆變更雲端拒收，只存在這台裝置</p>
        <button type="button" onClick={onView}
          className="flex-shrink-0 bg-white/95 px-4 text-sm font-black text-red-700">查看</button>
      </div>
    )
  }
  if (state === 'offline') {
    return (
      <div role="status" data-testid="sync-alert-offline"
        className="mb-2 flex h-9 flex-shrink-0 items-center rounded-lg border border-amber-300 bg-amber-300 px-3 text-amber-950">
        <p className="min-w-0 truncate text-sm font-bold">離線中，變更會在連線後補推</p>
      </div>
    )
  }
  return null
}
export default memo(SyncAlertBar)
