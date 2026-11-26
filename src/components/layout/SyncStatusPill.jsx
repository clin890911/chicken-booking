// 常駐同步燈（現場頁頂列）：平常也看得到「這台的變更到底上雲了沒」。
// 只讀 cloudStatus／usingFirebase，不改任何同步邏輯（狀態轉移見 utils/syncStatus.js）。
// 🔴 顯示規則必須與既有狀態機一致：
//   - rejected 黏住：只能由乾淨的推送成功或使用者主動放棄清除——這裡只顯示、不推導。
//   - 不從 cloudStatus.state 推導「pullCloud 成功」旗標（那是另一回事，見 BookingContext）。
//   - offline 且 pushFailed＝本機有變更沒上雲；單純 offline（拉取失敗）＝連不上，兩者文字分開。
// 整顆是一個 ≥44px 高的按鈕：有問題→導向既有的同步狀態說明（與 SyncAlertBar「查看」同一落點）；
// 正常→點開看最後成功同步的時間。
import { memo, useState, useId } from 'react'
import { useSearchParams, useInRouterContext } from 'react-router-dom'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { countRejected } from './SyncAlertBar'

// 純函式：狀態 → 燈的內容。供元件與測試共用。
export function describeSyncPill({ usingFirebase, cloudStatus } = {}) {
  if (usingFirebase === false) {
    return { key: 'local', tone: 'neutral', text: '本機模式', detail: '未連線雲端，資料只存在這台裝置' }
  }
  const s = cloudStatus || {}
  const at = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
  if (s.state === 'rejected') {
    const n = Math.max(1, countRejected(s.rejected))
    return { key: 'unsent', tone: 'danger', text: `⚠ ${n} 筆未上傳`, detail: `有 ${n} 筆變更雲端拒收，只存在這台裝置。點一下查看`, problem: true }
  }
  if (s.state === 'offline') {
    if (s.pushFailed) {
      return { key: 'unsent', tone: 'danger', text: '⚠ 有變更未上傳', detail: '網路不穩，變更先存在這台 iPad，連上後會自動上傳。點一下查看', problem: true }
    }
    return { key: 'offline', tone: 'warn', text: '⚠ 離線中', detail: '連不上雲端，變更會在連線後補送。點一下查看', problem: true }
  }
  if (s.state === 'syncing') {
    return { key: 'syncing', tone: 'info', text: '同步中…', detail: at ? `最後成功同步 ${at}` : '正在把變更上傳雲端' }
  }
  if (s.state === 'synced') {
    return { key: 'synced', tone: 'ok', text: '✓ 已同步', detail: at ? `最後成功同步 ${at}` : '已與雲端同步' }
  }
  return { key: 'idle', tone: 'info', text: '連線中…', detail: '正在取得雲端資料' }
}

const TONE = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  warn: 'border-amber-300 bg-amber-100 text-amber-950',
  danger: 'border-red-300 bg-red-600 text-white',
  neutral: 'border-chicken-brown/20 bg-chicken-brown/5 text-chicken-brown/70',
}

export function SyncStatusPillView({ usingFirebase, cloudStatus, onView }) {
  const info = describeSyncPill({ usingFirebase, cloudStatus })
  const [open, setOpen] = useState(false)
  const id = useId()
  const handle = () => {
    if (info.problem && onView) { onView(); return }
    setOpen(v => !v)
  }
  return (
    <div className="relative flex-none">
      <button type="button" onClick={handle} data-testid="sync-status-pill" data-sync-key={info.key}
        aria-expanded={info.problem ? undefined : open} aria-describedby={open ? id : undefined}
        title={info.detail}
        className={`tap inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border px-3 text-sm font-bold ${TONE[info.tone]}`}>
        {info.text}
      </button>
      {open && (
        <p id={id} role="status" data-testid="sync-status-detail"
          className="absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg border border-chicken-brown/15 bg-white px-3 py-2 text-xs font-bold text-chicken-brown shadow-lg">
          {info.detail}
        </p>
      )}
    </div>
  )
}

function WithRouter(props) {
  const [, setSearchParams] = useSearchParams()
  return <SyncStatusPillView {...props} onView={() => setSearchParams({ tab: 'settings', section: 'data', block: 'firestore' })} />
}

// 連接 context 的版本（現場頁用）。沒有 Router（測試／孤立渲染）時問題態點了只是展開說明。
function SyncStatusPill() {
  const { cloudStatus } = useBooking() || {}
  const { usingFirebase } = useAuth() || {}
  const inRouter = useInRouterContext()
  const props = { usingFirebase, cloudStatus }
  return inRouter ? <WithRouter {...props} /> : <SyncStatusPillView {...props} />
}
export default memo(SyncStatusPill)
