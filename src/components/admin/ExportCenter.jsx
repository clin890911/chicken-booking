import { useMemo, useState } from 'react'
import { Input, Button, Select } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast, useConfirm } from '../ui/Toast'
import { todayStr } from '../../utils/timeSlots'
import { adminExportLog } from '../../services/cloudDataService'
import {
  filterBookings, filterGroups, buildBookingsCSV, buildGroupsCSV,
  BOOKING_SOURCE_LABELS, BOOKING_STATUS_LABELS, GROUP_STATUS_LABELS,
  BOOKING_CSV_HEADERS, GROUP_CSV_HEADERS, PII_HEADERS,
} from '../../utils/exportData'

// 匯出中心：自選資料類型（散客/團體）、日期區間、來源、場次、狀態、旅行社/導遊後下載 CSV。
// 資料來源 = useBooking() 的記憶體資料集（與各分頁畫面同一份，登入裝置每 5 秒雲端同步）。

function pad2(n) { return String(n).padStart(2, '0') }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

function presetRange(kind) {
  const now = new Date()
  const today = todayStr()
  if (kind === 'today') return { dateFrom: today, dateTo: today }
  if (kind === 'week') {
    // 本週一到週日（台灣習慣週一開週）
    const dow = (now.getDay() + 6) % 7
    const mon = new Date(now); mon.setDate(now.getDate() - dow)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { dateFrom: fmtDate(mon), dateTo: fmtDate(sun) }
  }
  if (kind === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { dateFrom: fmtDate(first), dateTo: fmtDate(last) }
  }
  return { dateFrom: '', dateTo: '' } // 不限
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const PRESETS = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '本週' },
  { key: 'month', label: '本月' },
  { key: 'all', label: '不限' },
]

export default function ExportCenter() {
  const { bookings, groupReservations, agencies, guides, settings } = useBooking()
  const { usingFirebase } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [logs, setLogs] = useState(null) // 最近匯出紀錄（懶載入）
  const [logBusy, setLogBusy] = useState(false)
  const [type, setType] = useState('bookings')
  const [range, setRange] = useState(() => presetRange('month'))
  const [source, setSource] = useState('all')
  const [bStatus, setBStatus] = useState('all')
  const [gStatus, setGStatus] = useState('all')
  const [seatingId, setSeatingId] = useState('all')
  const [agencyId, setAgencyId] = useState('all')
  const [guideId, setGuideId] = useState('all')

  const seatingOptions = useMemo(() => ([
    { value: 'all', label: '全部場次' },
    ...(settings?.seatings || []).map(s => ({ value: s.id, label: `${s.name}（${s.start}–${s.end}）` })),
  ]), [settings])

  const agencyOptions = useMemo(() => ([
    { value: 'all', label: '全部旅行社' },
    ...(agencies || []).map(a => ({ value: a.id, label: a.name || a.id })),
  ]), [agencies])

  // 導遊選項依旅行社連動（關聯一律用 id）
  const guideOptions = useMemo(() => {
    const pool = (guides || []).filter(g => agencyId === 'all' || g.agencyId === agencyId)
    return [{ value: 'all', label: '全部導遊' }, ...pool.map(g => ({ value: g.id, label: g.name || g.id }))]
  }, [guides, agencyId])

  const filteredBookings = useMemo(() => filterBookings(bookings, {
    dateFrom: range.dateFrom, dateTo: range.dateTo,
    source, status: bStatus, seatingId, settings,
  }), [bookings, range, source, bStatus, seatingId, settings])

  const filteredGroups = useMemo(() => filterGroups(groupReservations, {
    dateFrom: range.dateFrom, dateTo: range.dateTo,
    status: gStatus, agencyId, guideId, seatingId, settings,
  }), [groupReservations, range, gStatus, agencyId, guideId, seatingId, settings])

  const count = type === 'bookings' ? filteredBookings.length : filteredGroups.length
  const groupGuestTotal = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + (Number(g.counts?.total) || 0), 0),
    [filteredGroups]
  )

  // 將輸出的欄位（依資料類型）；含個資者於預覽中標示。
  const fields = type === 'bookings' ? BOOKING_CSV_HEADERS : GROUP_CSV_HEADERS

  const handleExport = async () => {
    const list = type === 'bookings' ? filteredBookings : filteredGroups
    const label = type === 'bookings' ? '散客訂位' : '團體預排'
    if (!list.length) { toast.error(`目前條件沒有可匯出的${label}`); return }
    // 匯出前確認 + 個資下載提示（CSV 含姓名／電話等個人資料）
    const ok = await confirm(
      `即將下載 ${list.length} 筆${label}，內容包含姓名、電話等個人資料。\n請妥善保管、勿外流或上傳至不安全的服務。確定匯出？`,
      { title: '匯出個資提醒', confirmLabel: '確定匯出' }
    )
    if (!ok) return
    const rangeTag = range.dateFrom || range.dateTo
      ? `${range.dateFrom || '起'}_${range.dateTo || '迄'}`
      : '全部期間'
    if (type === 'bookings') {
      downloadCSV(`散客訂位_${rangeTag}.csv`, buildBookingsCSV(filteredBookings, settings))
      toast.success(`已匯出 ${filteredBookings.length} 筆散客訂位`)
    } else {
      downloadCSV(`團體預排_${rangeTag}.csv`, buildGroupsCSV(filteredGroups, settings))
      toast.success(`已匯出 ${filteredGroups.length} 張團單`)
    }
    // 稽核留痕：fire-and-forget，後端未部署或失敗都不影響已完成的下載。
    if (usingFirebase) {
      const filters = type === 'bookings'
        ? `來源=${source} 狀態=${bStatus} 場次=${seatingId}`
        : `狀態=${gStatus} 旅行社=${agencyId} 導遊=${guideId} 場次=${seatingId}`
      adminExportLog({ action: 'record', type, count: list.length, dateFrom: range.dateFrom, dateTo: range.dateTo, filters })
        .then(() => { if (logs !== null) setLogs(null) }) // 已展開過的紀錄失效，下次展開重抓
        .catch(() => {})
    }
  }

  const loadLogs = async () => {
    setLogBusy(true)
    try {
      const res = await adminExportLog({ action: 'list' })
      setLogs(res.logs || [])
    } catch (err) {
      toast.error(err.message || '讀取匯出紀錄失敗')
      setLogs([])
    } finally {
      setLogBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 資料類型 */}
      <div>
        <span className="label">資料類型</span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[{ key: 'bookings', label: '🧑 散客訂位' }, { key: 'groups', label: '🚌 團體預排（含導遊）' }].map(t => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition
                ${type === t.key
                  ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                  : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 日期區間 */}
      <div>
        <div className="flex items-center justify-between">
          <span className="label !mb-0">日期區間</span>
          <div className="flex gap-1">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => setRange(presetRange(p.key))}
                className="rounded-full bg-chicken-brown/10 px-2.5 py-1 text-xs font-bold text-chicken-brown/70 hover:bg-chicken-brown/15">
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Input label="從" type="date" value={range.dateFrom} onChange={e => setRange(r => ({ ...r, dateFrom: e.target.value }))} />
          <Input label="到" type="date" value={range.dateTo} onChange={e => setRange(r => ({ ...r, dateTo: e.target.value }))} />
        </div>
      </div>

      {/* 條件 */}
      <div className="grid grid-cols-2 gap-3">
        <Select label="場次" value={seatingId} onChange={e => setSeatingId(e.target.value)} options={seatingOptions} />
        {type === 'bookings' ? (
          <>
            <Select label="來源" value={source} onChange={e => setSource(e.target.value)}
              options={[{ value: 'all', label: '全部來源' }, ...Object.entries(BOOKING_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]} />
            <Select label="狀態" value={bStatus} onChange={e => setBStatus(e.target.value)}
              options={[{ value: 'all', label: '全部狀態' }, ...Object.entries(BOOKING_STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
          </>
        ) : (
          <>
            <Select label="狀態" value={gStatus} onChange={e => setGStatus(e.target.value)}
              options={[{ value: 'all', label: '全部狀態' }, ...Object.entries(GROUP_STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
            <Select label="旅行社" value={agencyId} onChange={e => { setAgencyId(e.target.value); setGuideId('all') }} options={agencyOptions} />
            <Select label="導遊" value={guideId} onChange={e => setGuideId(e.target.value)} options={guideOptions} />
          </>
        )}
      </div>

      {/* 欄位預覽：下載前先知道會輸出哪些欄位，含個資者以紅點標示 */}
      <details className="rounded-xl border border-chicken-brown/10 bg-white">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-bold text-chicken-brown/70">
          欄位預覽（{fields.length} 欄）<span className="ml-1 text-xs font-normal text-chicken-brown/45">點擊展開</span>
        </summary>
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {fields.map(h => {
            const pii = PII_HEADERS.includes(h)
            return (
              <span key={h} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${pii ? 'bg-chicken-red/10 text-chicken-red' : 'bg-chicken-brown/8 text-chicken-brown/70'}`}>
                {pii && <span aria-hidden>●</span>}{h}
              </span>
            )
          })}
        </div>
        <p className="px-4 pb-3 text-xs text-chicken-brown/50"><span className="text-chicken-red">●</span> = 個人資料（姓名 / 電話）</p>
      </details>

      {/* 預覽 + 匯出 */}
      <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/70">
        符合條件：<span className="font-black text-chicken-brown">{count}</span>
        {type === 'bookings' ? ' 筆散客訂位' : ` 張團單（合計 ${groupGuestTotal} 人）`}
      </div>
      <Button onClick={handleExport} className="w-full min-h-[44px]">
        ⬇️ 匯出 CSV{count ? `（${count} 筆）` : ''}
      </Button>
      <p className="text-xs leading-5 text-chicken-brown/55">
        CSV 為 UTF-8（含 BOM），Excel 直接開啟不會亂碼。團體匯出一梯次一列，欄含旅行社/導遊/素食/兒童餐/輪椅等備餐資訊。
      </p>

      {/* 最近匯出紀錄（稽核）：僅正式環境；展開時懶載入 */}
      {usingFirebase && (
        <details className="rounded-xl border border-chicken-brown/10 bg-white" onToggle={e => { if (e.target.open && logs === null && !logBusy) loadLogs() }}>
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-bold text-chicken-brown/70">
            最近匯出紀錄<span className="ml-1 text-xs font-normal text-chicken-brown/45">點擊展開（最近 50 筆）</span>
          </summary>
          <div className="px-4 pb-3">
            {logBusy && logs === null ? (
              <p className="text-sm text-chicken-brown/50">載入中…</p>
            ) : !logs || logs.length === 0 ? (
              <p className="text-sm text-chicken-brown/50">尚無匯出紀錄</p>
            ) : (
              <ul className="space-y-1.5">
                {logs.map(l => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-x-2 border-t border-chicken-brown/5 pt-1.5 text-xs">
                    <span className="font-bold text-chicken-brown">
                      {l.at ? new Date(l.at).toLocaleString('zh-TW') : '—'} · {l.type === 'groups' ? '團體' : '散客'} {l.count} 筆
                    </span>
                    <span className="font-mono text-chicken-brown/55">{l.actor}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
