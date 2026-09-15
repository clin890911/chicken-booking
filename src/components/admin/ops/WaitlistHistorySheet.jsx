import { useState, useMemo } from 'react'
import { Modal, Card, EmptyState } from '../../ui'
import { useBooking } from '../../../contexts/BookingContext'
import SegmentedControl from '../../ui/SegmentedControl'
import { formatDate, todayStr } from '../../../utils/timeSlots'

// 候位歷史與統計（低頻查閱）：今日四格統計 + 今日/活躍中/歷史列表（唯讀）。
// 活躍候位的操作（入座/叫號/棄號）都在現場右側欄的候位籤，這裡只看不動。
// 2026-09：原本統計只算今天、列表「全部」卻是所有歷史且不顯示日期，店主看到統計 0、列表 4 筆以為壞了。
// 改成列表預設只看今天（與統計同範圍），以前的紀錄收進「歷史」依日期分組。
const STATUS_LABELS = {
  waiting: '等待中',
  called: '已叫號',
  seated: '已入座',
  left: '已離開',
}
const STATUS_COLOR = {
  waiting: 'bg-amber-100 text-amber-800',
  called: 'bg-amber-100 text-amber-800',
  seated: 'bg-emerald-100 text-emerald-800',
  left: 'bg-chicken-brown/5 text-chicken-brown/40',
}
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const isActive = w => w.status === 'waiting' || w.status === 'called'

function fmtTime(d) {
  const t = new Date(d)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

// takenAt 是 UTC ISO 字串，必須換成本地（台灣）日期再比對——直接 slice(0, 10) 取到的是 UTC 日，早上 8 點才換日。
export function localDateOf(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '' : formatDate(t)
}

// 'YYYY-MM-DD' → '9/14（日）'；無日期 → '日期不明'
export function dateLabel(date) {
  if (!date) return '日期不明'
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`
}

// 純函式：把候位清單拆成 今日 / 活躍中 / 歷史（今天以前，依日期新→舊分組，日期不明排最後）。各清單內取號新→舊。
export function splitWaitlist(waitlist, today) {
  const sorted = [...waitlist].sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''))
  const todayItems = []
  const byDate = new Map()
  for (const w of sorted) {
    const date = localDateOf(w.takenAt)
    if (date === today) { todayItems.push(w); continue }
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(w)
  }
  const history = [...byDate.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : b.localeCompare(a)))
    .map(([date, items]) => ({ date, items }))
  return { today: todayItems, active: sorted.filter(isActive), history }
}

function WaitRow({ w, showDate }) {
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0 flex-1 flex-wrap">
          <span className="text-base font-bold text-chicken-red">#{w.queueNumber}</span>
          <span className="text-sm font-bold truncate">{w.name}</span>
          <span className="text-xs text-chicken-brown/60">{w.partySize} 位</span>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[w.status]}`}>
          {STATUS_LABELS[w.status] || w.status}
        </span>
      </div>
      <div className="text-xs text-chicken-brown/60 mt-0.5">
        {w.phone || '—'} · 取號 {showDate && `${dateLabel(localDateOf(w.takenAt))} `}{fmtTime(w.takenAt)}
        {w.assignedTableNumber && <span className="ml-1 text-chicken-green font-bold">· 入座 {w.assignedTableNumber}</span>}
        {w.notes && <span className="italic"> · 「{w.notes}」</span>}
      </div>
    </div>
  )
}

export default function WaitlistHistorySheet({ open, onClose }) {
  const { waitlist } = useBooking()
  const [filter, setFilter] = useState('today')   // today | active | history
  const today = todayStr()

  const groups = useMemo(() => splitWaitlist(waitlist, today), [waitlist, today])

  const stats = useMemo(() => ({
    waiting: groups.today.filter(w => w.status === 'waiting').length,
    called: groups.today.filter(w => w.status === 'called').length,
    seated: groups.today.filter(w => w.status === 'seated').length,
    left: groups.today.filter(w => w.status === 'left').length,
  }), [groups])

  const historyCount = groups.history.reduce((n, g) => n + g.items.length, 0)
  const flatList = filter === 'active' ? groups.active : groups.today
  const isEmpty = filter === 'history' ? groups.history.length === 0 : flatList.length === 0
  const emptyTitle = { today: '今天尚無候位記錄', active: '目前無人候位', history: '尚無歷史記錄' }[filter]

  return (
    <Modal open={open} onClose={onClose} title="候位歷史與統計">
      <div className="space-y-3">
        {/* 今日統計（順序：等待中→已叫號→已入座→已離開） */}
        <div className="text-xs font-bold text-chicken-brown/55">今日統計 · {dateLabel(today)}</div>
        <div className="grid grid-cols-4 gap-2">
          <Card className="!p-3 text-center"><div className="text-2xl font-bold text-amber-700">{stats.waiting}</div><div className="text-[11px] text-chicken-brown/60">等待中</div></Card>
          <Card className={`!p-3 text-center ${stats.called > 0 ? 'border-amber-400 !border-2 bg-amber-50' : ''}`}><div className="text-2xl font-bold text-amber-700">{stats.called}</div><div className="text-[11px] text-chicken-brown/60">已叫號</div></Card>
          <Card className="!p-3 text-center"><div className="text-2xl font-bold text-emerald-600">{stats.seated}</div><div className="text-[11px] text-chicken-brown/60">已入座</div></Card>
          <Card className="!p-3 text-center"><div className="text-2xl font-bold text-chicken-brown/40">{stats.left}</div><div className="text-[11px] text-chicken-brown/60">已離開</div></Card>
        </div>

        <SegmentedControl size="sm" ariaLabel="候位篩選" value={filter} onChange={setFilter}
          options={[
            { key: 'today', label: '今日', sub: String(groups.today.length) },
            { key: 'active', label: '活躍中', sub: String(groups.active.length) },
            { key: 'history', label: '歷史', sub: String(historyCount) },
          ]} />

        {isEmpty ? (
          <EmptyState icon="traffic" title={emptyTitle} />
        ) : filter === 'history' ? (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {groups.history.map(g => (
              <section key={g.date || 'unknown'} className="space-y-2">
                <div className="sticky top-0 z-10 bg-white py-1 text-xs font-bold text-chicken-brown/70">
                  {dateLabel(g.date)} · {g.items.length} 組
                </div>
                {g.items.map(w => <WaitRow key={w.id} w={w} />)}
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {/* 活躍中可能混到前幾天沒結掉的號，那幾筆要帶日期才分得出來 */}
            {flatList.map(w => <WaitRow key={w.id} w={w} showDate={filter === 'active' && localDateOf(w.takenAt) !== today} />)}
          </div>
        )}
      </div>
    </Modal>
  )
}
