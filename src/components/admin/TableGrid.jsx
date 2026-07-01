import { useMemo, useState } from 'react'
import { Card, Input, Select } from '../ui'
import { useToast, useConfirm } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { totalActiveSeats } from '../../utils/capacity'
import { isTableOutOnDate, normalizeOutage, outageLabel } from '../../utils/tableAvailability'
import { todayStr } from '../../utils/timeSlots'

export default function TableGrid() {
  const { tables, toggleTable, bookings } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  const today = todayStr()

  const [search, setSearch] = useState('')
  const [floorFilter, setFloorFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  // 未來已排（含併桌額外桌）到此桌、且尚未取消的訂位數 —— 停用前警告用（停用不會自動改派）。
  const futureAssignedCount = (tableNumber) => (bookings || []).filter(b =>
    b.status === 'confirmed' && b.date >= today &&
    (b.assignedTableId === tableNumber || (b.extraTableIds || []).includes(tableNumber))
  ).length

  // 點擊切換啟用/停用 + 反饋；佔用守門失敗時顯示原因（桌上有客人不准停用）；
  // 停用有未來已排訂位的桌先二次確認。
  const handleToggle = async (t) => {
    if (t.isActive) {
      const n = futureAssignedCount(t.number)
      if (n > 0) {
        const ok = await confirm(
          `桌 ${t.number} 有 ${n} 筆未來已排訂位。停用不會自動改派，該桌將不出現在現場頁、也不計入可訂容量。仍要停用？`,
          { title: '停用已排桌位', danger: true, confirmLabel: '仍要停用' }
        )
        if (!ok) return
      }
    }
    const r = toggleTable(t.number)
    if (!r?.ok) return toast.error(r?.error || '無法切換')
    if (t.isActive) toast.warning(`已停用 ${t.number}`)
    else toast.success(`已啟用 ${t.number}`)
  }

  const floors = useMemo(
    () => [...new Set(tables.map(t => t.floor).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
    [tables]
  )

  // 篩選：桌號搜尋 + 樓層 + 桌型
  const matches = (t) => {
    if (search.trim() && !String(t.number).toLowerCase().includes(search.trim().toLowerCase())) return false
    if (floorFilter !== 'all' && t.floor !== floorFilter) return false
    if (typeFilter !== 'all' && String(t.capacity) !== typeFilter) return false
    return true
  }
  const visibleTables = tables.filter(matches)

  const stats = useMemo(() => {
    const four = tables.filter(t => t.capacity === 4)
    const six = tables.filter(t => t.capacity === 6)
    const fourActive = four.filter(t => t.isActive).length
    const sixActive = six.filter(t => t.isActive).length
    const seats = totalActiveSeats(tables)
    const outTables = tables.filter(t => t.isActive && isTableOutOnDate(t, today))
    const outSeats = outTables.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
    return { fourActive, fourTotal: four.length, sixActive, sixTotal: six.length, seats, outToday: outTables.length, outSeats }
  }, [tables, today])

  // 批次啟用/停用（作用於目前篩選出的桌位）；停用先彙總未來已排數量並二次確認，桌上有客人者自動略過。
  const handleBatch = async (activate) => {
    const targets = visibleTables.filter(t => t.isActive === !activate)
    if (!targets.length) { toast.info(activate ? '篩選範圍內沒有可啟用的桌位' : '篩選範圍內沒有可停用的桌位'); return }
    if (!activate) {
      const futures = targets.reduce((s, t) => s + futureAssignedCount(t.number), 0)
      const ok = await confirm(
        `即將停用篩選範圍內 ${targets.length} 張桌${futures ? `，其中含 ${futures} 筆未來已排訂位（停用不會自動改派）` : ''}。桌上有客人的桌會自動略過。確定停用？`,
        { title: '批次停用桌位', danger: true, confirmLabel: '確定停用' }
      )
      if (!ok) return
    }
    let done = 0, skipped = 0
    targets.forEach(t => { const r = toggleTable(t.number); if (r?.ok) done++; else skipped++ })
    const msg = `已${activate ? '啟用' : '停用'} ${done} 張桌${skipped ? `（略過 ${skipped} 張：桌上有客人或無法切換）` : ''}`
    if (activate) toast.success(msg); else toast.warning(msg)
  }

  const fourSeaters = visibleTables.filter(t => t.capacity === 4)
  const sixSeaters = visibleTables.filter(t => t.capacity === 6)
  // 桌號範圍標籤由實際資料推導（避免重新編號後又留下過時文案）
  const rangeLabel = (list) => {
    const nums = list.map(t => String(t.number)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return nums.length ? `${nums[0]}–${nums[nums.length - 1]}` : '—'
  }

  const renderTable = (t, activeClass) => {
    const out = isTableOutOnDate(t, today)
    // 只有「未來」的維修窗標為排定；過期紀錄不再顯示（normalizeOutage 過濾壞資料）
    const o = normalizeOutage(t.outage)
    const upcoming = !out && o && o.from > today ? outageLabel(t, today) : ''
    return (
      <button
        key={t.number}
        type="button"
        onClick={() => handleToggle(t)}
        className={`aspect-square min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center text-xs font-bold transition-all active:scale-95 ${
          !t.isActive
            ? 'border-chicken-brown/20 bg-chicken-brown/5 text-chicken-brown/30 line-through'
            : out
              ? 'border-orange-300 bg-orange-50 text-orange-700'
              : activeClass
        }`}
        title={out || upcoming ? outageLabel(t, today) : undefined}
      >
        <span>{out ? '🛠' : ''}{t.number}</span>
        <span className="text-[9px] opacity-70">{out ? '維修' : upcoming ? '🛠排定' : `${t.capacity}人`}</span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-chicken-brown/60">四人桌</div>
            <div className="text-xl font-black text-chicken-brown">{stats.fourActive}<span className="text-sm text-chicken-brown/40">/{stats.fourTotal}</span></div>
          </div>
          <div>
            <div className="text-xs text-chicken-brown/60">六人桌</div>
            <div className="text-xl font-black text-chicken-brown">{stats.sixActive}<span className="text-sm text-chicken-brown/40">/{stats.sixTotal}</span></div>
          </div>
          <div>
            <div className="text-xs text-chicken-brown/60">可用座位</div>
            <div className="text-xl font-black text-chicken-red">{stats.seats}</div>
          </div>
        </div>
        {stats.outToday > 0 && (
          <p className="mt-2 text-center text-xs font-bold text-orange-600">🛠 今日有 {stats.outToday} 桌維修中（今日實際可訂 {stats.seats - stats.outSeats} 位 = 上方 {stats.seats} − 維修 {stats.outSeats}；到現場頁點該桌可結束維修）</p>
        )}
      </Card>

      {/* 篩選 / 搜尋 / 批次 */}
      <Card>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input label="搜尋桌號" value={search} onChange={e => setSearch(e.target.value)} placeholder="輸入桌號" />
          <Select
            label="樓層"
            value={floorFilter}
            onChange={e => setFloorFilter(e.target.value)}
            options={[{ value: 'all', label: '全部樓層' }, ...floors.map(f => ({ value: f, label: f }))]}
          />
          <Select
            label="桌型"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            options={[{ value: 'all', label: '全部桌型' }, { value: '4', label: '四人桌' }, { value: '6', label: '六人桌' }]}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-chicken-brown/60">符合 {visibleTables.length} 張</span>
          <div className="flex-1" />
          <button type="button" onClick={() => handleBatch(true)} className="btn-secondary min-h-[44px] px-4 text-sm">批次啟用</button>
          <button type="button" onClick={() => handleBatch(false)} className="btn-danger min-h-[44px] px-4 text-sm">批次停用</button>
        </div>
      </Card>

      {(typeFilter === 'all' || typeFilter === '4') && (
        <Card>
          <h3 className="font-bold text-chicken-brown mb-3">🪑 四人桌（{rangeLabel(fourSeaters)}）</h3>
          {fourSeaters.length === 0 ? (
            <p className="text-sm text-chicken-brown/50">無符合條件的四人桌</p>
          ) : (
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
              {fourSeaters.map(t => renderTable(t, 'border-chicken-green bg-chicken-green/15 text-chicken-brown'))}
            </div>
          )}
        </Card>
      )}

      {(typeFilter === 'all' || typeFilter === '6') && (
        <Card>
          <h3 className="font-bold text-chicken-brown mb-3">🪑 六人桌（{rangeLabel(sixSeaters)}）</h3>
          {sixSeaters.length === 0 ? (
            <p className="text-sm text-chicken-brown/50">無符合條件的六人桌</p>
          ) : (
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
              {sixSeaters.map(t => renderTable(t, 'border-chicken-yellow bg-chicken-yellow/15 text-chicken-brown'))}
            </div>
          )}
        </Card>
      )}

      <p className="text-center text-xs text-chicken-brown/50">點擊桌子可切換啟用 / 停用（長期）；短期維修請在現場頁點桌設定「維修停用」</p>
    </div>
  )
}
