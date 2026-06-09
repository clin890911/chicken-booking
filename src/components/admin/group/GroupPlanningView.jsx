import { useMemo, useState, useEffect, useRef } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { Button, Input, Select, Textarea } from '../../ui'
import DatePicker from '../../booking/DatePicker'
import FloorMap from '../floormap/FloorMap'
import GroupSheet from './GroupSheet'
import { generateTimeSlots, todayStr, dayLabel } from '../../../utils/timeSlots'
import { groupTableNumbers } from '../../../utils/capacity'
import * as groupReservationService from '../../../services/groupReservationService'

const COUNT_FIELDS = [
  { key: 'total', label: '總人數' },
  { key: 'vegetarian', label: '素食' },
  { key: 'child', label: '兒童' },
  { key: 'mobility', label: '行動不便' },
  { key: 'wheelchair', label: '輪椅' },
]

// 預排規劃：日期維度。左側列出該日團單，右側為編輯器（資料 + 梯次 + 平面圖圈桌）。
// 圈桌存檔走 reserveGroupTables（線上時後端交易做多裝置原子衝突把關）。
export default function GroupPlanningView() {
  const {
    groupReservations, agencies, guides, tables, bookings, settings,
    addGroupReservation, reserveGroupTables, setGroupStatus, removeGroupReservation,
    addAgency, addGuide,
  } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

  const [date, setDate] = useState(todayStr())
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [activeBatchId, setActiveBatchId] = useState(null)
  const [floor, setFloor] = useState('1F')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [quickAgency, setQuickAgency] = useState(null) // { name, phone }
  const [quickGuide, setQuickGuide] = useState(null)
  const creatingRef = useRef(false) // 同步鎖：擋住 setState 尚未 re-render 前的連點
  const savingRef = useRef(false)

  const slots = useMemo(() => generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval), [settings])
  const dayGroups = useMemo(
    () => groupReservations.filter(g => g.date === date).sort((a, b) => (a.agencyName || '').localeCompare(b.agencyName || '')),
    [groupReservations, date],
  )
  const activeAgencies = useMemo(() => agencies.filter(a => !a.archived), [agencies])
  const draftGuides = useMemo(() => guides.filter(g => !g.archived && g.agencyId === draft?.agencyId), [guides, draft?.agencyId])

  // 載入選中的團到 draft
  useEffect(() => {
    if (!selectedId) { setDraft(null); setActiveBatchId(null); return }
    const g = groupReservations.find(x => x.id === selectedId)
    if (g) {
      setDraft(JSON.parse(JSON.stringify(g)))
      setActiveBatchId(prev => (g.batches.some(b => b.id === prev) ? prev : g.batches[0]?.id || null))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const activeBatch = draft?.batches?.find(b => b.id === activeBatchId) || null
  const selectedTables = activeBatch?.tableNumbers || []

  const capByNum = useMemo(() => {
    const m = {}; tables.forEach(t => { m[t.number] = t.capacity }); return m
  }, [tables])
  const seatsOf = (nums) => (nums || []).reduce((s, n) => s + (capByNum[n] || 0), 0)

  // 規劃用：被他團佔用 / 被當日一般訂位指派 的桌（不可選）
  const blockedTables = useMemo(() => {
    if (!activeBatch) return []
    const conflictMap = groupReservationService.tableConflictsForBatch({
      date, timeSlot: activeBatch.timeSlot, settings, excludeGroupId: selectedId, bookings,
    })
    const blocked = new Set(Object.keys(conflictMap))
    return [...blocked].filter(n => !selectedTables.includes(n))
  }, [activeBatch, date, settings, selectedId, selectedTables, bookings])

  const heldSeats = useMemo(
    () => (draft ? groupTableNumbers(draft).reduce((s, n) => s + (capByNum[n] || 0), 0) : 0),
    [draft, capByNum],
  )

  // === draft 編輯 helpers ===
  const patchDraft = (patch) => setDraft(d => ({ ...d, ...patch }))
  const patchCount = (key, val) => setDraft(d => ({ ...d, counts: { ...d.counts, [key]: Number(val) || 0 } }))
  const patchBatch = (batchId, patch) => setDraft(d => ({ ...d, batches: d.batches.map(b => b.id === batchId ? { ...b, ...patch } : b) }))
  const addBatch = () => setDraft(d => {
    const n = d.batches.length + 1
    const nb = { id: 'BT' + Date.now().toString(36) + n, label: `第${['一', '二', '三', '四'][n - 1] || n}梯`, timeSlot: slots[0] || '11:00', tableNumbers: [], guests: 0, note: '' }
    setActiveBatchId(nb.id)
    return { ...d, batches: [...d.batches, nb] }
  })
  const removeBatch = (batchId) => setDraft(d => {
    const batches = d.batches.filter(b => b.id !== batchId)
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

  // === 動作 ===
  const createNew = () => {
    if (creatingRef.current) return // 同步鎖：擋連點（setState 尚未 re-render 前）
    // 已有未完成空白草稿 → 直接選取並提示，不再產生新空白團單
    const blank = dayGroups.find(groupReservationService.isBlankGroup)
    if (blank) {
      setSelectedId(blank.id)
      toast.info('已有一筆未完成的空白團單，請先完成或刪除')
      return
    }
    creatingRef.current = true
    setCreating(true)
    try {
      const g = addGroupReservation({ date, batches: [{ label: '第一梯', timeSlot: slots[0] || '11:00', tableNumbers: [], guests: 0 }], counts: {} })
      setSelectedId(g.id)
    } finally {
      // 短暫鎖定，避免 addGroupReservation→refresh→re-render 前的快速重按
      setTimeout(() => { creatingRef.current = false; setCreating(false) }, 500)
    }
  }

  const save = async () => {
    if (!draft) return
    if (savingRef.current) return // 防連點
    const err0 = groupReservationService.validateGroupForSave(draft, capByNum)
    if (err0) return toast.error(err0)
    // 多梯次（兩段用餐）總人數可大於保留席數（輪替），但明確提示確認
    const total = Number(draft.counts?.total) || 0
    if ((draft.batches || []).length > 1 && total > heldSeats) {
      toast.info(`提醒：總人數 ${total} 大於保留席數 ${heldSeats}，將以多梯次輪替（請確認梯次安排）`)
    }
    savingRef.current = true
    setBusy(true)
    try {
      await reserveGroupTables(selectedId, {
        agencyId: draft.agencyId || null,
        agencyName: draft.agencyName || '',
        guideId: draft.guideId || null,
        guideName: draft.guideName || '',
        guidePhone: draft.guidePhone || '',
        batches: draft.batches,
        counts: draft.counts,
        allergyText: draft.allergyText || '',
        tableSideNeeds: draft.tableSideNeeds || '',
        busInfo: draft.busInfo || '',
        notes: draft.notes || '',
        spend: Number(draft.spend) || 0,
        status: draft.status === 'planned' ? 'confirmed' : draft.status,
      })
      toast.success('✅ 團單已儲存')
    } catch (err) {
      if (err?.status === 409) toast.error('桌位衝突：' + (err.message || '已被其他團或現場訂位佔用，請重新圈桌'))
      else toast.error('儲存失敗：' + (err?.message || '未知錯誤'))
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  const onSelectAgency = (agencyId) => {
    const a = activeAgencies.find(x => x.id === agencyId)
    patchDraft({ agencyId: agencyId || null, agencyName: a?.name || '', guideId: null, guideName: '', guidePhone: '' })
  }
  const onSelectGuide = (guideId) => {
    const g = draftGuides.find(x => x.id === guideId)
    patchDraft({ guideId: guideId || null, guideName: g?.name || '', guidePhone: g?.phone || '' })
  }
  const createQuickAgency = () => {
    if (!quickAgency?.name?.trim()) return toast.error('請填旅行社名稱')
    const a = addAgency(quickAgency)
    patchDraft({ agencyId: a.id, agencyName: a.name })
    setQuickAgency(null)
    toast.success('已新增旅行社')
  }
  const createQuickGuide = () => {
    if (!quickGuide?.name?.trim()) return toast.error('請填導遊姓名')
    if (!draft?.agencyId) return toast.error('請先選旅行社')
    const g = addGuide({ ...quickGuide, agencyId: draft.agencyId })
    patchDraft({ guideId: g.id, guideName: g.name, guidePhone: g.phone || '' })
    setQuickGuide(null)
    toast.success('已新增導遊')
  }

  return (
    <div className="space-y-3">
      {/* 日期 + 新增 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-sm font-bold text-chicken-brown">預排日期：{dayLabel(date)}</div>
          <Button onClick={createNew} disabled={creating}>➕ 新增團單</Button>
        </div>
        <DatePicker value={date} onChange={d => { setDate(d); setSelectedId(null) }} maxDaysAhead={Math.max(60, settings.maxDaysAhead || 30)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3">
        {/* 左：該日團單列表 */}
        <div className="space-y-2">
          {dayGroups.length === 0 && <div className="text-sm text-chicken-brown/50 p-3">這天還沒有團單</div>}
          {dayGroups.map(g => (
            <button key={g.id} onClick={() => setSelectedId(g.id)}
              className={`w-full text-left rounded-xl border-2 p-3 ${selectedId === g.id ? 'border-indigo-500 bg-indigo-50' : 'border-chicken-brown/10 bg-white'}`}>
              <div className="font-bold text-chicken-brown text-sm">🚌 {g.agencyName || '（未填旅行社）'}</div>
              <div className="text-xs text-chicken-brown/60 mt-0.5">
                {(g.batches || []).map(b => `${b.timeSlot}`).join('/')} · {g.counts?.total || 0} 人 · {groupTableNumbers(g).length} 桌
              </div>
            </button>
          ))}
        </div>

        {/* 右：編輯器 */}
        {!draft ? (
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-8 text-center text-chicken-brown/50">
            選擇左側團單或「新增團單」開始預排
          </div>
        ) : (
          <div className="space-y-3">
            {/* 旅行社 / 導遊 */}
            <div className="bg-white rounded-xl border border-chicken-brown/10 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Select label="旅行社" value={draft.agencyId || ''} onChange={e => onSelectAgency(e.target.value)}
                    options={[{ value: '', label: '— 選擇旅行社 —' }, ...activeAgencies.map(a => ({ value: a.id, label: a.name }))]} />
                  <button onClick={() => setQuickAgency({ name: '', phone: '' })} className="text-xs text-chicken-red font-bold mt-1">＋ 快速新增旅行社</button>
                </div>
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

            {/* 人數結構 */}
            <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
              <h3 className="font-bold text-chicken-brown mb-2 text-sm">人數結構</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {COUNT_FIELDS.map(f => (
                  <Input key={f.key} label={f.label} type="number" inputMode="numeric" min={0}
                    value={draft.counts?.[f.key] ?? 0} onChange={e => patchCount(f.key, e.target.value)} />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <Input label="過敏" value={draft.allergyText || ''} onChange={e => patchDraft({ allergyText: e.target.value })} placeholder="例：花生、海鮮" />
                <Input label="桌邊需求" value={draft.tableSideNeeds || ''} onChange={e => patchDraft({ tableSideNeeds: e.target.value })} placeholder="例：剪雞肉、長輩軟食" />
                <Input label="遊覽車 / 司機" value={draft.busInfo || ''} onChange={e => patchDraft({ busInfo: e.target.value })} placeholder="車號 / 司機電話" />
                <Input label="消費金額（結帳後回填）" type="number" inputMode="numeric" min={0} value={draft.spend ?? 0} onChange={e => patchDraft({ spend: Number(e.target.value) || 0 })} />
              </div>
              <Textarea label="備註" value={draft.notes || ''} onChange={e => patchDraft({ notes: e.target.value })} className="mt-2" />
            </div>

            {/* 梯次 */}
            <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-chicken-brown text-sm">梯次（兩段用餐可加第二梯）</h3>
                <button onClick={addBatch} className="text-xs text-chicken-red font-bold">＋ 新增梯次</button>
              </div>
              <div className="space-y-2">
                {draft.batches.map(b => (
                  <div key={b.id} className={`rounded-lg border-2 p-2 ${activeBatchId === b.id ? 'border-indigo-500 bg-indigo-50' : 'border-chicken-brown/10'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input className="w-24" value={b.label} onChange={e => patchBatch(b.id, { label: e.target.value })} />
                      <Select value={b.timeSlot} onChange={e => patchBatch(b.id, { timeSlot: e.target.value })} options={slots} className="w-28" />
                      <Input className="w-20" type="number" inputMode="numeric" min={0} value={b.guests} onChange={e => patchBatch(b.id, { guests: Number(e.target.value) || 0 })} placeholder="人數" />
                      <span className="text-xs text-chicken-brown/60">桌 {(b.tableNumbers || []).join('、') || '未圈'}</span>
                      <div className="flex-1" />
                      <button onClick={() => setActiveBatchId(b.id)} className={`text-xs px-2.5 py-1 rounded-lg font-bold ${activeBatchId === b.id ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-chicken-brown/15 text-chicken-brown'}`}>
                        {activeBatchId === b.id ? '圈桌中' : '圈此梯桌'}
                      </button>
                      {draft.batches.length > 1 && (
                        <button onClick={() => removeBatch(b.id)} className="text-xs text-chicken-red font-bold">刪</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 平面圖圈桌（規劃模式） */}
            <div className="bg-indigo-50 rounded-xl border-2 border-indigo-300 p-3"
              style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 12px, rgba(99,102,241,0.05) 12px, rgba(99,102,241,0.05) 24px)' }}>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div>
                  <div className="text-sm font-black text-indigo-700">📐 規劃模式 · {dayLabel(date)}（非今日即時）</div>
                  <div className="text-xs text-indigo-600/80">
                    {activeBatch ? `圈桌中：${activeBatch.label} ${activeBatch.timeSlot}` : '請於上方選一個梯次'}
                  </div>
                  {activeBatch && (
                    <div className="text-xs font-bold text-indigo-700 mt-0.5">
                      已選 {selectedTables.length ? selectedTables.join('、') : '（尚未圈桌）'}
                      {selectedTables.length ? `，合計 ${seatsOf(selectedTables)} 席` : ''}
                      <span className="font-normal text-indigo-600/70"> · 全團保留 {heldSeats} 席</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {['1F', '2F'].map(f => (
                    <button key={f} onClick={() => setFloor(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 ${floor === f ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-indigo-200 text-indigo-700'}`}>{f}</button>
                  ))}
                </div>
              </div>
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

            {/* 動作列 */}
            <div className="bg-white rounded-xl border border-chicken-brown/10 p-3 flex flex-wrap gap-2 items-center">
              <Button onClick={save} disabled={busy} className="flex-1 min-w-[160px]">{busy ? '儲存中…' : '💾 儲存團單（含衝突檢查）'}</Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>🖨 回傳單</Button>
              <button
                onClick={async () => {
                  const idToDelete = selectedId // 快照：避免確認期間切換選取而刪錯團單
                  const ok = await confirm('刪除後無法復原，確定要刪除這筆團單嗎？', { title: '刪除團單', confirmLabel: '刪除', danger: true })
                  if (ok && idToDelete === selectedId) { removeGroupReservation(idToDelete); setSelectedId(null); toast.info('已刪除團單') }
                }}
                className="px-3 py-2 rounded-xl text-sm font-bold text-chicken-red border-2 border-chicken-red/30">刪除</button>
            </div>
          </div>
        )}
      </div>

      {sheetOpen && draft && (
        <GroupSheet group={draft} tables={tables} store={settings} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  )
}
