import { useState, useEffect, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { Reorder, useDragControls } from 'framer-motion'
import { Input, Button, Select } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { isReadOnlyRole } from '../../utils/seatingPerms'
import { useToast, useConfirm } from '../ui/Toast'
import { searchNoshow } from '../../services/bookingService'
import { generateTimeSlots, todayStr, slotsInSeating, seatingForSlot } from '../../utils/timeSlots'
import TableGrid from './TableGrid'
import LayoutEditor from './LayoutEditor'
import TelegramSettings from './TelegramSettings'
import StaffAdminSection from './StaffAdminSection'
import ExportCenter from './ExportCenter'
import Icon from '../ui/Icon'
import { dirtySettingsKeys, describeSettingsChanges, rebaseSettingsForm } from '../../utils/settingsDiff'
import { validateLineReadiness } from '../../utils/lineReadiness'
import { onlineLeadLabel } from '../../utils/guestPolicy'

// 預設值（與 settingsService 的 DEFAULT 對齊，僅供 UI 對比顯示用）
const SETTINGS_DEFAULTS = {
  openTime: '11:00',
  closeTime: '19:00',
  slotInterval: 30,
  maxDaysAhead: 30,
  diningDurationMin: 90,
  cleanupBufferMin: 10,
}
// 會影響容量／可訂時段的欄位，改動時需提醒既有訂位受影響
const CAPACITY_FIELDS = ['diningDurationMin', 'cleanupBufferMin', 'openTime', 'closeTime', 'slotInterval']
// 同步集合的中文名：用在「部分變更未能上雲」的說明，讓店員看得懂是哪一類資料卡住。
const COLLECTION_LABELS = {
  bookings: '訂位',
  tables: '桌位',
  waitlist: '候位',
  customers: '顧客',
  agencies: '旅行社',
  guides: '導遊',
  groupReservations: '團體預排',
}
const FIELD_LABELS = {
  diningDurationMin: '用餐時間',
  cleanupBufferMin: '清桌緩衝',
  openTime: '開始時間',
  closeTime: '結束時間',
  slotInterval: '時段間隔',
}

// 二級分類導覽：把 16 個設定區塊按工作情境分成 5 類。sections 內為各區塊的 sectionKey，
// 只作「屬於哪一類」的成員判定；實際顯示順序仍由 JSX（DOM）順序決定。
const SETTINGS_CATEGORIES = [
  { key: 'ops-rules', label: '營運規則',   icon: 'clock', sections: ['hours', 'seatings', 'closures'] },
  { key: 'online',    label: '線上訂位',   icon: 'globe', sections: ['online-guard', 'hero', 'contact'] },
  { key: 'floor',     label: '現場與桌位', icon: 'chair', sections: ['automation', 'layout', 'table-enable'] },
  { key: 'line',      label: '通知與 LINE', icon: 'bell', sections: ['line', 'telegram'] },
  { key: 'data',      label: '資料與權限', icon: 'lock', sections: ['firestore', 'noshow', 'export', 'staff', 'account'] },
]
const DEFAULT_CATEGORY = 'ops-rules'
// AdminPage 在捲動容器外、BottomNav 之上留的固定操作列插槽 id（儲存列會 portal 進去）。
export const ADMIN_ACTION_BAR_SLOT = 'admin-action-bar-slot'
// 由父層提供「目前分類包含的 sectionKey 清單」；SettingsSection 據此自我隱藏（不屬當前分類則 return null）。
const CategoryContext = createContext([])
// 完全唯讀角色（kitchen）：所有「可編輯」區塊用 <fieldset disabled> 整段鎖住，輸入框／按鈕一律不可操作。
// 下列區塊本質是讀取或帳號操作（查 No-show、匯出、登出），維持可用；雲端同步區改由按鈕層級處理。
const ReadOnlyContext = createContext(false)
const READONLY_EXEMPT_SECTIONS = ['noshow', 'export', 'account', 'firestore']

export default function SettingsView({ onOpenCustomer }) {
  const { settings, bookings, updateSettings, flushCloudNow, cloudStatus, migrateLocalToCloud, pullCloud, discardRejectedChanges, localPersistDegraded } = useBooking()
  const { user, signOut, can, usingFirebase } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState(settings)
  // 已存 settings 從外部更新（雲端拉取、其他裝置、桌位佈局編輯器存檔）時，表單跟上新值、只保留使用者改過的欄位。
  // 否則表單停在打開頁面時的舊值：冒出不是自己改的「未儲存變更」，按儲存還會把別處的新值蓋回舊值。
  // （render 期間比對前一份並 setState＝React 官方的「依 props 調整 state」寫法，不多一輪 effect 閃爍。）
  const [formBase, setFormBase] = useState(settings)
  if (settings !== formBase) {
    setFormBase(settings)
    setForm(f => rebaseSettingsForm(f, formBase, settings))
  }
  const [searchPhone, setSearchPhone] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  // 目前分類同步到 URL（?tab=settings&section=xxx）：重整/上一頁/書籤皆能還原、可分享定位。
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSection = searchParams.get('section')
  const activeKey = SETTINGS_CATEGORIES.some(c => c.key === rawSection) ? rawSection : DEFAULT_CATEGORY
  const activeCat = SETTINGS_CATEGORIES.find(c => c.key === activeKey) || SETTINGS_CATEGORIES[0]
  const setActiveKey = (k) => setSearchParams(prev => {
    const p = new URLSearchParams(prev)
    p.set('tab', 'settings') // 確保停留在設定分頁（分類鈕從設定頁內按）
    p.set('section', k)
    return p
  })

  // B14：追蹤未儲存變更（比對目前表單 vs 已存 settings）＋給店員看的明細
  const dirtyKeys = useMemo(() => dirtySettingsKeys(form, settings), [form, settings])
  const changeList = useMemo(() => describeSettingsChanges(settings, form), [form, settings])
  const isDirty = dirtyKeys.length > 0
  // 只有店長能存設定（見 handleSave 的守門）。非店長時整頁視為唯讀：
  // 不武裝 beforeunload、不顯示「儲存」CTA——否則使用者手滑改到一個欄位後，
  // 會永遠卡在「有未儲存變更」且每次離開/重新整理都被瀏覽器攔下來，
  // 而重新整理正是同步異常時的標準排除手段，等於把解藥擋掉。
  const canEditSettings = can('settings.update')
  const readOnlyRole = isReadOnlyRole(can)
  // 是否動到會影響容量／時段的設定（B1）
  const capacityDirty = dirtyKeys.some(k => CAPACITY_FIELDS.includes(k))
  // 未來已確認訂位筆數（保守估計：date>=今天 && status==='confirmed'）
  const affectedBookingCount = useMemo(
    () => (bookings || []).filter(b => b.date >= todayStr() && b.status === 'confirmed').length,
    [bookings]
  )
  // 動態可訂時段數（依目前表單的營業時間 / 間隔）
  const slotCount = useMemo(() => {
    try {
      return generateTimeSlots(form.openTime, form.closeTime, Number(form.slotInterval) || 30).length
    } catch {
      return 0
    }
  }, [form.openTime, form.closeTime, form.slotInterval])

  // 折疊標題摘要 / 狀態徽章：不用展開即可一眼看現況
  const seatingsCount = (form.seatings || []).length
  const hoursSummary = `${form.openTime || '—'}–${form.closeTime || '—'} · ${form.slotInterval || 30} 分一格 · ${slotCount} 時段`
  const guardOn = form.onlineAutoCloseEnabled === true
  const guardPercent = Number(form.onlineAutoClosePercent) || 80
  const guardSummary = guardOn
    ? `達 ${guardPercent}% 自動關閉 · 抵達前 ${onlineLeadLabel()}停止線上訂位`
    : `抵達前 ${onlineLeadLabel()}停止線上訂位 · 未啟用滿座自動關閉`
  // 休店/關閉時段摘要：今天起有幾天有關閉設定（收合時就看得到）
  const upcomingClosureDays = (() => {
    const c = form.closures || {}
    const t = todayStr()
    const days = new Set([
      ...(c.closedDates || []),
      ...Object.keys(c.closedSeatings || {}).filter(k => (c.closedSeatings[k] || []).length),
      ...Object.keys(c.closedSlots || {}).filter(k => (c.closedSlots[k] || []).length),
    ])
    return [...days].filter(d => d >= t).length
  })()
  const autoReleaseOn = form.autoReleaseEnabled !== false
  const autoReleaseHr = (Number(form.autoReleaseAfterMin) || 300) / 60
  const rolloverOn = form.dayRolloverEnabled !== false
  const automationSummary = autoReleaseOn
    ? `逾時 ${autoReleaseHr} 小時自動釋桌${rolloverOn ? ' · 換日掃除' : ''}`
    : `未啟用自動釋桌${rolloverOn ? ' · 換日掃除' : ''}`

  // B14：離開前提醒尚有未儲存變更
  useEffect(() => {
    if (!isDirty || !canEditSettings) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty, canEditSettings])

  // B1：若改到容量／時段相關設定，儲存前用 confirm(danger) 提示受影響的未來訂位
  const handleSave = async () => {
    // 🔴 非店長不可存設定。這不只是權限問題，更是同步的防線：後端 settings 需
    // settings.update（僅 manager）。非店長寫進本機 settings 後永遠與雲端不一致、
    // 每次差異推送都夾帶並被拒，畫面會長期顯示雲端根本沒有的設定。
    // （部分推送上線後不再連坐拖垮其他集合，但這筆本機變更仍然永遠上不了雲。）
    if (!can('settings.update')) {
      toast.error('你的角色沒有變更店家設定的權限，請聯絡店長')
      return
    }
    if (capacityDirty && affectedBookingCount > 0) {
      const changed = dirtyKeys.filter(k => CAPACITY_FIELDS.includes(k)).map(k => FIELD_LABELS[k] || k).join('、')
      const ok = await confirm(
        `你即將調整「${changed}」，這會改變可訂容量與時段。\n目前有 ${affectedBookingCount} 筆未來「已確認」訂位可能受影響（保守估計）。\n仍要儲存嗎？`,
        { title: '影響現有訂位', danger: true, confirmLabel: '仍要儲存' }
      )
      if (!ok) return
    }
    // 存後把 form 重置為正規化後的 settings：清除因 withDefaults 正規化造成的 phantom-dirty，
    // 讓 sticky banner 正確消失、beforeunload 守衛解除。
    setSaving(true)
    try {
      const saved = updateSettings(form)
      setForm(saved)
      // 關鍵：以「雲端是否真的寫入成功」為準宣告成功，而非只憑本機 localStorage。
      // 本機模式（未設 Firebase）沒有雲端可寫，本機存好即算完成。
      if (!usingFirebase) {
        toast.success('已儲存（本機模式）')
        return
      }
      const r = await flushCloudNow()
      if (r.ok) toast.success('已儲存並同步雲端')
      // 這台還沒從雲端取得資料：設定取得後會以雲端版本為準，這次的修改不會補送（不是「重試」能解決的）。
      else if (r.deferred) toast.error('設定尚未存到雲端：這台裝置還沒取得雲端資料，取得後會以雲端版本為準。請等同步完成後再改一次')
      else if (r.rejected) toast.error(`本機已存，但雲端拒絕了這筆變更：${r.error}。請改用有權限的帳號，或到下方同步狀態列選擇以雲端為準`)
      else toast.error(`本機已存，但雲端同步失敗：${r.error}。請按「重試同步」或檢查網路後再試`)
    } finally {
      setSaving(false)
    }
  }
  // 雲端同步失敗後的重試：只重推本機未同步的變更（本機資料已存，不會遺失）。
  const handleRetrySync = async () => {
    setSaving(true)
    try {
      const r = await flushCloudNow()
      if (r.ok) toast.success('已同步雲端')
      else if (r.deferred) toast.error('這台裝置還沒取得雲端資料，請稍候再試')
      else toast.error(`雲端同步仍失敗：${r.error}`)
    } finally {
      setSaving(false)
    }
  }
  // 放棄「因權限不足推不上雲」的本機變更，改以雲端為準。這會真的丟資料，故加強確認。
  // 不自動執行的理由：那些變更是店員真的做過的操作，要不要放棄是店家的決定。
  const handleDiscardRejected = async () => {
    const rejected = cloudStatus?.rejected
    if (!rejected) return
    const scopes = [
      ...(rejected.writes || []).map(c => `${COLLECTION_LABELS[c] || c}的變更`),
      ...(rejected.deletes || []).map(c => `${COLLECTION_LABELS[c] || c}的刪除`),
      ...(rejected.settings ? ['店家設定的變更'] : []),
    ]
    const ok = await confirm(
      `將放棄這台裝置上以下未能上雲的變更，改以雲端資料為準：\n\n${scopes.map(s => `・${s}`).join('\n')}\n\n這些變更會消失且無法復原。確定嗎？`,
      { title: '放棄未上雲的變更', danger: true, confirmLabel: '放棄並以雲端為準' }
    )
    if (!ok) return
    setSaving(true)
    try {
      await discardRejectedChanges(rejected)
      toast.success('已改以雲端資料為準')
    } finally {
      setSaving(false)
    }
  }
  const handleBannerFiles = async (files) => {
    const list = Array.from(files || [])
    if (list.length === 0) return
    try {
      const images = await Promise.all(list.map(file => readBannerFile(file)))
      setForm(f => ({ ...f, heroBanners: [...(f.heroBanners || []), ...images] }))
      // 壓縮提示：dataURL base64 約比原檔大 1/3，過大會拖慢首頁載入
      const heavy = images.filter(im => (im.image?.length || 0) > 900_000).length
      if (heavy) toast.info(`已新增 ${images.length} 張；其中 ${heavy} 張偏大，建議先壓到 500KB 以內加快首頁載入`)
    } catch (err) {
      toast.error(err.message || '圖片讀取失敗')
    }
  }
  const removeBanner = async (id) => {
    if (!(await confirm('確定刪除這張首頁廣告？', { title: '刪除廣告', confirmLabel: '刪除' }))) return
    setForm(f => ({ ...f, heroBanners: (f.heroBanners || []).filter(b => b.id !== id) }))
  }
  const handleSearch = () => {
    setSearchResult(searchNoshow(searchPhone.trim()))
  }
  const lineReadiness = validateLineReadiness(form)
  const handleValidateLine = () => {
    if (!lineReadiness.ready) {
      return toast.error(`LINE 通知尚未開通：${lineReadiness.issues.map(i => i.label).join('、')}需要補齊或修正`)
    }
    toast.success('LINE 必要欄位與網址格式檢查通過；仍需確認 LINE Console 設定，並以本人帳號驗證登入及通知送達')
  }
  const handleCloudSync = async (type) => {
    // 「上傳本機資料到 Firestore」是全量覆寫（含 settings），對非店長必然 403；
    // 更危險的是：若某台裝置本機資料已過時，全量上傳會以 last-write-wins 蓋掉
    // 其他裝置寫入的新資料。故只開放給店長。（「從 Firestore 重新整理」是唯讀，不擋。）
    if (type === 'push' && !can('settings.update')) {
      toast.error('只有店長可以上傳本機資料覆蓋雲端')
      return
    }
    setCloudBusy(true)
    try {
      if (type === 'push') await migrateLocalToCloud()
      else await pullCloud()
      toast.success(type === 'push' ? '已上傳 Firestore' : '已從 Firestore 更新')
    } catch (err) {
      toast.error(`${err.message || '同步失敗'}`)
    } finally {
      setCloudBusy(false)
    }
  }

  // B14：未儲存變更提示 + 統一儲存 CTA（全域，跨分類反映所有未存變更）。
  // 渲染到 AdminPage 捲動容器外的固定插槽：iPad Safari 對 overflow 捲動容器內的 sticky 元素，
  // 捲動後點擊熱區會停在舊位置（看得到「儲存」卻按不到）。找不到插槽（例如單獨渲染）時退回原地顯示。
  const [actionBarSlot, setActionBarSlot] = useState(null)
  useEffect(() => { setActionBarSlot(document.getElementById(ADMIN_ACTION_BAR_SLOT)) }, [])
  const saveBar = isDirty ? (
    <div className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm font-bold text-amber-800">
        {canEditSettings ? `有未儲存變更（${dirtyKeys.length} 項）` : `這些變更不會被儲存（${dirtyKeys.length} 項）`}
        {capacityDirty && affectedBookingCount > 0 && (
          <span className="ml-2 inline-flex items-center rounded-full bg-chicken-red px-2 py-0.5 text-xs font-bold text-white">
            影響現有訂位
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setForm(settings)}
          disabled={saving}
          className="min-h-[44px] rounded-xl border border-amber-400/60 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
        >
          還原
        </button>
        {canEditSettings && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary min-h-[44px] px-5 py-2 disabled:opacity-60"
          >
            {saving ? '儲存中…' : '儲存全部變更'}
          </button>
        )}
      </div>
    </div>
    {/* 修改明細：預設收合，點開看改了什麼，可逐項還原 */}
    <details className="group mt-2 border-t border-amber-300/70 pt-2">
      <summary className="flex min-h-[36px] cursor-pointer list-none items-center gap-1 text-sm font-bold text-amber-800">
        查看修改內容
        <span aria-hidden className="text-xs transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <ul className="mt-1 max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
        {changeList.map(c => (
          <li key={c.key} className="flex items-start justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm">
            <div className="min-w-0 text-chicken-brown">
              <div className="font-bold">{c.label}</div>
              {c.details ? (
                <ul className="mt-0.5 space-y-0.5 text-xs leading-5 text-chicken-brown/75">
                  {c.details.map((d, i) => <li key={i}>・{d}</li>)}
                </ul>
              ) : (
                <div className="mt-0.5 break-all text-xs leading-5">
                  <span className="text-chicken-brown/50 line-through">{c.from}</span>
                  <span className="mx-1.5 text-chicken-brown/40">→</span>
                  <span className="font-bold text-chicken-red">{c.to}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, [c.key]: settings[c.key] }))}
              disabled={saving}
              className="shrink-0 rounded-lg border border-amber-400/60 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              還原此項
            </button>
          </li>
        ))}
      </ul>
    </details>
    </div>
  ) : null

  return (
    <CategoryContext.Provider value={activeCat.sections}>
    <ReadOnlyContext.Provider value={readOnlyRole}>
      <div className="flex gap-4">
      {/* 桌機：左側二級分類側欄 */}
      <nav className="hidden lg:flex w-44 shrink-0 flex-col gap-1" aria-label="設定分類">
        {SETTINGS_CATEGORIES.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActiveKey(c.key)}
            aria-current={activeKey === c.key ? 'page' : undefined}
            className={`tap flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
              activeKey === c.key ? 'bg-chicken-red/[0.08] text-chicken-red' : 'text-chicken-brown/70 hover:bg-chicken-brown/[0.05]'
            }`}
          >
            <Icon name={c.icon} size={18} /><span>{c.label}</span>
          </button>
        ))}
      </nav>

      {/* 內容欄 */}
      <div className="min-w-0 flex-1 space-y-4">
      {/* 手機：頂部橫向分類 pills */}
      <div className="lg:hidden -mx-1 flex gap-2 overflow-x-auto pb-1" aria-label="設定分類">
        {SETTINGS_CATEGORIES.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActiveKey(c.key)}
            aria-current={activeKey === c.key ? 'page' : undefined}
            className={`tap min-h-[40px] shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors ${
              activeKey === c.key ? 'bg-chicken-red/[0.08] text-chicken-red' : 'bg-white border border-chicken-brown/10 text-chicken-brown/70'
            }`}
          >
            <Icon name={c.icon} size={16} className="mr-1 inline-block align-[-3px]" />{c.label}
          </button>
        ))}
      </div>

      {/* 雲端同步狀態列：隨時可見地反映「本機變更是否已真的寫入 Firebase」，
          解決「按了儲存卻看不出到底有沒有存到雲端」。offline 時提供一鍵重試（本機資料不會遺失）。 */}
      {usingFirebase && (
        <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-sm font-bold ${
          cloudStatus?.state === 'offline'
            ? 'border-red-300 bg-red-50 text-chicken-red'
            : cloudStatus?.state === 'rejected'
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : cloudStatus?.state === 'syncing'
              ? 'border-blue-200 bg-blue-50 text-blue-700'
                : cloudStatus?.state === 'synced'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-chicken-brown/15 bg-chicken-brown/5 text-chicken-brown/50'
        }`}>
          <span>
            {cloudStatus?.state === 'offline' && `雲端未同步：${cloudStatus.error}（本機已存，尚未寫入 Firebase）`}
            {cloudStatus?.state === 'rejected' && `部分變更未能上雲：${cloudStatus.error}。其餘資料已同步；被擋下的變更目前只存在這台裝置，畫面顯示的內容與雲端不一致。`}
            {cloudStatus?.state === 'syncing' && '正在同步到雲端…'}
            {cloudStatus?.state === 'synced' && `已同步雲端${cloudStatus.lastSyncAt ? ` · ${new Date(cloudStatus.lastSyncAt).toLocaleTimeString('zh-TW')}` : ''}`}
            {(!cloudStatus?.state || cloudStatus?.state === 'idle') && '尚未同步'}
          </span>
          {cloudStatus?.state === 'offline' && (
            <button
              onClick={handleRetrySync}
              disabled={saving}
              className="min-h-[40px] rounded-xl border border-red-400/60 bg-white px-4 py-1.5 text-sm font-bold text-chicken-red hover:bg-red-50 disabled:opacity-50"
            >
              {saving ? '重試中…' : '重試同步'}
            </button>
          )}
          {cloudStatus?.state === 'rejected' && (
            <button
              onClick={handleDiscardRejected}
              disabled={saving}
              className="min-h-[40px] rounded-xl border border-amber-400/60 bg-white px-4 py-1.5 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              放棄這些變更，以雲端為準
            </button>
          )}
        </div>
      )}

      {/* 🔴 驗收回饋：cloudDataService 的同步基準線落地 localStorage 若寫入失敗（裝置空間不足、
          無痕/私密瀏覽模式拒寫），程式會靜默退化回「整頁重新整理可能把佈局蓋掉」的修復前行為。
          不掛在 usingFirebase 底下：這是純 localStorage 問題，本機模式一樣會中。 */}
      {localPersistDegraded && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-chicken-red">
          <span>本機儲存空間不足或瀏覽器處於無痕/私密瀏覽模式，佈局變更可能在重新整理後遺失。建議清出裝置空間，或關閉無痕/私密瀏覽模式後重新整理頁面。</span>
        </div>
      )}

      {/* 非店長：整頁唯讀提示。改了也存不了，先講清楚，免得白填。 */}
      {!canEditSettings && (
        <div className="-mx-1 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          唯讀：你的角色無法變更店家設定。下方仍可查看內容與同步狀態，變更不會被儲存。
        </div>
      )}

      {/* B14：未儲存變更提示 + 統一儲存 CTA：有插槽則固定在頁面底部，否則原地顯示 */}
      {actionBarSlot ? createPortal(saveBar, actionBarSlot) : saveBar}

      <SettingsSection sectionKey="hours" title="營業時段" description="控制客人可選日期、時段與營業起訖時間。" summary={hoursSummary}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="開始時間" type="time" value={form.openTime} onChange={e => setForm(f => ({ ...f, openTime: e.target.value }))} />
            <Input label="結束時間" type="time" value={form.closeTime} onChange={e => setForm(f => ({ ...f, closeTime: e.target.value }))} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="label !mb-0">時段間隔</span>
              <DefaultBadge current={Number(form.slotInterval)} fallback={SETTINGS_DEFAULTS.slotInterval} unit="分" />
            </div>
            <Select
              className="mt-2"
              value={form.slotInterval}
              onChange={e => setForm(f => ({ ...f, slotInterval: Number(e.target.value) }))}
              options={[{ value: 15, label: '15 分鐘' }, { value: 30, label: '30 分鐘' }, { value: 60, label: '60 分鐘' }]}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="label !mb-0">可預訂天數</span>
              <DefaultBadge current={Number(form.maxDaysAhead)} fallback={SETTINGS_DEFAULTS.maxDaysAhead} unit="天" />
            </div>
            <Select
              className="mt-2"
              value={form.maxDaysAhead}
              onChange={e => setForm(f => ({ ...f, maxDaysAhead: Number(e.target.value) }))}
              options={[{ value: 7, label: '7 天' }, { value: 14, label: '14 天' }, { value: 30, label: '30 天' }, { value: 60, label: '60 天' }]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="label !mb-0">用餐時間（分鐘）</span>
                <DefaultBadge current={Number(form.diningDurationMin) || 90} fallback={SETTINGS_DEFAULTS.diningDurationMin} unit="分" />
              </div>
              <Input
                className="mt-2"
                type="number"
                min="30"
                max="240"
                value={form.diningDurationMin || 90}
                onChange={e => setForm(f => ({ ...f, diningDurationMin: Number(e.target.value) }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="label !mb-0">清桌緩衝（分鐘）</span>
                <DefaultBadge current={Number(form.cleanupBufferMin) || 10} fallback={SETTINGS_DEFAULTS.cleanupBufferMin} unit="分" />
              </div>
              <Input
                className="mt-2"
                type="number"
                min="0"
                max="60"
                value={form.cleanupBufferMin || 10}
                onChange={e => setForm(f => ({ ...f, cleanupBufferMin: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            可訂位容量會以「用餐時間 + 清桌緩衝」計算；目前每筆訂位佔用 {(Number(form.diningDurationMin) || 90) + (Number(form.cleanupBufferMin) || 10)} 分鐘。
            <span className="mt-1 block">
              依目前營業時間與間隔，每天可訂 <span className="font-bold text-chicken-brown">{slotCount}</span> 個時段。
            </span>
          </div>
          {capacityDirty && (
            <div className="flex items-center gap-2 rounded-xl border border-chicken-red/20 bg-chicken-red/5 px-3 py-2">
              <span className="inline-flex items-center rounded-full bg-chicken-red px-2 py-0.5 text-xs font-bold text-white">影響現有訂位</span>
              <span className="text-xs leading-5 text-chicken-brown/70">
                此區設定會改變可訂容量／時段；儲存前會提示有 {affectedBookingCount} 筆未來已確認訂位可能受影響。
              </span>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection sectionKey="seatings" title="場次設定" description="定義固定場次（午餐第一批、晚餐第一批…）。排位規劃地圖與「關閉整場次」皆依此。" summary={`${seatingsCount} 場次`}>
        <SeatingsEditor form={form} setForm={setForm} />
      </SettingsSection>

      <SettingsSection sectionKey="online-guard" title="線上訂位防線" description="只限制線上客人端；店員後台、現場與團體預排完全不受影響。" badge={guardOn ? '啟用' : '未啟用'} summary={guardSummary}>
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">滿座門檻自動關閉</div>
              <div className="text-xs text-chicken-brown/55 mt-0.5">時段已訂人數達下方門檻時，線上自動顯示不可訂，剩餘座位保留給現場與電話客人。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.onlineAutoCloseEnabled === true}
              onChange={e => setForm(f => ({ ...f, onlineAutoCloseEnabled: e.target.checked }))} />
          </label>
          <div>
            <span className="label">關閉門檻（已訂佔總容量比例）</span>
            <Select
              className="mt-2"
              value={Number(form.onlineAutoClosePercent) || 80}
              onChange={e => setForm(f => ({ ...f, onlineAutoClosePercent: Number(e.target.value) }))}
              options={[
                { value: 70, label: '70%' },
                { value: 75, label: '75%' },
                { value: 80, label: '80%（建議）' },
                { value: 85, label: '85%' },
                { value: 90, label: '90%' },
                { value: 95, label: '95%' },
              ]}
            />
          </div>
          <div>
            <span className="label">線上訂位截止時間</span>
            <div className="mt-2 rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm leading-6 text-chicken-brown/70">
              線上訂位依預計抵達時間，至少提前 {onlineLeadLabel()}；不足 {onlineLeadLabel()}請來電詢問。線上改期也適用，電話與現場不受影響。
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection sectionKey="automation" title="現場自動化（自動清檯）" description="超時自動釋桌與換日掃除；系統自動動作會留紀錄（現場提示列可查）。" badge={autoReleaseOn ? '啟用' : '未啟用'} summary={automationSummary}>
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">超時自動釋桌</div>
              <div className="text-xs text-chicken-brown/55 mt-0.5">用餐超過下方時數高概率是忘記按清桌：散客桌自動釋出、團體桌自動「此梯離席」待清。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.autoReleaseEnabled !== false}
              onChange={e => setForm(f => ({ ...f, autoReleaseEnabled: e.target.checked }))} />
          </label>
          <div>
            <span className="label">視為忘記清桌的時數</span>
            <Select
              className="mt-2"
              value={Number(form.autoReleaseAfterMin) || 300}
              onChange={e => setForm(f => ({ ...f, autoReleaseAfterMin: Number(e.target.value) }))}
              options={[
                { value: 180, label: '3 小時' },
                { value: 240, label: '4 小時' },
                { value: 300, label: '5 小時（建議）' },
                { value: 360, label: '6 小時' },
                { value: 480, label: '8 小時' },
              ]}
            />
          </div>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">換日掃除</div>
              <div className="text-xs text-chicken-brown/55 mt-0.5">每天第一次打開系統時，自動清掉昨日殘留的用餐/待清桌況，昨日已到店團體自動結案。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.dayRolloverEnabled !== false}
              onChange={e => setForm(f => ({ ...f, dayRolloverEnabled: e.target.checked }))} />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">換日自動標記未到（No-show）</div>
              <div className="text-xs text-chicken-red/80 mt-0.5">建議保持關閉：昨日未處理的訂位自動標 No-show 會影響報表口徑（不計入顧客罰則）。當天請改用現場「今日訂位 → 過時未到」處理。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.autoNoshowOnRollover === true}
              onChange={e => setForm(f => ({ ...f, autoNoshowOnRollover: e.target.checked }))} />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection sectionKey="closures" title="休店 / 關閉時段管理" description="關閉整天（公休）、特定場次或特定時段的新訂位；既有訂位不受影響。" badge={upcomingClosureDays ? `${upcomingClosureDays} 天有關閉` : undefined} summary={upcomingClosureDays ? `近期有 ${upcomingClosureDays} 天設有公休或關閉時段，展開查看` : '近期沒有關閉的日期或時段'}>
        <ClosuresEditor form={form} setForm={setForm} bookings={bookings} unsaved={dirtyKeys.includes('closures')} />
      </SettingsSection>

      <SettingsSection sectionKey="hero" title="首頁廣告輪播" description="新增橫式照片，會顯示在客人首頁第一屏。" defaultOpen>
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-chicken-brown/15 bg-white px-4 py-8 text-center transition hover:border-chicken-red/40">
            <span className="text-sm font-bold text-chicken-brown">上傳橫式照片</span>
            <span className="mt-1 text-xs text-chicken-brown/55">建議 16:9 或 2:1、單張小於 2MB（越小越快，建議壓到 500KB 內）、支援多選</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => handleBannerFiles(e.target.files)}
            />
          </label>

          {(form.heroBanners || []).length === 0 ? (
            <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">
              尚未新增廣告圖。首頁會先顯示品牌 logo 與預設訂位宣傳。
            </div>
          ) : (
            <>
              <p className="text-xs font-bold text-chicken-brown/50">拖曳右上角握把可調整輪播順序；圖上文字即客人首頁看到的樣子（前台預覽）。</p>
              <Reorder.Group axis="y" values={form.heroBanners || []} onReorder={next => setForm(f => ({ ...f, heroBanners: next }))} className="space-y-3">
                {(form.heroBanners || []).map((banner, index) => (
                  <HeroBannerItem
                    key={banner.id}
                    banner={banner}
                    index={index}
                    total={(form.heroBanners || []).length}
                    setForm={setForm}
                    removeBanner={removeBanner}
                  />
                ))}
              </Reorder.Group>
            </>
          )}
        </div>
      </SettingsSection>

      <SettingsSection sectionKey="line" title="LINE 官方帳號" description="設定客人訂位成功後看到的 LINE 加好友入口與保存提醒。">
        <div className="space-y-4">
          {/* C11：基本 */}
          <FieldGroup title="基本" hint="客人訂位完成後看到的 LINE 加好友入口。">
            <Field hint="顯示在加好友按鈕旁的官方帳號名稱。">
              <Input
                label="顯示名稱"
                value={form.lineOfficialName || ''}
                onChange={e => setForm(f => ({ ...f, lineOfficialName: e.target.value }))}
                placeholder="雞王涮涮鍋 LINE 官方帳號"
                title="顯示在加好友按鈕旁的官方帳號名稱"
              />
            </Field>
            <Field hint="客人點「加入好友」會開啟的 lin.ee 連結，必填。">
              <Input
                label="LINE 官方帳號加入連結"
                type="url"
                value={form.lineOfficialUrl || ''}
                onChange={e => setForm(f => ({ ...f, lineOfficialUrl: e.target.value.trim() }))}
                placeholder="https://lin.ee/xxxxxxx"
                title="客人點加入好友會開啟的 lin.ee 連結"
              />
            </Field>
          </FieldGroup>

          {/* LINE Login 網頁授權綁定（建議的主要綁定方式，取代易卡載入的 LIFF） */}
          <FieldGroup title="LINE Login 綁定（建議）" hint="網頁授權綁定：客人點訂位頁 CTA → LINE 授權 → 自動完成綁定並接收訊息。比 LIFF 穩定，不會卡「一直載入」。">
            <Field hint="LINE Login channel 的 Channel ID（非 Messaging API channel）。位置：LINE Developers → LINE Login channel → Basic settings。LINE Login 綁定與「我的訂位」查詢共用；未填則兩者停用。">
              <Input
                label="LINE Login Channel ID"
                value={form.lineLoginChannelId || ''}
                onChange={e => setForm(f => ({ ...f, lineLoginChannelId: e.target.value.trim() }))}
                placeholder="1234567890"
                title="LINE Login channel 的 Channel ID（綁定 + 我的訂位查詢用）"
              />
            </Field>
            <Field hint="OAuth 回呼網址＝部署後的 lineLoginCallback 函式網址；需一字不差填入 LINE Login channel 的 Callback URL 白名單。另需把 Login channel 連動（Linked OA）到官方帳號，加好友才會生效。">
              <Input
                label="LINE Login 回呼網址"
                type="url"
                value={form.lineLoginCallbackUrl || ''}
                onChange={e => setForm(f => ({ ...f, lineLoginCallbackUrl: e.target.value.trim() }))}
                placeholder="https://linelogincallback-xxxx-uc.a.run.app"
                title="OAuth 回呼網址（lineLoginCallback 函式 URL）"
              />
            </Field>
          </FieldGroup>

          {/* C11：LIFF（舊版，建議關閉，改用上方 LINE Login 綁定） */}
          <FieldGroup title="LIFF（舊版）" hint="舊版 LIFF 自動綁定；多段重導易卡「一直載入」，建議保持關閉、改用上方 LINE Login 綁定。">
            <label className="flex items-start gap-3 rounded-xl border border-chicken-brown/10 bg-white px-4 py-3 text-sm font-bold text-chicken-brown">
              <input
                type="checkbox"
                checked={!!form.lineUseLiff}
                onChange={e => setForm(f => ({ ...f, lineUseLiff: e.target.checked }))}
                className="mt-1"
              />
              <span>
                使用 LIFF 自動綁定（不建議）
                <span className="mt-1 block text-xs font-bold leading-5 text-chicken-brown/55">
                  建議關閉，改用上方 LINE Login 網頁授權綁定；LIFF 在 LINE 內外瀏覽器易重導卡死。
                </span>
              </span>
            </label>
            <Field hint="開啟 LIFF 時客人綁定頁的 liff.line.me 連結。">
              <Input
                label="LIFF 訂位綁定連結（選填）"
                type="url"
                value={form.lineLiffUrl || ''}
                onChange={e => setForm(f => ({ ...f, lineLiffUrl: e.target.value.trim() }))}
                placeholder="https://liff.line.me/xxxxxxxx"
                title="LIFF 訂位綁定頁連結"
              />
            </Field>
            <Field hint="LINE Developers 後台建立 LIFF App 後取得的 ID。">
              <Input
                label="LIFF ID（選填）"
                value={form.lineLiffId || ''}
                onChange={e => setForm(f => ({ ...f, lineLiffId: e.target.value.trim() }))}
                placeholder="xxxxxxxxxx-xxxxxxxx"
                title="LINE Developers 後台的 LIFF App ID"
              />
            </Field>
          </FieldGroup>

          {/* 店員端改動通知客人（feature flag，預設關）*/}
          <FieldGroup title="通知" hint="店員後台改動訂位時是否自動 LINE 通知客人。">
            <label className="flex items-start gap-3 rounded-xl border border-chicken-brown/10 bg-white px-4 py-3 text-sm font-bold text-chicken-brown">
              <input
                type="checkbox"
                checked={!!form.lineNotifyOnAdminChange}
                onChange={e => setForm(f => ({ ...f, lineNotifyOnAdminChange: e.target.checked }))}
                className="mt-1"
              />
              <span>
                後台改期 / 取消時自動 LINE 通知客人
                <span className="mt-1 block text-xs font-bold leading-5 text-chicken-brown/55">
                  只通知客人在意的變更（取消、改日期/時段/人數）；指派桌位、入座、結帳等內務操作不通知。
                  通知約在 2 分鐘內送達已綁定 LINE 的客人。建議店內先驗證一輪再開啟。
                </span>
              </span>
            </label>
          </FieldGroup>

          {/* C11：後端端點 */}
          <FieldGroup collapsible title="後端端點（進階）" hint="Cloud Functions / 後端服務網址；API Token 一律放後端，不可放前端。">
            <Field hint="處理 LINE 綁定的後端網址。">
              <Input
                label="LINE 綁定後端端點（選填）"
                type="url"
                value={form.lineBindEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, lineBindEndpoint: e.target.value.trim() }))}
                placeholder="https://.../lineBind"
                title="處理 LINE 綁定的後端網址"
              />
            </Field>
            <Field hint="推播訂位通知給客人的後端網址。">
              <Input
                label="LINE 推播後端端點（選填）"
                type="url"
                value={form.linePushEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, linePushEndpoint: e.target.value.trim() }))}
                placeholder="https://.../linePushBooking"
                title="推播訂位通知的後端網址"
              />
            </Field>
            <Field hint="供客人在 LINE 內查詢訂位的後端網址。">
              <Input
                label="LINE 訂位讀取端點（選填）"
                type="url"
                value={form.lineManageEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, lineManageEndpoint: e.target.value.trim() }))}
                placeholder="https://.../lineGetBooking"
                title="客人在 LINE 內查詢訂位的後端網址"
              />
            </Field>
            <Field hint="「LINE 我的訂位」清單查詢的後端網址。">
              <Input
                label="LINE 我的訂位端點（選填）"
                type="url"
                value={form.lineMyBookingsEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, lineMyBookingsEndpoint: e.target.value.trim() }))}
                placeholder="https://.../lineMyBookings"
                title="LINE 我的訂位清單查詢端點"
              />
            </Field>
            <Field hint="訂位網站的正式網址。LINE 通知卡片的「管理 / 修改訂位」按鈕連結以此組成；未填則卡片不顯示該按鈕。">
              <Input
                label="訂位網站網址"
                type="url"
                value={form.publicSiteUrl || ''}
                onChange={e => setForm(f => ({ ...f, publicSiteUrl: e.target.value.trim() }))}
                placeholder="https://booking.example.com"
                title="訂位網站正式網址（LINE 通知管理按鈕用）"
              />
            </Field>
          </FieldGroup>

          {/* 安裝檢查表：逐項顯示必填/建議欄位是否已填，快速定位缺漏 */}
          <div className="rounded-xl border border-chicken-brown/10 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-chicken-brown">安裝檢查表</h3>
            <ul className="space-y-1.5">
              {lineReadiness.checks.map(item => (
                <li key={item.label} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={item.ok ? 'text-chicken-green' : 'text-chicken-red'}>
                    {item.ok ? '✓' : '✕'}
                  </span>
                  <span className={item.ok ? 'text-chicken-brown/70' : 'font-bold text-chicken-brown'}>
                    {item.label}
                    {!item.ok && <span className="ml-1 text-xs text-chicken-red">需補齊或修正</span>}
                    {!item.ok && <span className="ml-1 text-xs font-normal text-chicken-brown/45">· {item.message}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-5 text-chicken-brown/45">
              Token / Secret 由後端管理，不在此顯示。欄位檢查不代表登入或送達成功；仍需確認 LINE Console 回呼網址與官方帳號連動，並以本人帳號實測。
            </p>
          </div>

          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            目前預設會先開啟網站中轉頁，避免未公開或設定錯誤的 LIFF 造成 404。若已確認 LIFF Channel、Endpoint URL、Scope 與官方帳號連動都正常，再勾選「使用 LIFF 自動綁定」。
            LINE API Token 仍必須放在後端或 Cloud Functions，不能放前端。
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={handleValidateLine} className="btn-secondary min-h-[44px] whitespace-nowrap">
              驗證設定
            </button>
            {form.lineOfficialUrl && (
              <a href={form.lineOfficialUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-[44px] flex items-center whitespace-nowrap">
                測試開啟
              </a>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection sectionKey="contact" title="客人聯絡入口" description="設定確認頁與訂位管理中心的一鍵撥電話、導航資訊。">
        <div className="space-y-3">
          <Input
            label="店名"
            value={form.storeName || ''}
            onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))}
            placeholder="雞王涮涮鍋"
          />
          <Input
            label="店家電話"
            value={form.storePhone || ''}
            onChange={e => setForm(f => ({ ...f, storePhone: e.target.value.trim() }))}
            placeholder="例：04-1234-5678"
          />
          <Input
            label="店家地址"
            value={form.storeAddress || ''}
            onChange={e => setForm(f => ({ ...f, storeAddress: e.target.value }))}
            placeholder="例：台中市..."
          />
          <Input
            label="Google Maps 導航連結"
            type="url"
            value={form.storeMapUrl || ''}
            onChange={e => setForm(f => ({ ...f, storeMapUrl: e.target.value.trim() }))}
            placeholder="https://maps.google.com/..."
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="緯度 latitude"
              value={form.storeLatitude || ''}
              onChange={e => setForm(f => ({ ...f, storeLatitude: e.target.value.trim() }))}
              placeholder="24.xxxxxx"
            />
            <Input
              label="經度 longitude"
              value={form.storeLongitude || ''}
              onChange={e => setForm(f => ({ ...f, storeLongitude: e.target.value.trim() }))}
              placeholder="120.xxxxxx"
            />
          </div>
        </div>
      </SettingsSection>

      {/* Telegram 通知 + 備份 */}
      <SettingsSection sectionKey="telegram" title="通知與備份" description="Telegram 事件推送與備份狀態。">
        <TelegramSettings embedded />
      </SettingsSection>

      <SettingsSection sectionKey="firestore" title="Firestore 資料同步" description="正式跨裝置資料來源；可手動上傳本機資料或重新拉取雲端資料。" badge={usingFirebase ? undefined : '本機模式'} defaultOpen>
        <div className="space-y-3">
          {!usingFirebase && (
            <div className="rounded-xl border border-chicken-brown/15 bg-chicken-brown/5 px-4 py-3 text-xs font-bold leading-5 text-chicken-brown/60">
              目前未設定 Firebase（本機開發模式），雲端同步僅正式環境可用。設定 VITE_FIREBASE_* 並重新部署後才能上傳／拉取。
            </div>
          )}
          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            狀態：<span className="font-bold text-chicken-brown">{cloudStatus?.state || 'idle'}</span>
            {cloudStatus?.lastSyncAt && <span> · 最近同步 {new Date(cloudStatus.lastSyncAt).toLocaleString('zh-TW')}</span>}
            {cloudStatus?.error && <div className="mt-1 font-bold text-chicken-red">錯誤：{cloudStatus.error}</div>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={cloudBusy || !usingFirebase || readOnlyRole} onClick={() => handleCloudSync('push')} className="w-full min-h-[44px]">
              {cloudBusy ? '同步中...' : '上傳本機資料到 Firestore'}
            </Button>
            <button disabled={cloudBusy || !usingFirebase} onClick={() => handleCloudSync('pull')} className="btn-secondary min-h-[44px] disabled:opacity-40">
              從 Firestore 重新整理
            </button>
          </div>
          <p className="text-xs font-bold leading-5 text-chicken-brown/55">
            第一次正式上線前，請在主要後台裝置按一次「上傳本機資料到 Firestore」，之後客人查詢與其他裝置會讀取雲端資料。
          </p>
        </div>
      </SettingsSection>

      {/* 桌位佈局編輯（拖拉位置、新增/刪除桌、改容量）*/}
      {can('table.config') && (
        <SettingsSection sectionKey="layout" title="桌位佈局" description="拖拉桌位、調整容量與樓層。">
          <p className="text-xs text-chicken-brown/60 mb-3">
            打開全螢幕編輯器：拖拉移動桌位、調整容量與樓層、新增或刪除桌位。
            修改完按「儲存變更」才會生效。
          </p>
          <Button onClick={() => setShowLayoutEditor(true)} className="w-full">
            開啟桌位佈局編輯器
          </Button>
        </SettingsSection>
      )}

      {/* 桌位啟用/停用 — 簡單方格切換 */}
      {can('table.config') && (
        <SettingsSection sectionKey="table-enable" title="桌位啟用" description="停用桌位不會出現在現場營運頁，也不計入可訂位人數。">
          <p className="text-xs text-chicken-brown/60 mb-3">點擊桌號可切換啟用 / 停用。停用的桌位不會出現在現場營運頁，也不計入可訂位人數。</p>
          <TableGrid />
        </SettingsSection>
      )}

      <SettingsSection sectionKey="noshow" title="No-show 查詢" description="用電話快速查詢過往未到紀錄。">
        <div className="flex gap-2">
          <Input placeholder="輸入電話號碼" value={searchPhone} onChange={e => setSearchPhone(e.target.value)} inputMode="numeric" />
          <Button onClick={handleSearch} variant="secondary" className="whitespace-nowrap">查詢</Button>
        </div>
        {searchResult !== null && (
          <div className="mt-3">
            {searchResult.length === 0 ? (
              <p className="text-sm text-chicken-brown/60">查無 no-show 記錄</p>
            ) : (
              <div className="space-y-2">
                {searchResult.map(r => (
                  <div key={r.phone} className="bg-chicken-red/5 border border-chicken-red/20 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-chicken-brown">{r.phone}</span>
                      <div className="flex items-center gap-2">
                        <span className="badge bg-chicken-red text-white">{r.count} 次</span>
                        {onOpenCustomer && (
                          <button
                            type="button"
                            onClick={() => onOpenCustomer(r.phone)}
                            className="rounded-lg border border-chicken-brown/20 bg-white px-2.5 py-1 text-xs font-bold text-chicken-brown hover:bg-chicken-brown/5"
                          >
                            顧客檔 →
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-chicken-brown/60 mt-1">{r.dates.map(d => d.date).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection sectionKey="export" title="資料匯出" description="自選日期區間、散客/團體、來源、場次、狀態、旅行社/導遊後下載 CSV。">
        <ExportCenter />
      </SettingsSection>

      {can('staff.manage') && (
        <SettingsSection sectionKey="staff" title="管理員帳號" description="新增同仁的 Google 帳號即可登入後台；毋須重新部署。">
          <StaffAdminSection />
        </SettingsSection>
      )}

      <SettingsSection sectionKey="account" title="帳號" description="目前登入者與角色資訊。">
        <div className="text-sm text-chicken-brown/70 mb-3">
          <div>已登入：<span className="font-mono font-bold text-chicken-brown">{user?.email}</span></div>
          <div className="text-xs text-chicken-brown/60 mt-1">角色：<span className="font-bold">{user?.roleLabel || '—'}</span></div>
        </div>
        <Button onClick={async () => { if (await confirm('確定登出？', { title: '登出', confirmLabel: '登出' })) signOut() }} variant="secondary" className="w-full">登出</Button>
      </SettingsSection>

      <p className="text-center text-xs text-chicken-brown/40 pt-4">
        雞王涮涮鍋訂位系統 v0.4 · Firestore 同步模式
      </p>
      </div>{/* 內容欄 */}
      </div>{/* flex gap-4 */}

      {/* 桌位佈局編輯器 modal：掛在分類條件外，切換分類/開關皆不受影響 */}
      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />
    </ReadOnlyContext.Provider>
    </CategoryContext.Provider>
  )
}

function readBannerFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error(`${file.name} 超過 2MB`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({
      id: crypto.randomUUID?.() || `${Date.now()}-${file.name}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      subtitle: '雞王涮涮鍋',
      image: reader.result,
    })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 首頁廣告單張卡片：Reorder.Item（右上握把拖曳排序）+ 圖上疊標題副標（前台預覽）+ 非 16:9 提示。
function HeroBannerItem({ banner, index, total, setForm, removeBanner }) {
  const controls = useDragControls()
  const [ratioWarn, setRatioWarn] = useState(false)
  const patch = (p) => setForm(f => ({ ...f, heroBanners: (f.heroBanners || []).map(b => b.id === banner.id ? { ...b, ...p } : b) }))
  return (
    <Reorder.Item value={banner} dragListener={false} dragControls={controls} className="overflow-hidden rounded-xl border border-chicken-brown/10 bg-white">
      <div className="relative aspect-[16/9] bg-chicken-cream">
        <img
          src={banner.image}
          alt={banner.title || `首頁廣告 ${index + 1}`}
          className="h-full w-full object-cover"
          onLoad={e => setRatioWarn(Math.abs((e.target.naturalWidth / e.target.naturalHeight) - 16 / 9) > 0.3)}
        />
        {/* 前台預覽：標題/副標疊在圖上（近似客人首頁 hero 呈現） */}
        {(banner.title || banner.subtitle) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3">
            {banner.title && <div className="text-sm font-bold text-white drop-shadow">{banner.title}</div>}
            {banner.subtitle && <div className="text-xs text-white/90 drop-shadow">{banner.subtitle}</div>}
          </div>
        )}
        {ratioWarn && (
          <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-[11px] font-bold text-white">非 16:9，首頁可能被裁切</span>
        )}
        <button
          type="button"
          onPointerDown={e => controls.start(e)}
          className="absolute right-2 top-2 cursor-grab touch-none rounded bg-black/40 px-2 py-1 text-xs font-bold text-white active:cursor-grabbing"
          title="拖曳排序"
          aria-label="拖曳排序"
        >⠿</button>
      </div>
      <div className="space-y-2 p-3">
        <Input label="標題" value={banner.title || ''} onChange={e => patch({ title: e.target.value })} placeholder="例：母親節限定套餐" />
        <Input label="副標" value={banner.subtitle || ''} onChange={e => patch({ subtitle: e.target.value })} placeholder="例：限量供應，建議提前訂位" />
        <div className="flex items-center justify-between text-xs text-chicken-brown/50">
          <span>第 {index + 1} / {total} 張</span>
          <button type="button" onClick={() => removeBanner(banner.id)} className="btn-danger !px-3 !py-1.5 text-xs">刪除</button>
        </div>
      </div>
    </Reorder.Item>
  )
}

// 場次（seating）編輯器：增刪場次、改名稱/起訖時間。寫回 form.seatings。
function SeatingsEditor({ form, setForm }) {
  const seatings = Array.isArray(form.seatings) ? form.seatings : []
  const patch = (id, p) => setForm(f => ({ ...f, seatings: (f.seatings || []).map(s => s.id === id ? { ...s, ...p } : s) }))
  const add = () => setForm(f => {
    const list = f.seatings || []
    const id = `s${Date.now().toString(36)}${list.length}`
    return { ...f, seatings: [...list, { id, name: `場次${list.length + 1}`, start: f.openTime || '11:00', end: f.closeTime || '19:00' }] }
  })
  const remove = (id) => setForm(f => ({ ...f, seatings: (f.seatings || []).filter(s => s.id !== id) }))

  return (
    <div className="space-y-2">
      {seatings.length === 0 && (
        <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">
          尚未設定場次。新增後，排位規劃地圖即可依場次（如「午餐第一批」）切換檢視。
        </div>
      )}
      {seatings.map(s => (
        <div key={s.id} className="flex items-end gap-2 flex-wrap rounded-xl border border-chicken-brown/10 bg-white p-2">
          <Input label="名稱" value={s.name} onChange={e => patch(s.id, { name: e.target.value })} className="flex-1 min-w-[120px]" />
          <Input label="開始" type="time" value={s.start} onChange={e => patch(s.id, { start: e.target.value })} className="w-40" />
          <Input label="結束" type="time" value={s.end} onChange={e => patch(s.id, { end: e.target.value })} className="w-40" />
          <button onClick={() => remove(s.id)} className="min-h-[44px] px-3 text-sm font-bold text-chicken-red border-2 border-chicken-red/30 rounded-xl">刪除</button>
        </div>
      ))}
      <button onClick={add} className="text-sm font-bold text-chicken-red">＋ 新增場次</button>
    </div>
  )
}

// 關閉時段編輯器：選日期 → 整天公休 / 關閉整場次 / 關閉個別時段。寫回 form.closures。
// 視覺原則：「已關閉」一律實心紅底白字＋明確文字，「開放中」白底綠點；不靠刪除線或小勾選框辨識。
function ClosuresEditor({ form, setForm, bookings, unsaved = false }) {
  const [date, setDate] = useState(todayStr())
  const [monthAnchor, setMonthAnchor] = useState(() => todayStr().slice(0, 7)) // 'YYYY-MM'
  const closures = form.closures || { closedDates: [], closedSlots: {}, closedSeatings: {} }
  const seatings = Array.isArray(form.seatings) ? form.seatings : []
  const dayClosed = (closures.closedDates || []).includes(date)
  const closedSeatingIds = closures.closedSeatings?.[date] || []
  const closedSlotList = closures.closedSlots?.[date] || []

  // 受影響的未來已確認訂位（僅此日期），供關閉前提醒。
  const affected = (bookings || []).filter(b => b.date === date && b.status === 'confirmed')

  const setClosures = (next) => setForm(f => ({ ...f, closures: next }))
  const toggleArr = (arr = [], v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
  const setDateMap = (mapKey, key, arr) => {
    const m = { ...(closures[mapKey] || {}) }
    if (arr.length) m[key] = arr; else delete m[key]
    setClosures({ ...closures, [mapKey]: m })
  }
  const toggleDay = () => setClosures({ ...closures, closedDates: toggleArr(closures.closedDates, date) })
  const toggleSeating = (id) => setDateMap('closedSeatings', date, toggleArr(closedSeatingIds, id))
  const toggleSlot = (t) => setDateMap('closedSlots', date, toggleArr(closedSlotList, t))
  // 一鍵恢復此日全部開放（整天/場次/時段皆清除）
  const reopenDay = () => {
    const cs = { ...(closures.closedSeatings || {}) }; delete cs[date]
    const csl = { ...(closures.closedSlots || {}) }; delete csl[date]
    setClosures({ ...closures, closedDates: (closures.closedDates || []).filter(d => d !== date), closedSeatings: cs, closedSlots: csl })
  }

  // 不屬於任何場次的時段（午晚餐之間等），歸到「其他時段」
  const orphanSlots = generateTimeSlots(form.openTime, form.closeTime, form.slotInterval)
    .filter(t => !seatingForSlot(form, t))

  // === 月曆視覺 ===
  const today = todayStr()
  const closedDatesSet = new Set(closures.closedDates || [])
  const dayStatus = (ds) => {
    if (closedDatesSet.has(ds)) return 'full'
    if ((closures.closedSeatings?.[ds]?.length) || (closures.closedSlots?.[ds]?.length)) return 'partial'
    return null
  }
  const [yy, mm] = monthAnchor.split('-').map(Number)
  const daysInMonth = new Date(yy, mm, 0).getDate()
  const startDow = new Date(yy, mm - 1, 1).getDay()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  const shiftMonth = (delta) => {
    const nm = new Date(yy, mm - 1 + delta, 1)
    setMonthAnchor(`${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}`)
  }
  const pickDate = (ds) => { setDate(ds); setMonthAnchor(ds.slice(0, 7)) }

  // 常用規則複製：把此日的關閉設定（整天/場次/時段）疊加到下週同一天（附加、不清除目標既有關閉）。
  const copyToNextWeek = () => {
    const nd = new Date(`${date}T00:00:00`); nd.setDate(nd.getDate() + 7)
    const target = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`
    const closedDates = dayClosed ? [...new Set([...(closures.closedDates || []), target])] : (closures.closedDates || [])
    const cs = { ...(closures.closedSeatings || {}) }; if (closedSeatingIds.length) cs[target] = [...new Set([...(cs[target] || []), ...closedSeatingIds])]
    const csl = { ...(closures.closedSlots || {}) }; if (closedSlotList.length) csl[target] = [...new Set([...(csl[target] || []), ...closedSlotList])]
    setClosures({ ...closures, closedDates, closedSeatings: cs, closedSlots: csl })
    pickDate(target)
  }

  // 此日關閉摘要（人看得懂的文字），用於日期標頭與近期清單。
  const describeDay = (ds) => {
    if (closedDatesSet.has(ds)) return '整天公休'
    const parts = []
    const sIds = closures.closedSeatings?.[ds] || []
    sIds.forEach(id => parts.push(seatings.find(s => s.id === id)?.name || '已刪除的場次'))
    const slotList = [...(closures.closedSlots?.[ds] || [])].sort()
    if (slotList.length) parts.push(slotList.join('、'))
    return parts.join('、')
  }
  const hasAnyClosure = dayClosed || closedSeatingIds.length > 0 || closedSlotList.length > 0
  const dayLabel = (ds) => {
    const d = new Date(`${ds}T00:00:00`)
    return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`
  }

  // 近期（今天起）所有有關閉的日期：不用逐日點開就能看到哪些時段已關。
  const upcoming = [...new Set([
    ...(closures.closedDates || []),
    ...Object.keys(closures.closedSeatings || {}).filter(k => (closures.closedSeatings[k] || []).length),
    ...Object.keys(closures.closedSlots || {}).filter(k => (closures.closedSlots[k] || []).length),
  ])].filter(ds => ds >= today).sort()

  const renderSlot = (t) => {
    const on = closedSlotList.includes(t)
    return (
      <button
        key={t}
        type="button"
        onClick={() => toggleSlot(t)}
        aria-pressed={on}
        title={on ? `${t} 已關閉，點一下重新開放` : `${t} 開放中，點一下關閉`}
        className={`tap flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 px-2 py-1 font-bold transition-colors ${
          on
            ? 'border-chicken-red bg-chicken-red text-white shadow-sm'
            : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'
        }`}
      >
        <span className="text-sm leading-tight">{t}</span>
        <span className={`mt-0.5 flex items-center gap-1 text-[11px] leading-tight ${on ? 'text-white' : 'text-emerald-700'}`}>
          {on ? <>⛔ 已關閉</> : <><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />開放</>}
        </span>
      </button>
    )
  }
  const slotGrid = 'grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2'

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/70">
        <b className="text-chicken-brown">操作方式：</b>① 在月曆點日期 → ② 點「關閉整場次」或直接點時段（變紅＝已關閉，再點一次恢復開放）→
        ③ 按頁面下方<b className="text-chicken-red">「儲存全部變更」</b>才會生效。只停止新訂位，既有訂位不受影響。
      </div>

      {unsaved && (
        <div className="flex items-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800">
          <span aria-hidden>⚠️</span>
          關閉時段已修改但尚未儲存，請按頁面下方「儲存全部變更」。
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:items-start">
        {/* 左：月曆 + 近期關閉清單 */}
        <div className="space-y-3">
          <div className="rounded-xl border border-chicken-brown/10 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="上個月" className="min-h-[40px] rounded-lg px-3 text-lg font-bold text-chicken-brown/60 hover:bg-chicken-brown/5">‹</button>
              <span className="text-sm font-bold text-chicken-brown">{yy} 年 {mm} 月</span>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="下個月" className="min-h-[40px] rounded-lg px-3 text-lg font-bold text-chicken-brown/60 hover:bg-chicken-brown/5">›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-chicken-brown/40">
              {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w}>{w}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((ds, i) => {
                if (!ds) return <div key={`e${i}`} />
                const st = dayStatus(ds)
                const past = ds < today
                return (
                  <button
                    key={ds}
                    type="button"
                    disabled={past}
                    onClick={() => setDate(ds)}
                    aria-pressed={date === ds}
                    className={`relative flex h-11 flex-col items-center justify-center rounded-lg text-xs font-bold transition disabled:opacity-40 ${
                      date === ds ? 'ring-2 ring-chicken-brown ring-offset-1 ' : ''
                    }${st === 'full' ? 'bg-chicken-red text-white' : st === 'partial' ? 'bg-amber-400 text-white' : 'text-chicken-brown hover:bg-chicken-brown/5'}`}
                  >
                    <span>{Number(ds.slice(8))}</span>
                    {st && <span className="text-[9px] font-bold leading-none">{st === 'full' ? '休' : '部分'}</span>}
                    {ds === today && !st && <span className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-chicken-brown/60" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-bold text-chicken-brown/60">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-chicken-red align-middle" />整天公休</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-amber-400 align-middle" />部分關閉</span>
              <span><span className="mr-1 inline-block h-1 w-1 rounded-full bg-chicken-brown/60 align-middle" />今天</span>
            </div>
          </div>

          <div className="rounded-xl border border-chicken-brown/10 bg-white p-3">
            <div className="mb-2 text-sm font-bold text-chicken-brown">近期已關閉（{upcoming.length}）</div>
            {upcoming.length === 0 ? (
              <p className="text-xs text-chicken-brown/50">目前沒有任何關閉的日期或時段。</p>
            ) : (
              <ul className="max-h-60 space-y-1.5 overflow-y-auto">
                {upcoming.map(ds => (
                  <li key={ds}>
                    <button
                      type="button"
                      onClick={() => pickDate(ds)}
                      className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
                        date === ds ? 'border-chicken-brown/40 bg-chicken-brown/5' : 'border-chicken-brown/10 hover:bg-chicken-brown/5'
                      }`}
                    >
                      <span className="shrink-0 font-bold text-chicken-brown">{dayLabel(ds)}</span>
                      <span className={`font-bold ${closedDatesSet.has(ds) ? 'text-chicken-red' : 'text-amber-700'}`}>{describeDay(ds)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 右：選定日期的開關 */}
        <div className="space-y-3">
          <div className={`rounded-xl border-2 p-3 ${dayClosed ? 'border-chicken-red bg-red-50' : hasAnyClosure ? 'border-amber-400 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-base font-black text-chicken-brown">{dayLabel(date)}</div>
                <div className={`mt-0.5 text-sm font-bold ${dayClosed ? 'text-chicken-red' : hasAnyClosure ? 'text-amber-800' : 'text-emerald-700'}`}>
                  {dayClosed ? '⛔ 整天公休' : hasAnyClosure ? `⚠️ 部分關閉：${describeDay(date)}` : '✓ 全天開放訂位'}
                </div>
              </div>
              <input type="date" value={date} min={todayStr()} onChange={e => e.target.value && pickDate(e.target.value)}
                aria-label="選擇日期"
                className="min-h-[44px] rounded-xl border border-chicken-brown/15 bg-white px-3 text-sm font-bold text-chicken-brown" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleDay}
                aria-pressed={dayClosed}
                className={`tap min-h-[44px] rounded-xl border-2 px-4 text-sm font-bold ${
                  dayClosed ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-red/40 bg-white text-chicken-red hover:bg-red-50'
                }`}
              >
                {dayClosed ? '⛔ 整天公休中 · 點此恢復營業' : '設為整天公休'}
              </button>
              {hasAnyClosure && !dayClosed && (
                <button type="button" onClick={reopenDay} className="btn-secondary min-h-[44px] whitespace-nowrap text-sm">
                  此日全部恢復開放
                </button>
              )}
              {hasAnyClosure && (
                <button type="button" onClick={copyToNextWeek} className="btn-secondary min-h-[44px] whitespace-nowrap text-sm">
                  複製到下週同一天
                </button>
              )}
            </div>
          </div>

          {affected.length > 0 && (
            <details className="rounded-xl border border-chicken-red/20 bg-chicken-red/5 px-3 py-2 text-xs leading-5 text-chicken-brown/70">
              <summary className="cursor-pointer list-none font-bold">
                此日期已有 <span className="text-chicken-red">{affected.length}</span> 筆已確認訂位（點擊展開名單）
              </summary>
              <ul className="mt-2 space-y-1">
                {affected.map(b => (
                  <li key={b.id} className="flex flex-wrap justify-between gap-x-2 border-t border-chicken-red/10 pt-1">
                    <span className="font-bold text-chicken-brown">{b.timeSlot} · {b.name}</span>
                    <span className="font-mono text-chicken-brown/60">{b.phone} · {b.guests} 位</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-bold text-chicken-brown/60">下一步：關閉只停「新訂位」、<b>不會自動取消</b>上列既有訂位；請逐一以電話 / LINE 通知客人改期或取消。</p>
            </details>
          )}

          {dayClosed ? (
            <div className="rounded-xl border-2 border-dashed border-chicken-red/40 bg-white px-4 py-6 text-center text-sm font-bold text-chicken-red">
              本日已設為整天公休，所有場次與時段皆停止新訂位。
            </div>
          ) : (
            <>
              {seatings.map(s => {
                const seatingClosed = closedSeatingIds.includes(s.id)
                const slots = slotsInSeating(form, s)
                const closedInSeating = slots.filter(t => closedSlotList.includes(t)).length
                return (
                  <div key={s.id} className={`rounded-xl border-2 p-3 ${seatingClosed ? 'border-chicken-red bg-red-50' : closedInSeating ? 'border-amber-300 bg-white' : 'border-chicken-brown/10 bg-white'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-chicken-brown">{s.name}</span>
                        <span className="ml-1.5 text-xs text-chicken-brown/50">{s.start}–{s.end}</span>
                        <div className={`mt-0.5 text-xs font-bold ${seatingClosed ? 'text-chicken-red' : closedInSeating ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {seatingClosed ? '⛔ 整場次已關閉' : closedInSeating ? `已關閉 ${closedInSeating} / ${slots.length} 個時段` : '全部開放'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSeating(s.id)}
                        aria-pressed={seatingClosed}
                        className={`tap min-h-[44px] rounded-xl border-2 px-4 text-sm font-bold ${
                          seatingClosed ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-red/40 bg-white text-chicken-red hover:bg-red-50'
                        }`}
                      >
                        {seatingClosed ? '已關閉 · 點此恢復' : '關閉整場次'}
                      </button>
                    </div>
                    {!seatingClosed && slots.length > 0 && (
                      <div className={`mt-3 ${slotGrid}`}>
                        {slots.map(renderSlot)}
                      </div>
                    )}
                    {seatingClosed && <div className="mt-2 text-xs font-bold text-chicken-red/80">停止新訂位的時段：{slots.join('、') || '—'}</div>}
                  </div>
                )
              })}
              {orphanSlots.length > 0 && (
                <div className="rounded-xl border-2 border-chicken-brown/10 bg-white p-3">
                  <div className="mb-3 text-sm font-bold text-chicken-brown">其他時段（不屬任何場次）</div>
                  <div className={slotGrid}>
                    {orphanSlots.map(renderSlot)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// C11：LINE 端點分組區塊（基本 / LIFF / 後端端點）。collapsible → 進階群組預設收合。
function FieldGroup({ title, hint, children, collapsible = false }) {
  if (collapsible) {
    return (
      <details className="group rounded-xl border border-chicken-brown/10 bg-white p-3">
        <summary className="flex cursor-pointer list-none items-baseline gap-2">
          <h3 className="text-sm font-bold text-chicken-brown">{title}</h3>
          {hint && <span className="text-xs leading-5 text-chicken-brown/50">{hint}</span>}
          <span className="ml-auto text-xs font-bold text-chicken-brown/40 group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-2 space-y-3">{children}</div>
      </details>
    )
  }
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-white p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-bold text-chicken-brown">{title}</h3>
        {hint && <span className="text-xs leading-5 text-chicken-brown/50">{hint}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// 單一欄位 + 小字說明
function Field({ hint, children }) {
  return (
    <div>
      {children}
      {hint && <p className="mt-1 text-xs leading-5 text-chicken-brown/50">{hint}</p>}
    </div>
  )
}

// C14：數值設定旁的「預設值對比」灰 badge（僅在目前值不同於預設時顯示）
function DefaultBadge({ current, fallback, unit = '' }) {
  if (current === fallback || fallback == null) return null
  return (
    <span
      className="badge bg-chicken-brown/10 text-chicken-brown/60"
      title={`系統預設為 ${fallback}${unit}，目前已自訂為 ${current}${unit}`}
    >
      預設 {fallback}{unit}
    </span>
  )
}

function SettingsSection({ title, description, children, defaultOpen = false, danger = false, sectionKey, summary, badge }) {
  // 依目前分類自我隱藏：不屬當前分類則不渲染（隱藏時 unmount，但 form 在父層 → 編輯不遺失）。
  const activeSections = useContext(CategoryContext)
  const readOnlyRole = useContext(ReadOnlyContext)
  if (sectionKey && !activeSections.includes(sectionKey)) return null
  const locked = readOnlyRole && !READONLY_EXEMPT_SECTIONS.includes(sectionKey)
  return (
    <details className={`card group ${danger ? 'border-red-200 !border-2 bg-red-50/30' : ''}`} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`font-bold ${danger ? 'text-red-700' : 'text-chicken-brown'}`}>{title}</h2>
            {badge && <span className="badge bg-chicken-brown/10 text-chicken-brown/70">{badge}</span>}
          </div>
          {description && <p className="mt-0.5 text-xs text-chicken-brown/55">{description}</p>}
          {/* 收合時顯示現況摘要，展開後隱藏（避免與內容重複） */}
          {summary && <p className="mt-1 text-xs font-bold text-chicken-brown/70 group-open:hidden">{summary}</p>}
        </div>
        <span className="rounded-full bg-chicken-brown/5 px-2 py-1 text-xs font-bold text-chicken-brown/45 group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-4">
        {locked ? <fieldset disabled className="m-0 min-w-0 border-0 p-0">{children}</fieldset> : children}
      </div>
    </details>
  )
}
