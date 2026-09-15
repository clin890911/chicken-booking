import { useMemo, useState, useRef } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { useAuth } from '../../../contexts/AuthContext'
import { Button, Input, Select, Textarea } from '../../ui'
import SeatGauge from '../../ui/SeatGauge'
import FloorMap from '../floormap/FloorMap'
import GroupSheet from '../group/GroupSheet'
import Icon from '../../ui/Icon'
import SegmentedControl from '../../ui/SegmentedControl'
import AgencyPicker from '../group/AgencyPicker'
import NumberStepper from './NumberStepper'
import GroupEditorSummary from './GroupEditorSummary'
import BatchSeatPanel from './BatchSeatPanel'
import {
  SPECIAL_FIELDS, TOTAL_PRESETS, composeBusInfo, parseBusInfo, overSpecialCounts, specialOverMessage,
} from './groupEditorFields'
import { dayLabel, seatingForSlot, arrivalSlotsForSeating } from '../../../utils/timeSlots'
import { guestTableNumbers, guestBatches, isEscortBatch, remainingTablesForSeating } from '../../../utils/capacity'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'
import { suggestTablesForBatch } from '../../../utils/suggestTables'
import * as groupReservationService from '../../../services/groupReservationService'

const BATCH_LABELS = ['一', '二', '三', '四', '五', '六']

// 抵達時間下拉：場次已知 → 場次窗內 15 分間隔選項（保證落窗內、不會誤跳場次）；
// 無場次（未設定場次的店）→ 退回營業時段 grid。一律含現有值（舊資料 / off-grid 也顯示）。
function ArrivalTimeSelect({ seating, slots = [], value, onChange, className = '' }) {
  const options = useMemo(() => {
    const base = seating ? arrivalSlotsForSeating(seating) : slots
    if (value && !base.includes(value)) return [...base, value].sort()
    return base
  }, [seating, slots, value])
  return (
    <Select
      value={value || seating?.start || ''}
      onChange={e => onChange(e.target.value)}
      options={options}
      className={className}
    />
  )
}

// 場次卡剩餘色調
function seatingTone(r) {
  if (!r || r.closed) return 'closed'
  if ((r.remainingSeats ?? 0) <= 0) return 'full'
  if ((r.remainingTables ?? 0) <= 2 || (r.totalSeats > 0 && r.remainingSeats < r.totalSeats * 0.15)) return 'tight'
  return 'ok'
}

// 區段標題（右側「待填 / ✓ 完成」）
function SectionHead({ n, title, hint, done }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-chicken-brown/[0.08] text-[11px] font-bold text-chicken-brown/70">{n}</span>
      <h3 className="text-sm font-semibold text-chicken-brown">{title}</h3>
      {hint && <span className="hidden text-xs font-medium text-chicken-brown/50 sm:inline">· {hint}</span>}
      <span className="flex-1" />
      <span className={`inline-flex items-center gap-1 text-xs font-bold ${done ? 'text-[#5b8c1f]' : 'text-chicken-brown/40'}`}>
        {done && <Icon name="check" size={12} strokeWidth={3} />}{done ? '完成' : '待填'}
      </span>
    </div>
  )
}

// 可摺疊區塊（自建，不用 <details>：受控開合才能「有資料就預設展開」）
function Disclosure({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-[#fbfaf8]">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="tap flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-chicken-brown">
        <Icon name="chevronDown" size={14} strokeWidth={2.4} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

// 階段三：單一團單編輯器（一頁三段 + 右側即時摘要與檢查清單）。
// 2026-09 由「2 頁精靈」攤平：填到哪摘要與檢查清單就跟到哪，儲存鈕只在全綠時亮，
// 不再有「翻到第二頁才知道第一頁填錯」。存檔鏈（validateGroupForSave → createAndReserveGroup /
// reserveGroupTables → 雲端交易，409 回滾）完全沒動。
export default function GroupEditorStage({
  initialGroup, isNew, date, slots,
  tables, settings, bookings, agencies, guides, groupReservations = [],
  onBack, onSaved, onDeleted,
  reserveExisting, createGroup, removeGroup,
  addAgency, addGuide,
  rescheduleFrom = null,
}) {
  const toast = useToast()
  // 權限門的用意不只是「不給做」，更是防止越權寫入毒化整台裝置的同步：
  // 後端「任一集合越權即整包 403」，一旦推送裡混進無權的集合或 deletedIds，
  // 該裝置整個 session 的所有變更（含帶位、訂位）都會推不上雲。
  const { can } = useAuth()
  const confirm = useConfirm()
  const { fixtures, zones } = useBooking()

  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(initialGroup)))
  const [activeBatchId, setActiveBatchId] = useState(draft.batches?.[0]?.id || null)
  const [floor, setFloor] = useState('1F')
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [quickAgency, setQuickAgency] = useState(null)
  const [quickGuide, setQuickGuide] = useState(null)
  // 拆梯的場次選擇器有兩個入口（梯次列、圈桌側欄）：存來源字串，一次只開一個
  const [addingBatch, setAddingBatch] = useState(false)  // false | 'list' | 'panel'
  const [guideHint, setGuideHint] = useState(false)
  // 特殊需求「有才加」：預設只展開已有數字的項目
  const [openSpecials, setOpenSpecials] = useState(
    () => SPECIAL_FIELDS.filter(f => (Number(initialGroup?.counts?.[f.key]) || 0) > 0).map(f => f.key),
  )
  // 遊覽車三格：本地狀態 ⇄ draft.busInfo 單一字串（見 groupEditorFields 的註解）
  const [bus, setBus] = useState(() => parseBusInfo(initialGroup?.busInfo))
  const savingRef = useRef(false)

  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const hasSeatings = seatings.length > 0

  const draftGuides = useMemo(
    () => guides.filter(g => !g.archived && g.agencyId === draft.agencyId),
    [guides, draft.agencyId],
  )
  // 與容量引擎同口徑：此日期不可用（停用/維修）的桌不計席——SeatGauge 與儲存驗證才不會
  // 把維修桌的座位算成「已圈到」。
  const capByNum = useMemo(() => {
    const m = {}; tables.forEach(t => { m[t.number] = isTableUsableOnDate(t, date) ? t.capacity : 0 }); return m
  }, [tables, date])
  const seatsOf = (nums) => (nums || []).reduce((s, n) => s + (capByNum[n] || 0), 0)
  // 梯次人數單一來源：單一「旅客梯次」= 總人數（不重複填）；多梯/司領桌 = 各自 guests。
  const batchGuests = (b) => (b && !b.isEscort && guestBatches(draft).length === 1)
    ? (Number(draft.counts?.total) || 0)
    : (Number(b?.guests) || 0)

  const total = Number(draft.counts?.total) || 0

  // 各場次剩餘（排除本團自己的保留，避免改舊團時把自己算成滿）
  const otherGroups = useMemo(() => groupReservations.filter(g => g.id !== draft.id), [groupReservations, draft.id])
  const seatingRemaining = useMemo(() => {
    const m = {}
    seatings.forEach(s => { m[s.id] = remainingTablesForSeating(tables, bookings, otherGroups, date, s, settings) })
    return m
  }, [seatings, tables, bookings, otherGroups, date, settings])

  const primaryBatch = draft.batches?.[0] || null
  const primarySeating = primaryBatch ? seatingForSlot(settings, primaryBatch.timeSlot) : null

  const activeBatch = draft.batches?.find(b => b.id === activeBatchId) || null
  const selectedTables = activeBatch?.tableNumbers || []

  // 旅客梯次 / 司領桌分流：旅客計數、梯次編號、「單梯=總人數」只看旅客梯次
  const gBatches = guestBatches(draft)
  const singleGuest = gBatches.length === 1
  const escortBatch = (draft.batches || []).find(isEscortBatch) || null

  // 別團／已訂（同日同場次已被佔走）
  const conflictTables = useMemo(() => {
    if (!activeBatch) return []
    const conflictMap = groupReservationService.tableConflictsForBatch({
      date, timeSlot: activeBatch.timeSlot, settings, excludeGroupId: draft.id || null, bookings,
    })
    return Object.keys(conflictMap)
  }, [activeBatch, date, settings, draft.id, bookings])

  // 本團「其他梯」已圈的桌 → { 桌號: 該梯 label }。同一張桌排兩梯＝同一輪有兩組客人要坐，
  // tableConflictsForBatch 以 excludeGroupId 排除本團、看不見這件事，所以在這裡自己算並一起擋。
  // ⚠️ FloorMap 規劃模式只有 selected|blocked|available 三態：別梯與別團在圖上同為灰色，
  //    差別靠側欄的桌號清單與點擊時的錯誤訊息講清楚（不為此改 FloorMap）。
  const otherBatchTables = useMemo(() => {
    const m = {}
    ;(draft.batches || []).forEach(b => {
      if (b.id === activeBatchId) return
      ;(b.tableNumbers || []).forEach(n => { m[String(n)] = b.label })
    })
    return m
  }, [draft.batches, activeBatchId])

  // 地圖與一鍵推薦共用的不可選集合（已在本梯選到的不算 blocked，否則取消不掉）
  const blockedTables = useMemo(
    () => [...new Set([...conflictTables, ...Object.keys(otherBatchTables)])].filter(n => !selectedTables.includes(n)),
    [conflictTables, otherBatchTables, selectedTables],
  )

  // 本梯已圈、但同時也被別梯圈走的桌（載入既有資料才會出現）：側欄要紅字點名
  const dupTables = useMemo(
    () => selectedTables.map(String).filter(n => Object.prototype.hasOwnProperty.call(otherBatchTables, n)),
    [selectedTables, otherBatchTables],
  )

  // 旅客保留席（不含司領桌）— 摘要卡席位量表與總人數對比用
  const heldSeats = useMemo(() => guestTableNumbers(draft).reduce((s, n) => s + (capByNum[n] || 0), 0), [draft, capByNum])

  // 全團（含司領桌）圈到、但在此日期停用/維修中的桌：validateGroupForSave 會擋，檢查清單要先講。
  const badTables = useMemo(() => {
    const byNum = new Map((tables || []).map(t => [String(t.number), t]))
    const out = []
    ;(draft.batches || []).forEach(b => (b.tableNumbers || []).forEach(n => {
      const t = byNum.get(String(n))
      if (t && !isTableUsableOnDate(t, date) && !out.includes(String(n))) out.push(String(n))
    }))
    return out
  }, [draft.batches, tables, date])
  // 本梯圈到的壞桌：地圖上已置灰不可點 → 移除路徑由圈桌側欄的桌號 chip 提供（點一下即移除），
  // 否則會卡死在「無法取消圈選」。
  const outCircledTables = useMemo(
    () => selectedTables.filter(n => badTables.includes(String(n))),
    [selectedTables, badTables],
  )
  const removeCircledTable = (number) => setDraft(d => ({
    ...d,
    batches: d.batches.map(b => b.id !== activeBatchId
      ? b
      : { ...b, tableNumbers: b.tableNumbers.filter(n => String(n) !== String(number)) }),
  }))

  // === draft 編輯 helpers ===
  const patchDraft = (patch) => setDraft(d => ({ ...d, ...patch }))
  // 總人數：單梯次時直接同步主梯 guests（梯次列不再重複填）
  const patchCount = (key, val) => setDraft(d => {
    const counts = { ...d.counts, [key]: Number(val) || 0 }
    // 只有「單一旅客梯次」時把總人數同步進該旅客梯次（司領桌不同步）
    const batches = (key === 'total' && guestBatches(d).length === 1)
      ? d.batches.map(b => (b.isEscort ? b : { ...b, guests: counts.total }))
      : d.batches
    return { ...d, counts, batches }
  })
  const patchBatch = (batchId, patch) => setDraft(d => ({ ...d, batches: d.batches.map(b => b.id === batchId ? { ...b, ...patch } : b) }))
  const patchBus = (patch) => {
    const next = { ...bus, ...patch }
    setBus(next)
    patchDraft({ busInfo: composeBusInfo(next) })
  }
  // 只重編旅客梯次序號（第N梯）；司領桌保留 label
  const relabel = (batches) => {
    let n = 0
    return batches.map(b => {
      if (b.isEscort) return b
      n += 1
      return { ...b, label: `第${BATCH_LABELS[n - 1] || n}梯` }
    })
  }
  const addBatchForSeating = (s) => setDraft(d => {
    const gb = d.batches.filter(b => !b.isEscort)
    const n = gb.length + 1
    // 新梯人數預設 = 總人數扣掉已分配（兩段輪替常見「先坐滿、剩的進第二梯」）；司領桌不計
    const t = Number(d.counts?.total) || 0
    const assigned = gb.reduce((sum, b) => sum + (Number(b.guests) || 0), 0)
    const nb = { id: 'BT' + Date.now().toString(36) + n, label: `第${BATCH_LABELS[n - 1] || n}梯`, timeSlot: s.start, tableNumbers: [], guests: Math.max(0, t - assigned), note: '' }
    setActiveBatchId(nb.id)
    return { ...d, batches: [...d.batches, nb] }
  })
  const removeBatch = (batchId) => setDraft(d => {
    const batches = relabel(d.batches.filter(b => b.id !== batchId))
    if (activeBatchId === batchId) setActiveBatchId(batches[0]?.id || null)
    return { ...d, batches }
  })
  // 司領桌（司機+領隊）：一團一個 isEscort 梯次，可圈多張桌、guests 預設 2、time 同主梯
  const addEscort = () => setDraft(d => {
    if (d.batches.some(b => b.isEscort)) return d
    const eb = {
      id: 'BT' + Date.now().toString(36) + 'E',
      label: '司領桌', timeSlot: d.batches[0]?.timeSlot || '11:00',
      tableNumbers: [], guests: 2, note: '', isEscort: true,
    }
    setActiveBatchId(eb.id)
    return { ...d, batches: [...d.batches, eb] }
  })
  const removeEscort = (id) => setDraft(d => {
    const batches = d.batches.filter(b => b.id !== id)
    if (activeBatchId === id) setActiveBatchId(batches[0]?.id || null)
    return { ...d, batches }
  })
  const toggleTable = (number) => {
    if (!activeBatch) return toast.error('請先選一個梯次再圈桌')
    // 已在本梯的桌一律讓它取消得掉——事後才變成衝突／重複的桌否則會卡死在「無法取消圈選」
    if (!selectedTables.includes(number)) {
      const owner = otherBatchTables[String(number)]
      if (owner) return toast.error(`${number} 已由「${owner}」圈走，同一張桌不能排兩梯`)
      if (blockedTables.includes(number)) return toast.error(`${number} 已被其他團/訂位佔用`)
    }
    setDraft(d => ({
      ...d,
      batches: d.batches.map(b => {
        if (b.id !== activeBatchId) return b
        const has = b.tableNumbers.includes(number)
        return { ...b, tableNumbers: has ? b.tableNumbers.filter(n => n !== number) : [...b.tableNumbers, number] }
      }),
    }))
  }

  // 預選場次 → 鎖定主梯次的 timeSlot（= 場次.start，可再用抵達時間下拉微調）
  const selectSession = (s) => {
    if (!primaryBatch) return
    patchBatch(primaryBatch.id, { timeSlot: s.start })
    setActiveBatchId(primaryBatch.id)
  }

  // 一鍵推薦桌位（依本梯人數 + 場次，避開 blocked，取最少桌）
  const autoSuggest = () => {
    if (!activeBatch) return toast.error('請先選一個梯次')
    const need = batchGuests(activeBatch) || total
    if (need <= 0) return toast.error('請先填本梯用餐人數')
    const { tableNumbers, enough } = suggestTablesForBatch({ tables, headcount: need, blockedTables, capByNum, date })
    patchBatch(activeBatch.id, { tableNumbers })
    if (enough) toast.success('已自動推薦桌位，可再手動微調')
    else toast.info('本場次可用桌不足以容納本梯人數，已選滿可用桌，請改場次或拆梯次')
  }

  // === 旅行社/導遊 ===
  // 該旅行社「最近一張團單」的導遊快照（依日期排序；排除正在編輯的這張）
  const lastGuideFor = (agencyId) => {
    if (!agencyId) return null
    const g = (groupReservations || [])
      .filter(x => x.agencyId === agencyId && x.id !== draft.id && x.status !== 'cancelled' && (x.guideName || x.guidePhone))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
    return g ? { guideName: g.guideName || '', guidePhone: g.guidePhone || '' } : null
  }
  const onPickAgency = (a) => {
    // guideId 是「名冊導遊」的關聯鍵；換旅行社後舊 id 必然不屬於新旅行社，一律清掉。
    // 姓名/電話是自由欄位，**已有內容就不覆蓋**（店員可能先問到導遊才選旅行社）。
    const hasGuide = !!((draft.guideName || '').trim() || (draft.guidePhone || '').trim())
    const last = hasGuide ? null : lastGuideFor(a.id)
    patchDraft({ agencyId: a.id, agencyName: a.name, guideId: null, ...(last || {}) })
    setGuideHint(!!last)
  }
  const setGuideName = (v) => { patchDraft({ guideName: v, guideId: null }); setGuideHint(false) }
  const setGuidePhone = (v) => { patchDraft({ guidePhone: v }); setGuideHint(false) }
  const pickRosterGuide = (g) => { patchDraft({ guideId: g.id, guideName: g.name || '', guidePhone: g.phone || '' }); setGuideHint(false) }
  const createQuickAgency = () => {
    // 寫 agencies 需 agency.manage（外場沒有）。名冊頁的同一操作早已用 can() 擋，
    // 這條 inline 快速新增是漏網的：外場按下去會整包 403，且重整後新增的旅行社會
    // 被雲端資料覆蓋而無聲消失。
    if (!can('agency.manage')) return toast.error('你的角色沒有新增旅行社的權限，請聯絡店長')
    if (!quickAgency?.name?.trim()) return toast.error('請填旅行社名稱')
    const a = addAgency(quickAgency)
    patchDraft({ agencyId: a.id, agencyName: a.name, guideId: null })
    setQuickAgency(null)
    toast.success('已新增旅行社')
  }
  const createQuickGuide = () => {
    if (!can('agency.manage')) return toast.error('你的角色沒有新增導遊的權限，請聯絡店長')
    if (!quickGuide?.name?.trim()) return toast.error('請填導遊姓名')
    if (!draft.agencyId) return toast.error('請先選旅行社')
    const g = addGuide({ ...quickGuide, agencyId: draft.agencyId })
    patchDraft({ guideId: g.id, guideName: g.name, guidePhone: g.phone || '' })
    setQuickGuide(null)
    setGuideHint(false)
    toast.success('已新增導遊')
  }

  // === 場次可選性 ===
  // 剩餘席位 < 總人數 → 灰掉標「不夠這團」。
  // ⚠️ 安全閥：若「每個場次都不夠」就解除鎖定——那正是兩段用餐輪替（86 人兩台大巴）的情境，
  //    全部鎖死會讓這種團完全建不了單。
  const seatingShort = (s) => {
    const r = seatingRemaining[s.id]
    return total > 0 && (r?.remainingSeats ?? 0) > 0 && (r.remainingSeats < total)
  }
  const allSeatingsShort = hasSeatings && total > 0 && seatings.every(s => {
    const r = seatingRemaining[s.id]
    return r?.closed || (r?.remainingSeats ?? 0) <= 0 || r.remainingSeats < total
  })

  // === 檢查清單（逐條對應 validateGroupForSave，不通過就不給存）===
  const specialOver = overSpecialCounts(draft.counts)
  const specialErr = specialOverMessage(draft.counts)
  const checks = useMemo(() => {
    const hasAgency = !!(draft.agencyId || (draft.agencyName || '').trim())
    const allBatches = draft.batches || []
    const seatingPicked = hasSeatings ? !!primarySeating : !!primaryBatch?.timeSlot
    const r = primarySeating ? seatingRemaining[primarySeating.id] : null
    const seatingBlocked = !!(primarySeating && (r?.closed || (r?.remainingSeats ?? 0) <= 0))
    const batchesReady = gBatches.length > 0 && allBatches.every(
      b => (b.tableNumbers || []).length > 0 && (b.isEscort || batchGuests(b) > 0),
    )
    const perBatchEnough = allBatches.every(b => seatsOf(b.tableNumbers) >= batchGuests(b))
    const seatsOk = total > 0 && heldSeats > 0 && perBatchEnough && (singleGuest ? heldSeats >= total : true)
    return [
      { key: 'agency', label: '已選旅行社', ok: hasAgency, bad: false, reason: '請選擇或新增旅行社' },
      { key: 'total', label: '總人數大於 0', ok: total > 0 && !specialErr, bad: !!specialErr, reason: specialErr || '請填總人數' },
      {
        key: 'seating',
        label: hasSeatings ? '已選場次' : '已選用餐時段',
        ok: seatingPicked && !seatingBlocked,
        bad: seatingBlocked,
        reason: seatingBlocked ? `「${primarySeating.name}」已關閉或客滿，請改選` : '請選擇場次',
      },
      { key: 'batches', label: '每梯都已圈桌且有人數', ok: batchesReady, bad: false, reason: '還有梯次沒圈桌或沒填人數' },
      {
        key: 'seats',
        label: `席位夠坐（已圈 ${heldSeats} / 需 ${total} 席）`,
        ok: seatsOk,
        bad: heldSeats > 0 && total > 0 && !seatsOk,
        reason: '保留席不足，請再多圈幾桌',
      },
      { key: 'tables', label: '沒有停用/維修中的桌', ok: badTables.length === 0, bad: badTables.length > 0, reason: `${badTables.join('、')} 當日停用/維修中` },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, total, heldSeats, badTables, specialErr, primarySeating, primaryBatch, hasSeatings, seatingRemaining, singleGuest, gBatches.length, capByNum])

  const canSave = checks.every(c => c.ok && !c.bad)
  const allTableNumbers = useMemo(
    () => [...new Set(gBatches.flatMap(b => b.tableNumbers || []))],
    [gBatches],
  )
  // 儲存鈕的桌數含司領桌——那幾張桌一樣會被這張團單保留走
  const reservedTableCount = useMemo(
    () => new Set((draft.batches || []).flatMap(b => b.tableNumbers || [])).size,
    [draft.batches],
  )
  const saveLabel = reservedTableCount ? `儲存並保留 ${reservedTableCount} 桌` : '儲存並保留桌位'

  const sec1Done = !!(draft.agencyId || (draft.agencyName || '').trim())
  const sec2Done = total > 0 && !specialErr
  const sec3Done = checks.find(c => c.key === 'seating').ok && checks.find(c => c.key === 'batches').ok

  const specialsText = SPECIAL_FIELDS
    .filter(f => (Number(draft.counts?.[f.key]) || 0) > 0)
    .map(f => `${f.label} ${draft.counts[f.key]}`)
    .join('、')

  // === 儲存 / 刪除 ===
  const save = async () => {
    if (savingRef.current) return
    // 新建團單需 group.create（外場沒有）。改既有團單只需 group.update，外場可以
    // （帶團入座本來就會改團狀態）。這道門讓「外場不建新團單」這個不變量真的成立——
    // 後端集合層權限分不出 create/update，只能在這裡把關。
    if (isNew && !can('group.create')) return toast.error('你的角色沒有建立團單的權限，請聯絡店長或訂位專員')
    // 單一旅客梯次以總人數為準（梯次列不重複填，存檔時強制同步；司領桌不同步）
    const batchesToSave = guestBatches(draft).length === 1
      ? draft.batches.map(b => (b.isEscort ? b : { ...b, guests: total }))
      : draft.batches
    const err0 = groupReservationService.validateGroupForSave({ ...draft, date, batches: batchesToSave }, capByNum, tables)
    if (err0) return toast.error(err0)
    if ((draft.batches || []).length > 1 && total > heldSeats) {
      toast.info(`提醒：總人數 ${total} 大於保留席數 ${heldSeats}，將以多梯次輪替（請確認梯次安排）`)
    }
    const patch = {
      // date 帶入 patch：一般編輯＝原日期（no-op）；改期＝新日期，後端 groupReserveTables
      // 以 where('date','==', patch.date) 對新日重檢衝突並 merge 搬移同一份團單 doc。
      date,
      agencyId: draft.agencyId || null, agencyName: draft.agencyName || '',
      guideId: draft.guideId || null, guideName: draft.guideName || '', guidePhone: draft.guidePhone || '',
      batches: batchesToSave, counts: draft.counts,
      allergyText: draft.allergyText || '', tableSideNeeds: draft.tableSideNeeds || '',
      busInfo: draft.busInfo || '', notes: draft.notes || '', spend: Number(draft.spend) || 0,
      status: draft.status === 'planned' ? 'confirmed' : draft.status,
    }
    savingRef.current = true
    setBusy(true)
    try {
      if (isNew) {
        const saved = await createGroup({ ...draft, ...patch, date })
        onSaved(saved?.id)
      } else {
        await reserveExisting(draft.id, patch)
        onSaved(draft.id)
      }
      toast.success('團單已儲存')
    } catch (err) {
      if (err?.status === 409) toast.error('桌位衝突：' + (err.message || '已被其他團或現場訂位佔用，請重新圈桌'))
      else toast.error('儲存失敗：' + (err?.message || '未知錯誤'))
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  const doDelete = async () => {
    // 刪除會產生 deletedIds.groupReservations（需 group.delete）。外場沒有此權限，
    // 硬刪會讓推送整包 403、整台裝置同步停擺；而且重整後雲端資料會回來，
    // 使用者以為刪掉了其實沒有。與 PlanningView 的自動 purge 同一道防線。
    if (!can('group.delete')) return toast.error('你的角色沒有刪除團單的權限，請聯絡店長')
    const ok = await confirm('刪除後無法復原，確定要刪除這筆團單嗎？', { title: '刪除團單', confirmLabel: '刪除', danger: true })
    if (!ok) return
    if (draft.id) removeGroup(draft.id)
    toast.info('已刪除團單')
    onDeleted()
  }

  // 圈桌側欄用的衍生值
  const activeSeatingObj = activeBatch ? seatingForSlot(settings, activeBatch.timeSlot) : null
  const activeSeatingLabel = activeBatch
    ? [activeSeatingObj?.name, activeBatch.timeSlot].filter(Boolean).join(' ')
    : ''
  const batchChips = [...gBatches, ...(escortBatch ? [escortBatch] : [])]
    .map(b => ({ id: b.id, label: b.label, timeSlot: b.timeSlot, isEscort: !!b.isEscort }))

  // 「拆梯」的場次選擇器：梯次列與圈桌側欄兩個入口共用同一段 UI 與同一條 addBatchForSeating。
  const renderNewBatchPicker = () => (
    <div className="w-full space-y-1.5 rounded-xl border border-dashed border-chicken-brown/20 bg-[#fbfaf8] p-2.5">
      <div className="text-xs font-semibold text-chicken-brown/70">選新梯次的場次：</div>
      <div className="flex flex-wrap gap-1.5">
        {(hasSeatings ? seatings : []).map(s => {
          const r = seatingRemaining[s.id]
          const disabled = r?.closed || (r?.remainingSeats ?? 0) <= 0
          return (
            <button key={s.id} type="button" disabled={disabled} onClick={() => { addBatchForSeating(s); setAddingBatch(false) }}
              className="tap h-8 rounded-lg border border-chicken-brown/15 bg-white px-2.5 text-xs font-semibold text-chicken-brown disabled:cursor-not-allowed disabled:opacity-40">
              {s.name} {s.start}（剩 {r?.remainingSeats ?? '—'} 席）
            </button>
          )
        })}
        {!hasSeatings && <span className="text-xs text-chicken-brown/50">尚未設定場次</span>}
      </div>
      <button type="button" onClick={() => setAddingBatch(false)} className="tap text-xs font-semibold text-chicken-brown/60">取消</button>
    </div>
  )

  // 梯次列（旅客梯次與司領桌共用）。
  // 🔴 刻意寫成「回傳 JSX 的函式」而不是內嵌元件：內嵌元件每次 render 都是新的 type，
  //    React 會整段 unmount/remount，裡面的 NumberStepper 打字打到一半就失焦。
  const renderBatchRow = (b, escort) => {
    const sea = seatingForSlot(settings, b.timeSlot)
    const active = activeBatchId === b.id
    const seats = seatsOf(b.tableNumbers)
    const nums = b.tableNumbers || []
    return (
      <div key={b.id} className={`rounded-xl p-2.5 ${active ? 'ring-2 ring-chicken-red bg-chicken-red/[0.04]' : escort ? 'ring-1 ring-inset ring-chicken-brown/15 bg-chicken-cream/40' : 'ring-1 ring-inset ring-chicken-brown/10 bg-white'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-chicken-brown">{b.label}</span>
          {escort && <span className="rounded-full bg-chicken-brown/10 px-2 py-0.5 text-[10px] font-semibold text-chicken-brown/70">司機+領隊</span>}
          {sea && <span className="rounded-full bg-chicken-brown/5 px-2 py-0.5 text-xs font-bold text-chicken-brown/70">{sea.name}</span>}
          <label className="flex items-center gap-1 text-xs text-chicken-brown/60">抵達
            <ArrivalTimeSelect seating={sea} slots={slots} value={b.timeSlot}
              onChange={v => patchBatch(b.id, { timeSlot: v })} className="w-28 !py-1" />
          </label>
          {!escort && singleGuest ? (
            <span className="text-xs font-bold text-chicken-brown/70">{total} 人（同總人數）</span>
          ) : (
            <label className="flex items-center gap-1.5 text-xs text-chicken-brown/60">人數
              <NumberStepper size="sm" ariaLabel={`${b.label}人數`} value={b.guests}
                onChange={v => patchBatch(b.id, { guests: v })} />
            </label>
          )}
          <div className="flex-1" />
          <button type="button" onClick={() => setActiveBatchId(b.id)}
            className={`tap h-8 rounded-lg px-2.5 text-xs font-semibold ${active ? 'bg-chicken-red text-white' : 'border border-chicken-brown/15 bg-white text-chicken-brown'}`}>
            {active ? '圈桌中' : escort ? '圈司領桌' : '圈此梯桌'}
          </button>
          {(escort || gBatches.length > 1) && (
            <button type="button" onClick={() => (escort ? removeEscort(b.id) : removeBatch(b.id))}
              aria-label={escort ? '移除司領桌' : '刪除此梯'}
              className="tap flex h-8 w-8 items-center justify-center rounded-lg text-chicken-brown/40 hover:bg-chicken-brown/[0.05] hover:text-chicken-red"><Icon name="trash" size={14} /></button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-chicken-brown/60">桌 {nums.length ? '' : '未圈'}</span>
          {nums.map(n => (
            <span key={n} className="rounded-md bg-chicken-brown/[0.07] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-chicken-brown">{n}</span>
          ))}
          {nums.length > 0 && <span className="text-[11px] font-semibold tabular-nums text-chicken-brown/50">{nums.length} 桌 {seats} 席</span>}
        </div>
        {!escort && <SeatGauge size="xs" circled={seats} needed={batchGuests(b)} className="mt-1.5" />}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 頂部：返回 + 標題 */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <button type="button" onClick={onBack} className="tap inline-flex h-8 items-center gap-0.5 rounded-lg pr-2 text-[13px] font-semibold text-chicken-brown/60 hover:text-chicken-brown">
          <Icon name="chevronLeft" size={14} strokeWidth={2.4} />返回當日總覽
        </button>
        <span className="flex-1" />
        <div className="text-sm font-semibold tabular-nums text-chicken-brown">
          {isNew ? '新增團單' : `編輯：${draft.agencyName || '（未填旅行社）'}`} <span className="text-chicken-brown/50">· {dayLabel(date)}</span>
        </div>
      </div>

      {/* 改期橫幅：由「📅 改期」進入時顯示原日期→新日期，提示須重新圈桌 */}
      {rescheduleFrom && rescheduleFrom !== date && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm">
          <Icon name="calendar" size={18} className="mt-px shrink-0 text-amber-700" />
          <div>
            <div className="font-semibold text-amber-800">改期中：{dayLabel(rescheduleFrom)} → {dayLabel(date)}</div>
            <div className="mt-0.5 text-xs text-amber-700/80">原圈桌位已清空，請於下方為新日期重新圈桌後儲存；未儲存前團單仍留在原日期。</div>
          </div>
        </div>
      )}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-4">
        {/* ===== 左：一頁三段 ===== */}
        <div className="space-y-3">

          {/* ① 旅行社與導遊 */}
          <div className="rounded-xl border border-chicken-brown/10 bg-white p-4">
            <SectionHead n={1} title="旅行社與導遊" done={sec1Done} />
            <AgencyPicker
              agencies={agencies}
              groupReservations={groupReservations}
              value={draft.agencyId}
              agencyName={draft.agencyName}
              onPick={onPickAgency}
              onQuickAdd={() => setQuickAgency({ name: '', phone: '' })}
            />
            {quickAgency && (
              <div className="mt-2 flex items-end gap-2 rounded-lg bg-chicken-cream/50 p-2">
                <Input label="旅行社名稱" value={quickAgency.name} onChange={e => setQuickAgency(q => ({ ...q, name: e.target.value }))} className="flex-1" />
                <Input label="電話" value={quickAgency.phone} onChange={e => setQuickAgency(q => ({ ...q, phone: e.target.value }))} className="w-32" />
                <Button onClick={createQuickAgency}>建立</Button>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="導遊／領隊" placeholder="姓名" value={draft.guideName || ''} onChange={e => setGuideName(e.target.value)} />
              <Input label="導遊電話" inputMode="tel" placeholder="09xx-xxx-xxx" value={draft.guidePhone || ''} onChange={e => setGuidePhone(e.target.value)} />
            </div>
            {guideHint && (
              <p className="mt-1.5 text-xs font-semibold text-[#5b8c1f]">已帶入上次的導遊，可改</p>
            )}
            {draftGuides.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-chicken-brown/45">名冊導遊</span>
                {draftGuides.map(g => (
                  <button key={g.id} type="button" onClick={() => pickRosterGuide(g)}
                    className={`tap rounded-full border px-2.5 py-1 text-[11px] font-bold ${draft.guideId === g.id ? 'border-chicken-red bg-chicken-red/[0.06] text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'}`}>
                    {g.name}{g.phone ? `（${g.phone}）` : ''}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => draft.agencyId ? setQuickGuide({ name: '', phone: '' }) : toast.error('請先選旅行社')}
              className="tap mt-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-chicken-red"><Icon name="plus" size={12} strokeWidth={2.4} />快速新增導遊到名冊</button>
            {quickGuide && (
              <div className="mt-2 flex items-end gap-2 rounded-lg bg-chicken-cream/50 p-2">
                <Input label="導遊姓名" value={quickGuide.name} onChange={e => setQuickGuide(q => ({ ...q, name: e.target.value }))} className="flex-1" />
                <Input label="電話" value={quickGuide.phone} onChange={e => setQuickGuide(q => ({ ...q, phone: e.target.value }))} className="w-32" />
                <Button onClick={createQuickGuide}>建立</Button>
              </div>
            )}
          </div>

          {/* ② 人數 */}
          <div className="rounded-xl border border-chicken-brown/10 bg-white p-4">
            <SectionHead n={2} title="人數" hint="特殊需求有才加" done={sec2Done} />
            <div className="flex flex-wrap items-center gap-2">
              <NumberStepper ariaLabel="總人數" max={500} value={total} onChange={v => patchCount('total', v)} />
              <div className="flex flex-wrap gap-1.5">
                {TOTAL_PRESETS.map(p => (
                  <button key={p.key} type="button" onClick={() => patchCount('total', p.total)}
                    aria-pressed={total === p.total}
                    className={`tap rounded-full border px-3 py-1.5 text-xs font-bold ${total === p.total ? 'border-chicken-red bg-chicken-red/[0.06] text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'}`}>
                    {p.label}<span className="ml-1 tabular-nums text-chicken-brown/45">{p.total}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <div className="label">特殊需求（有才加）</div>
              <div className="flex flex-wrap gap-1.5">
                {SPECIAL_FIELDS.filter(f => !openSpecials.includes(f.key)).map(f => (
                  <button key={f.key} type="button" onClick={() => setOpenSpecials(s => [...s, f.key])}
                    className="tap inline-flex items-center gap-1 rounded-full border border-dashed border-chicken-brown/25 bg-white px-3 py-1.5 text-xs font-bold text-chicken-brown/65 hover:border-chicken-red/50 hover:text-chicken-red">
                    <Icon name={f.icon} size={13} />＋ {f.label}
                  </button>
                ))}
                {openSpecials.length === SPECIAL_FIELDS.length && (
                  <span className="text-xs font-medium text-chicken-brown/40">四項都已加入</span>
                )}
              </div>
              {openSpecials.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {SPECIAL_FIELDS.filter(f => openSpecials.includes(f.key)).map(f => {
                    const over = specialOver.some(o => o.key === f.key)
                    return (
                      <div key={f.key} className={`flex items-center gap-1.5 rounded-xl px-2 py-1.5 ${over ? 'bg-chicken-red/[0.06] ring-1 ring-inset ring-chicken-red/40' : 'bg-chicken-cream/50'}`}>
                        <Icon name={f.icon} size={14} className="text-chicken-brown/60" />
                        <span className="text-xs font-bold text-chicken-brown">{f.label}</span>
                        <NumberStepper size="sm" ariaLabel={`${f.label}人數`} max={500}
                          value={draft.counts?.[f.key] ?? 0} onChange={v => patchCount(f.key, v)} />
                        <button type="button" aria-label={`移除${f.label}`}
                          onClick={() => { setOpenSpecials(s => s.filter(k => k !== f.key)); patchCount(f.key, 0) }}
                          className="tap flex h-6 w-6 items-center justify-center rounded-md text-chicken-brown/40 hover:bg-chicken-brown/10 hover:text-chicken-red">✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
              {specialErr && (
                <p role="alert" className="mt-2 text-xs font-bold text-chicken-red">{specialErr}</p>
              )}
            </div>
          </div>

          {/* ③ 場次與梯次（含圈桌地圖） */}
          <div className="rounded-xl border border-chicken-brown/10 bg-white p-4">
            <SectionHead n={3} title="場次與梯次" hint="兩段用餐可拆第二梯" done={sec3Done} />

            {hasSeatings ? (
              <>
                {allSeatingsShort && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    本日各場次剩餘席位都少於 {total} 人：先選一個場次，再用下方「拆第二梯」分批輪替。
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {seatings.map(s => {
                    const r = seatingRemaining[s.id]
                    const tone = seatingTone(r)
                    const selected = primarySeating?.id === s.id
                    const short = seatingShort(s)
                    const disabled = !selected && (tone === 'closed' || tone === 'full' || (short && !allSeatingsShort))
                    const boxCls = selected
                      ? 'ring-2 ring-chicken-red bg-chicken-red/[0.04] text-chicken-brown'
                      : disabled ? 'ring-1 ring-inset ring-chicken-brown/[0.08] bg-chicken-brown/[0.03] text-chicken-brown/40'
                        : 'ring-1 ring-inset ring-chicken-brown/[0.1] bg-white text-chicken-brown hover:ring-chicken-brown/25'
                    const remainCls = tone === 'closed' || tone === 'full' || short ? 'text-chicken-brown/45' : tone === 'tight' ? 'text-amber-700' : 'text-[#5b8c1f]'
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={disabled}
                        aria-pressed={selected}
                        onClick={() => selectSession(s)}
                        className={`tap rounded-xl p-3 text-left transition-shadow disabled:cursor-not-allowed ${boxCls}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{s.name}</span>
                          <span className="text-xs tabular-nums text-chicken-brown/50">{s.start}–{s.end}</span>
                          {selected && <Icon name="checkCircle" size={16} className="ml-auto text-chicken-red" />}
                        </div>
                        <div className={`mt-1.5 text-xs font-semibold tabular-nums ${remainCls}`}>
                          {tone === 'closed' ? '已關閉'
                            : tone === 'full' ? '已客滿'
                              : short ? `不夠這團 · 剩 ${r?.remainingSeats ?? '—'} 席`
                                : `剩 ${r?.remainingTables ?? '—'} 桌 · ${r?.remainingSeats ?? '—'} 席`}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  尚未設定場次，建議到「設定 → 場次設定」新增；此處先用時段。
                </div>
                <Select label="用餐時段" value={primaryBatch?.timeSlot || ''} onChange={e => primaryBatch && patchBatch(primaryBatch.id, { timeSlot: e.target.value })} options={slots} className="w-40" />
              </div>
            )}

            {/* 多梯拆批提示：各旅客梯次人數總和應等於總人數（司領桌不計） */}
            {gBatches.length > 1 && (() => {
              const assigned = gBatches.reduce((s, b) => s + (Number(b.guests) || 0), 0)
              if (assigned === total) return null
              return (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">
                  各梯人數合計 {assigned} 人，與總人數 {total} 人不符（{assigned < total ? `還有 ${total - assigned} 人未分配` : `多出 ${assigned - total} 人`}）
                </div>
              )
            })()}

            <div className="mt-3 space-y-2">
              {gBatches.map(b => renderBatchRow(b, false))}
              {escortBatch && renderBatchRow(escortBatch, true)}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              {addingBatch === 'list' ? renderNewBatchPicker() : (
                <>
                  <button type="button" onClick={() => setAddingBatch('list')} className="tap inline-flex items-center gap-0.5 text-xs font-semibold text-chicken-red"><Icon name="plus" size={12} strokeWidth={2.4} />拆第二梯（兩段用餐輪替）</button>
                  {!escortBatch && (
                    <button type="button" onClick={addEscort} className="tap inline-flex items-center gap-1 text-xs font-semibold text-chicken-brown/70 hover:text-chicken-red"><Icon name="bus" size={13} />加司領桌（司機 / 領隊，不計入總人數）</button>
                  )}
                </>
              )}
            </div>

            {/* 圈桌地圖：就在本段展開，不再翻頁。md 以上左圖右側欄；md 以下側欄在圖**上方**——
                店員先看「夠不夠坐」的數字，再決定點哪張桌，不要先點完才捲下去看結果。 */}
            <div className="mt-3 border-t border-chicken-brown/10 pt-3">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-[200px] text-sm font-semibold text-chicken-brown">
                  圈選座位 <span className="text-xs font-medium text-chicken-brown/50">· {dayLabel(date)} 規劃，非今日即時</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={autoSuggest} className="tap inline-flex h-8 items-center gap-1 rounded-[9px] border border-chicken-brown/15 bg-white px-3 text-xs font-semibold text-chicken-brown"><Icon name="target" size={14} />一鍵推薦桌位</button>
                  <SegmentedControl size="sm" ariaLabel="樓層" value={floor} onChange={setFloor} options={[{ key: '1F', label: '1F' }, { key: '2F', label: '2F' }]} />
                </div>
              </div>

              {/* DOM 順序＝側欄在前（md 以下自然落在圖上方）；md 以上用 order 換回「左圖右側欄」 */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_18rem] md:items-start">
                <aside className="md:order-2">
                  <BatchSeatPanel
                    batchLabel={activeBatch?.label || ''}
                    seatingLabel={activeSeatingLabel}
                    circled={seatsOf(selectedTables)}
                    tableCount={selectedTables.length}
                    needed={activeBatch ? batchGuests(activeBatch) : 0}
                    tableNumbers={selectedTables}
                    onRemoveTable={removeCircledTable}
                    chips={batchChips}
                    activeBatchId={activeBatchId}
                    onSelectBatch={setActiveBatchId}
                    onAddBatch={() => setAddingBatch('panel')}
                    addPicker={addingBatch === 'panel' ? renderNewBatchPicker() : null}
                    hasEscort={!!escortBatch}
                    onToggleEscort={() => (escortBatch ? removeEscort(escortBatch.id) : addEscort())}
                    badTables={outCircledTables}
                    dupTables={dupTables}
                    heldSeats={heldSeats}
                  />
                </aside>
                <div className="min-h-[360px] overflow-hidden rounded-lg border border-chicken-brown/5 md:order-1" style={{ background: '#faf8f5' }}>
                  <FloorMap
                    floor={floor}
                    tables={tables}
                    settings={settings}
                    planningMode
                    selectedTables={selectedTables}
                    blockedTables={blockedTables}
                    mapDate={date}
                    fixtures={fixtures}
                    zones={zones}
                    onSelectTable={toggleTable}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 其他（不同時機才用得到的事，收起來） */}
          <div className="rounded-xl border border-chicken-brown/10 bg-white p-4">
            <h3 className="mb-2.5 text-sm font-semibold text-chicken-brown">其他</h3>
            <div className="space-y-2">
              <Disclosure title="🚌 遊覽車資訊" defaultOpen={!!(bus.plate || bus.phone || bus.eta)}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input label="車號" placeholder="例：KAA-1234" value={bus.plate} onChange={e => patchBus({ plate: e.target.value })} />
                  <Input label="司機電話" inputMode="tel" placeholder="09xx-xxx-xxx" value={bus.phone} onChange={e => patchBus({ phone: e.target.value })} />
                  <Input label="預計抵達" type="time" value={bus.eta} onChange={e => patchBus({ eta: e.target.value })} />
                </div>
              </Disclosure>
              <Disclosure title="📝 備註（過敏、包場、加菜…）" defaultOpen={!!(draft.notes || '').trim()}>
                <Textarea value={draft.notes || ''} onChange={e => patchDraft({ notes: e.target.value })} placeholder="會印在當日總表上" />
              </Disclosure>
              {/* 消費金額：建單時還沒結帳，只有「編輯既有已落地團單」才出現 */}
              {!isNew && draft.id && (
                <Disclosure title="💰 消費金額（結帳後回填）" defaultOpen={(Number(draft.spend) || 0) > 0}>
                  <NumberStepper ariaLabel="消費金額" max={99999} step={100}
                    value={draft.spend ?? 0} onChange={v => patchDraft({ spend: v })} />
                </Disclosure>
              )}
            </div>
            {isNew && <p className="mt-2 text-xs text-chicken-brown/50">消費金額在結帳後到團單詳情回填，建單時不出現。</p>}
          </div>
        </div>

        {/* ===== 右：即時摘要 + 檢查清單（md 以上 sticky）===== */}
        <aside className="mt-3 md:sticky md:top-2 md:mt-0">
          <GroupEditorSummary
            agencyName={draft.agencyName}
            guideName={draft.guideName}
            guidePhone={draft.guidePhone}
            dateLabel={dayLabel(date)}
            seatingLabel={primarySeating ? primarySeating.name : (primaryBatch?.timeSlot || '')}
            batchCount={gBatches.length}
            total={total}
            specialsText={specialsText}
            tableNumbers={allTableNumbers}
            escortTables={escortBatch?.tableNumbers || []}
            heldSeats={heldSeats}
            checks={checks}
          >
            <div className="space-y-2">
              <Button onClick={save} disabled={!canSave || busy} className="w-full justify-center">{busy ? '儲存中…' : saveLabel}</Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)} className="w-full justify-center">回傳單</Button>
              <button type="button" onClick={onBack} className="tap w-full rounded-[10px] py-2 text-sm font-semibold text-chicken-brown/60 hover:text-chicken-brown">先不存，回總覽</button>
              {!isNew && (
                <button type="button" onClick={doDelete} className="tap inline-flex w-full items-center justify-center gap-1 rounded-[10px] py-2 text-sm font-semibold text-chicken-red hover:bg-chicken-red/[0.06]"><Icon name="trash" size={14} />刪除團單</button>
              )}
            </div>
          </GroupEditorSummary>
        </aside>
      </div>

      {/* md 以下：底部 sticky 條（席位 + 儲存）。檢查清單在上方摘要卡裡已完整呈現。 */}
      <div className="sticky bottom-0 z-10 -mx-3 flex items-center gap-3 border-t border-chicken-brown/10 bg-chicken-cream/95 px-3 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 md:hidden">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-chicken-brown/55">席位（總人數 / 已圈席位）</div>
          <div className={`text-sm font-bold tabular-nums ${total > 0 && heldSeats < total ? 'text-chicken-red' : 'text-chicken-brown'}`}>{total} / {heldSeats}</div>
        </div>
        <div className="flex-1" />
        <Button onClick={save} disabled={!canSave || busy}>{busy ? '儲存中…' : saveLabel}</Button>
      </div>
      {sheetOpen && (
        <GroupSheet group={draft} tables={tables} store={settings} fixtureSource={fixtures} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  )
}
