import { useMemo, useState, useRef } from 'react'
import { useToast, useConfirm } from '../../ui/Toast'
import { Button, Input, Select, Textarea } from '../../ui'
import SeatGauge from '../../ui/SeatGauge'
import FloorMap from '../floormap/FloorMap'
import GroupSheet from '../group/GroupSheet'
import AgencyPicker from '../group/AgencyPicker'
import { dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { groupTableNumbers, remainingTablesForSeating } from '../../../utils/capacity'
import { suggestTablesForBatch } from '../../../utils/suggestTables'
import * as groupReservationService from '../../../services/groupReservationService'

const COUNT_FIELDS = [
  { key: 'total', label: '總人數' },
  { key: 'vegetarian', label: '素食' },
  { key: 'child', label: '兒童' },
  { key: 'mobility', label: '行動不便' },
  { key: 'wheelchair', label: '輪椅' },
]

const PAGES = [
  { n: 1, label: '團體資訊' },
  { n: 2, label: '圈選座位' },
]

const BATCH_LABELS = ['一', '二', '三', '四', '五', '六']

// 場次卡剩餘色調
function seatingTone(r) {
  if (!r || r.closed) return 'closed'
  if ((r.remainingSeats ?? 0) <= 0) return 'full'
  if ((r.remainingTables ?? 0) <= 2 || (r.totalSeats > 0 && r.remainingSeats < r.totalSeats * 0.15)) return 'tight'
  return 'ok'
}

// 階段三：單一團單編輯器（2 頁式）。Page1 團體資訊（旅行社+人數+預選場次/剩餘提示）→ Page2 圈座位（席次量表+一鍵推薦+加梯次+直接存檔）。
export default function GroupEditorStage({
  initialGroup, isNew, date, slots,
  tables, settings, bookings, agencies, guides, groupReservations = [],
  onBack, onSaved, onDeleted,
  reserveExisting, createGroup, removeGroup,
  addAgency, addGuide,
}) {
  const toast = useToast()
  const confirm = useConfirm()

  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(initialGroup)))
  const [step, setStep] = useState(1)
  const [activeBatchId, setActiveBatchId] = useState(draft.batches?.[0]?.id || null)
  const [floor, setFloor] = useState('1F')
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [quickAgency, setQuickAgency] = useState(null)
  const [quickGuide, setQuickGuide] = useState(null)
  const [addingBatch, setAddingBatch] = useState(false)
  const savingRef = useRef(false)

  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const hasSeatings = seatings.length > 0

  const draftGuides = useMemo(
    () => guides.filter(g => !g.archived && g.agencyId === draft.agencyId),
    [guides, draft.agencyId],
  )
  const capByNum = useMemo(() => {
    const m = {}; tables.forEach(t => { m[t.number] = t.capacity }); return m
  }, [tables])
  const seatsOf = (nums) => (nums || []).reduce((s, n) => s + (capByNum[n] || 0), 0)
  // 梯次人數單一來源：單梯 = 第一頁總人數（不重複填）；多梯 = 各梯拆批值
  const batchGuests = (b) => (draft.batches || []).length === 1
    ? (Number(draft.counts?.total) || 0)
    : (Number(b?.guests) || 0)

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

  const blockedTables = useMemo(() => {
    if (!activeBatch) return []
    const conflictMap = groupReservationService.tableConflictsForBatch({
      date, timeSlot: activeBatch.timeSlot, settings, excludeGroupId: draft.id || null, bookings,
    })
    return Object.keys(conflictMap).filter(n => !selectedTables.includes(n))
  }, [activeBatch, date, settings, draft.id, selectedTables, bookings])

  const heldSeats = useMemo(() => groupTableNumbers(draft).reduce((s, n) => s + (capByNum[n] || 0), 0), [draft, capByNum])

  // === draft 編輯 helpers ===
  const patchDraft = (patch) => setDraft(d => ({ ...d, ...patch }))
  // 總人數：單梯次時直接同步主梯 guests（圈位頁不再重複填人數）
  const patchCount = (key, val) => setDraft(d => {
    const counts = { ...d.counts, [key]: Number(val) || 0 }
    const batches = (key === 'total' && (d.batches || []).length === 1)
      ? d.batches.map(b => ({ ...b, guests: counts.total }))
      : d.batches
    return { ...d, counts, batches }
  })
  const patchBatch = (batchId, patch) => setDraft(d => ({ ...d, batches: d.batches.map(b => b.id === batchId ? { ...b, ...patch } : b) }))
  const relabel = (batches) => batches.map((b, i) => ({ ...b, label: `第${BATCH_LABELS[i] || i + 1}梯` }))
  const addBatchForSeating = (s) => setDraft(d => {
    const n = d.batches.length + 1
    // 新梯人數預設 = 總人數扣掉已分配（兩段輪替常見「先坐滿、剩的進第二梯」）
    const total = Number(d.counts?.total) || 0
    const assigned = d.batches.reduce((sum, b) => sum + (Number(b.guests) || 0), 0)
    const nb = { id: 'BT' + Date.now().toString(36) + n, label: `第${BATCH_LABELS[n - 1] || n}梯`, timeSlot: s.start, tableNumbers: [], guests: Math.max(0, total - assigned), note: '' }
    setActiveBatchId(nb.id)
    return { ...d, batches: [...d.batches, nb] }
  })
  const removeBatch = (batchId) => setDraft(d => {
    const batches = relabel(d.batches.filter(b => b.id !== batchId))
    if (activeBatchId === batchId) setActiveBatchId(batches[0]?.id || null)
    return { ...d, batches }
  })
  const toggleTable = (number) => {
    if (!activeBatch) return toast.error('請先選一個梯次再圈桌')
    if (blockedTables.includes(number)) return toast.error(`${number} 已被其他團/訂位佔用`)
    setDraft(d => ({
      ...d,
      batches: d.batches.map(b => {
        if (b.id !== activeBatchId) return b
        const has = b.tableNumbers.includes(number)
        return { ...b, tableNumbers: has ? b.tableNumbers.filter(n => n !== number) : [...b.tableNumbers, number] }
      }),
    }))
  }

  // 預選場次 → 鎖定主梯次的 timeSlot（= 場次.start，可再用詳細時間微調）
  const selectSession = (s) => {
    if (!primaryBatch) return
    patchBatch(primaryBatch.id, { timeSlot: s.start })
    setActiveBatchId(primaryBatch.id)
  }

  // 詳細抵達時間：限制在該梯所屬場次的起訖內（超出會跳到別的場次、造成剩餘量誤判）
  const setBatchTime = (batch, value) => {
    if (!value || !batch) return
    const sea = seatingForSlot(settings, batch.timeSlot)
    if (sea && (value < sea.start || value >= sea.end)) {
      return toast.error(`時間需在「${sea.name}」${sea.start}–${sea.end} 之間；要換場次請直接點場次卡`)
    }
    patchBatch(batch.id, { timeSlot: value })
  }

  // 一鍵推薦桌位（依本梯人數 + 場次，避開 blocked，取最少桌）
  const autoSuggest = () => {
    if (!activeBatch) return toast.error('請先選一個梯次')
    const need = batchGuests(activeBatch) || Number(draft.counts?.total) || 0
    if (need <= 0) return toast.error('請先填本梯用餐人數')
    const { tableNumbers, enough } = suggestTablesForBatch({ tables, headcount: need, blockedTables, capByNum })
    patchBatch(activeBatch.id, { tableNumbers })
    if (enough) toast.success('已自動推薦桌位，可再手動微調')
    else toast.info('本場次可用桌不足以容納本梯人數，已選滿可用桌，請改場次或拆梯次')
  }

  // === 旅行社/導遊 ===
  const onPickAgency = (a) => patchDraft({ agencyId: a.id, agencyName: a.name, guideId: null, guideName: '', guidePhone: '' })
  const onSelectGuide = (guideId) => {
    const g = draftGuides.find(x => x.id === guideId)
    patchDraft({ guideId: guideId || null, guideName: g?.name || '', guidePhone: g?.phone || '' })
  }
  const createQuickAgency = () => {
    if (!quickAgency?.name?.trim()) return toast.error('請填旅行社名稱')
    const a = addAgency(quickAgency)
    patchDraft({ agencyId: a.id, agencyName: a.name, guideId: null, guideName: '', guidePhone: '' })
    setQuickAgency(null)
    toast.success('已新增旅行社')
  }
  const createQuickGuide = () => {
    if (!quickGuide?.name?.trim()) return toast.error('請填導遊姓名')
    if (!draft.agencyId) return toast.error('請先選旅行社')
    const g = addGuide({ ...quickGuide, agencyId: draft.agencyId })
    patchDraft({ guideId: g.id, guideName: g.name, guidePhone: g.phone || '' })
    setQuickGuide(null)
    toast.success('已新增導遊')
  }

  // === 頁面驗證 / 導覽 ===
  const pageError = (p) => {
    if (p === 1) {
      if (!(draft.agencyId || (draft.agencyName || '').trim())) return '請選擇或新增旅行社'
      if ((Number(draft.counts?.total) || 0) <= 0) return '請填寫總人數（需大於 0）'
      if (hasSeatings) {
        if (!primarySeating) return '請選擇一個場次'
        const r = seatingRemaining[primarySeating.id]
        if (r?.closed) return `「${primarySeating.name}」已關閉，請改選其他場次`
        if ((r?.remainingSeats ?? 0) <= 0) return `「${primarySeating.name}」已客滿，請改選其他場次或日期`
      } else if (!primaryBatch?.timeSlot) {
        return '請選擇用餐時段'
      }
    }
    return null
  }
  const goNext = () => {
    const err = pageError(step)
    if (err) return toast.error(err)
    if (step === 1 && primarySeating) {
      const r = seatingRemaining[primarySeating.id]
      const total = Number(draft.counts?.total) || 0
      if (r && total > r.remainingSeats) {
        toast.info(`本場次剩 ${r.remainingSeats} 席、團體 ${total} 人——可在下一頁「新增梯次」分兩批輪替`)
      }
    }
    setStep(s => Math.min(2, s + 1))
  }
  const goPrev = () => setStep(s => Math.max(1, s - 1))

  // === 儲存 / 刪除 ===
  const save = async () => {
    if (savingRef.current) return
    // 單梯人數以第一頁總人數為準（圈位頁不重複填，存檔時強制同步；驗證也用同步後的版本）
    const batchesToSave = draft.batches.length === 1
      ? draft.batches.map(b => ({ ...b, guests: Number(draft.counts?.total) || 0 }))
      : draft.batches
    const err0 = groupReservationService.validateGroupForSave({ ...draft, batches: batchesToSave }, capByNum)
    if (err0) return toast.error(err0)
    const total = Number(draft.counts?.total) || 0
    if ((draft.batches || []).length > 1 && total > heldSeats) {
      toast.info(`提醒：總人數 ${total} 大於保留席數 ${heldSeats}，將以多梯次輪替（請確認梯次安排）`)
    }
    const patch = {
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
      toast.success('✅ 團單已儲存')
    } catch (err) {
      if (err?.status === 409) toast.error('桌位衝突：' + (err.message || '已被其他團或現場訂位佔用，請重新圈桌'))
      else toast.error('儲存失敗：' + (err?.message || '未知錯誤'))
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  const doDelete = async () => {
    const ok = await confirm('刪除後無法復原，確定要刪除這筆團單嗎？', { title: '刪除團單', confirmLabel: '刪除', danger: true })
    if (!ok) return
    if (draft.id) removeGroup(draft.id)
    toast.info('已刪除團單')
    onDeleted()
  }

  return (
    <div className="space-y-3">
      {/* 頂部：返回 + 標題 + 頁籤 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button onClick={onBack} className="text-sm font-bold text-chicken-brown/70 hover:text-chicken-brown">← 返回當日總覽</button>
          <div className="text-sm font-bold text-chicken-brown">
            {isNew ? '新增團單' : `編輯：${draft.agencyName || '（未填旅行社）'}`} · {dayLabel(date)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {PAGES.map((s, i) => (
            <div key={s.n} className="flex items-center gap-1.5 flex-1">
              <button
                onClick={() => { if (s.n === 1 || !pageError(1)) setStep(s.n); else toast.error(pageError(1)) }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold border-2 transition-all w-full justify-center ${
                  step === s.n ? 'bg-indigo-600 border-indigo-600 text-white'
                    : step > s.n ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-chicken-brown/15 text-chicken-brown/60'
                }`}
              >
                <span className="text-[10px] opacity-70">{s.n}.</span>
                {s.label}
              </button>
              {i < PAGES.length - 1 && <span className="text-chicken-brown/20">›</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Page 1：團體資訊（旅行社 + 人數 + 場次） */}
      {step === 1 && (
        <div className="space-y-3">
          {/* 旅行社 / 導遊 */}
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-4 space-y-3">
            <h3 className="font-bold text-chicken-brown text-sm">① 旅行社 / 導遊</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <AgencyPicker
                agencies={agencies}
                groupReservations={groupReservations}
                value={draft.agencyId}
                agencyName={draft.agencyName}
                onPick={onPickAgency}
                onQuickAdd={() => setQuickAgency({ name: '', phone: '' })}
              />
              <div>
                <Select label="導遊" value={draft.guideId || ''} onChange={e => onSelectGuide(e.target.value)}
                  options={[{ value: '', label: '— 選擇導遊 —' }, ...draftGuides.map(g => ({ value: g.id, label: `${g.name}${g.phone ? `（${g.phone}）` : ''}` }))]} />
                <button onClick={() => draft.agencyId ? setQuickGuide({ name: '', phone: '' }) : toast.error('請先選旅行社')} className="text-xs text-chicken-red font-bold mt-1">＋ 快速新增導遊</button>
              </div>
            </div>
            {quickAgency && (
              <div className="flex gap-2 items-end bg-chicken-cream/50 p-2 rounded-lg">
                <Input label="旅行社名稱" value={quickAgency.name} onChange={e => setQuickAgency(q => ({ ...q, name: e.target.value }))} className="flex-1" />
                <Input label="電話" value={quickAgency.phone} onChange={e => setQuickAgency(q => ({ ...q, phone: e.target.value }))} className="w-32" />
                <Button onClick={createQuickAgency}>建立</Button>
              </div>
            )}
            {quickGuide && (
              <div className="flex gap-2 items-end bg-chicken-cream/50 p-2 rounded-lg">
                <Input label="導遊姓名" value={quickGuide.name} onChange={e => setQuickGuide(q => ({ ...q, name: e.target.value }))} className="flex-1" />
                <Input label="電話" value={quickGuide.phone} onChange={e => setQuickGuide(q => ({ ...q, phone: e.target.value }))} className="w-32" />
                <Button onClick={createQuickGuide}>建立</Button>
              </div>
            )}
          </div>

          {/* 人數結構 + 特殊需求 */}
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
            <h3 className="font-bold text-chicken-brown mb-2 text-sm">② 人數結構</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {COUNT_FIELDS.map(f => (
                <Input key={f.key} label={f.label} type="number" inputMode="numeric" min={0}
                  value={draft.counts?.[f.key] ?? 0} onChange={e => patchCount(f.key, e.target.value)} />
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              <Input label="遊覽車 / 司機抵達" value={draft.busInfo || ''} onChange={e => patchDraft({ busInfo: e.target.value })} placeholder="車號 / 司機電話 / 抵達時間" />
              <Input label="消費金額（結帳後回填）" type="number" inputMode="numeric" min={0} value={draft.spend ?? 0} onChange={e => patchDraft({ spend: Number(e.target.value) || 0 })} />
            </div>
            <Textarea label="備註" value={draft.notes || ''} onChange={e => patchDraft({ notes: e.target.value })} className="mt-2" />
          </div>

          {/* 預選場次（剩餘桌/席提示） */}
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
            <h3 className="font-bold text-chicken-brown mb-1 text-sm">③ 預選場次</h3>
            <p className="text-xs text-chicken-brown/55 mb-3">選好主場次後，下一頁再圈座位。兩段用餐可於圈座位頁加第二梯。</p>
            {hasSeatings ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {seatings.map(s => {
                  const r = seatingRemaining[s.id]
                  const tone = seatingTone(r)
                  const selected = primarySeating?.id === s.id
                  const disabled = tone === 'closed' || tone === 'full'
                  const toneCls = selected
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : tone === 'closed' ? 'border-chicken-brown/15 bg-chicken-brown/5 text-chicken-brown/40'
                      : tone === 'full' ? 'border-rose-200 bg-rose-50 text-rose-400'
                        : tone === 'tight' ? 'border-amber-300 bg-amber-50 text-amber-800'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => selectSession(s)}
                      className={`rounded-xl border-2 p-3 text-left transition-all disabled:cursor-not-allowed ${toneCls}`}
                    >
                      <div className="text-sm font-black">{s.name}</div>
                      <div className={`text-xs ${selected ? 'text-white/80' : 'opacity-70'}`}>{s.start}–{s.end}</div>
                      <div className="mt-1.5 text-xs font-bold">
                        {tone === 'closed' ? '🚫 已關閉'
                          : tone === 'full' ? '已客滿'
                            : `剩 ${r?.remainingTables ?? '—'} 桌 / ${r?.remainingSeats ?? '—'} 席`}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-bold text-amber-800">
                  尚未設定場次，建議到「設定 → 場次設定」新增；此處先用時段。
                </div>
                <Select label="用餐時段" value={primaryBatch?.timeSlot || ''} onChange={e => primaryBatch && patchBatch(primaryBatch.id, { timeSlot: e.target.value })} options={slots} className="w-40" />
              </div>
            )}
            {/* 詳細抵達時間：選好場次後可微調（例：午餐第一批 11:40 進場） */}
            {hasSeatings && primarySeating && primaryBatch && (
              <div className="mt-3 flex items-end gap-3 flex-wrap">
                <Input
                  label="預計抵達 / 用餐時間"
                  type="time"
                  value={primaryBatch.timeSlot || primarySeating.start}
                  onChange={e => setBatchTime(primaryBatch, e.target.value)}
                  className="w-44"
                />
                <span className="text-xs text-chicken-brown/55 pb-2.5">
                  可在「{primarySeating.name}」{primarySeating.start}–{primarySeating.end} 內微調，備餐與抵達時間軸都會用這個時間
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Page 2：圈選座位 */}
      {step === 2 && (
        <div className="space-y-3">
          {/* 梯次列 */}
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-chicken-brown text-sm">梯次（兩段用餐可加第二梯）</h3>
            </div>
            {/* 多梯拆批提示：各梯人數總和應等於總人數 */}
            {draft.batches.length > 1 && (() => {
              const total = Number(draft.counts?.total) || 0
              const assigned = draft.batches.reduce((s, b) => s + (Number(b.guests) || 0), 0)
              if (assigned === total) return null
              return (
                <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-bold text-amber-800">
                  各梯人數合計 {assigned} 人，與總人數 {total} 人不符（{assigned < total ? `還有 ${total - assigned} 人未分配` : `多出 ${assigned - total} 人`}）
                </div>
              )
            })()}
            <div className="space-y-2">
              {draft.batches.map(b => {
                const sea = seatingForSlot(settings, b.timeSlot)
                const active = activeBatchId === b.id
                const single = draft.batches.length === 1
                return (
                  <div key={b.id} className={`rounded-lg border-2 p-2 ${active ? 'border-indigo-500 bg-indigo-50' : 'border-chicken-brown/10'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-chicken-brown">{b.label}</span>
                      {sea && (
                        <span className="rounded-full bg-chicken-brown/5 px-2 py-0.5 text-xs font-bold text-chicken-brown/70">{sea.name}</span>
                      )}
                      <label className="flex items-center gap-1 text-xs text-chicken-brown/60">時間
                        <Input className="w-28 !py-1" type="time" value={b.timeSlot || ''} onChange={e => setBatchTime(b, e.target.value)} />
                      </label>
                      {single ? (
                        // 單梯人數 = 第一頁總人數，不重複填
                        <span className="text-xs font-bold text-chicken-brown/70">{Number(draft.counts?.total) || 0} 人（同總人數）</span>
                      ) : (
                        <label className="flex items-center gap-1 text-xs text-chicken-brown/60">人數
                          <Input className="w-16 !py-1" type="number" inputMode="numeric" min={0} value={b.guests} onChange={e => patchBatch(b.id, { guests: Number(e.target.value) || 0 })} />
                        </label>
                      )}
                      <span className="text-xs text-chicken-brown/60">桌 {(b.tableNumbers || []).join('、') || '未圈'}</span>
                      <div className="flex-1" />
                      <button onClick={() => setActiveBatchId(b.id)} className={`text-xs px-2.5 py-1 rounded-lg font-bold ${active ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-chicken-brown/15 text-chicken-brown'}`}>
                        {active ? '圈桌中' : '圈此梯桌'}
                      </button>
                      {draft.batches.length > 1 && (
                        <button onClick={() => removeBatch(b.id)} className="text-xs text-chicken-red font-bold">刪</button>
                      )}
                    </div>
                    <SeatGauge size="xs" circled={seatsOf(b.tableNumbers)} needed={batchGuests(b)} className="mt-1.5" />
                  </div>
                )
              })}
            </div>

            {/* 新增梯次（綁場次） */}
            <div className="mt-2">
              {addingBatch ? (
                <div className="rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-2 space-y-1.5">
                  <div className="text-xs font-bold text-indigo-700">選第二梯的場次：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(hasSeatings ? seatings : []).map(s => {
                      const r = seatingRemaining[s.id]
                      const disabled = r?.closed || (r?.remainingSeats ?? 0) <= 0
                      return (
                        <button key={s.id} disabled={disabled} onClick={() => { addBatchForSeating(s); setAddingBatch(false) }}
                          className="rounded-lg border-2 border-indigo-200 bg-white px-2.5 py-1 text-xs font-bold text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                          {s.name} {s.start}（剩 {r?.remainingSeats ?? '—'} 席）
                        </button>
                      )
                    })}
                    {!hasSeatings && <span className="text-xs text-chicken-brown/50">尚未設定場次</span>}
                  </div>
                  <button onClick={() => setAddingBatch(false)} className="text-xs text-chicken-brown/60 font-bold">取消</button>
                </div>
              ) : (
                <button onClick={() => setAddingBatch(true)} className="text-xs text-chicken-red font-bold">＋ 新增梯次（兩段用餐輪替）</button>
              )}
            </div>
          </div>

          {/* 規劃地圖 */}
          <div className="bg-indigo-50 rounded-xl border-2 border-indigo-300 p-3"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 12px, rgba(99,102,241,0.05) 12px, rgba(99,102,241,0.05) 24px)' }}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="min-w-[200px]">
                <div className="text-sm font-black text-indigo-700">📐 規劃模式 · {dayLabel(date)}（非今日即時）</div>
                <div className="text-xs text-indigo-600/80">
                  {activeBatch ? `圈桌中：${activeBatch.label}${seatingForSlot(settings, activeBatch.timeSlot) ? ' · ' + seatingForSlot(settings, activeBatch.timeSlot).name : ' ' + activeBatch.timeSlot}` : '請於上方選一個梯次'}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={autoSuggest} className="rounded-lg bg-chicken-green px-3 py-1.5 text-xs font-black text-white hover:opacity-90">✨ 一鍵推薦桌位</button>
                {['1F', '2F'].map(f => (
                  <button key={f} onClick={() => setFloor(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 ${floor === f ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-indigo-200 text-indigo-700'}`}>{f}</button>
                ))}
              </div>
            </div>

            {activeBatch && (
              <div className="mb-2 rounded-lg bg-white/70 px-3 py-2">
                <SeatGauge circled={seatsOf(selectedTables)} needed={batchGuests(activeBatch)} />
                <div className="mt-1 text-[11px] font-bold text-indigo-600/70">全團保留 {heldSeats} 席</div>
              </div>
            )}

            <div className="bg-white rounded-lg p-2 min-h-[360px]">
              <FloorMap
                floor={floor}
                tables={tables}
                settings={settings}
                planningMode
                selectedTables={selectedTables}
                blockedTables={blockedTables}
                onSelectTable={toggleTable}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-indigo-700/80">
              <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-indigo-600" />已選</span>
              <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-slate-400" />已被佔</span>
              <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-slate-200" />可選</span>
            </div>
          </div>

          {/* 摘要 + 存檔 */}
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-4 space-y-3">
            <h3 className="font-bold text-chicken-brown text-sm">確認與儲存</h3>
            <dl className="text-sm divide-y divide-chicken-brown/10">
              <div className="flex justify-between py-1.5"><dt className="text-chicken-brown/60">旅行社 / 導遊</dt>
                <dd className="font-bold text-chicken-brown text-right">{draft.agencyName || '（未填）'}{draft.guideName ? ` · ${draft.guideName}` : ''}</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-chicken-brown/60">人數</dt>
                <dd className="font-bold text-chicken-brown text-right">
                  共 {draft.counts?.total || 0} 人
                  {[['素', draft.counts?.vegetarian], ['童', draft.counts?.child], ['行', draft.counts?.mobility], ['輪', draft.counts?.wheelchair]]
                    .filter(([, v]) => v > 0).map(([k, v]) => ` · ${k}${v}`).join('')}
                </dd></div>
              {draft.batches.map(b => {
                const sea = seatingForSlot(settings, b.timeSlot)
                return (
                  <div key={b.id} className="flex justify-between py-1.5"><dt className="text-chicken-brown/60">{b.label} {sea ? `${sea.name} ` : ''}{b.timeSlot}</dt>
                    <dd className="font-bold text-chicken-brown text-right">{batchGuests(b)} 人 · 桌 {(b.tableNumbers || []).join('、') || '未圈'}</dd></div>
                )
              })}
              <div className="flex justify-between py-1.5"><dt className="text-chicken-brown/60">保留席數</dt>
                <dd className="font-bold text-chicken-brown text-right">{heldSeats} 席</dd></div>
              {(draft.allergyText || draft.tableSideNeeds) && (
                <div className="flex justify-between py-1.5"><dt className="text-chicken-brown/60">特殊需求</dt>
                  <dd className="font-bold text-chicken-brown text-right">{[draft.allergyText, draft.tableSideNeeds].filter(Boolean).join('；')}</dd></div>
              )}
            </dl>
            <div className="flex flex-wrap gap-2 items-center pt-1">
              <Button onClick={save} disabled={busy} className="flex-1 min-w-[160px]">{busy ? '儲存中…' : '💾 儲存團單（含衝突檢查）'}</Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>🖨 回傳單</Button>
              {!isNew && (
                <button onClick={doDelete} className="px-3 py-2 rounded-xl text-sm font-bold text-chicken-red border-2 border-chicken-red/30">刪除</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 頁面導覽列 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-3 flex items-center gap-2">
        <button onClick={goPrev} disabled={step === 1}
          className="px-4 py-2 rounded-xl text-sm font-bold border-2 border-chicken-brown/15 text-chicken-brown disabled:opacity-40">← 上一頁</button>
        <div className="flex-1" />
        {step < 2
          ? <Button onClick={goNext}>下一步：圈選座位 →</Button>
          : <Button onClick={save} disabled={busy}>{busy ? '儲存中…' : '💾 儲存'}</Button>}
      </div>

      {sheetOpen && (
        <GroupSheet group={draft} tables={tables} store={settings} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  )
}
