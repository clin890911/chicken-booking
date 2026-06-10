import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { generateTimeSlots, todayStr } from '../../../utils/timeSlots'
import { totalActiveSeats } from '../../../utils/capacity'
import { summarizeGroupMonth, buildGroupDaySummary } from '../../../utils/groupDaySummary'
import * as groupReservationService from '../../../services/groupReservationService'
import GroupCalendar from './GroupCalendar'
import GroupDayPanel from './GroupDayPanel'
import GroupDaySheet from './GroupDaySheet'
import GroupEditorStage from './GroupEditorStage'

const PURGE_FLAG = 'chicken_group_blank_purge_v1'

// 預排規劃：一頁式主控台（月曆 + 當日總覽）⟷ 編輯精靈。
// 草稿優先：新團單在記憶體編輯，填好按儲存才落地（杜絕空白團單）。
// 編輯器以 key（new 或 group.id）強制 remount，故 draft 以 initialGroup 初始化即可。
export default function GroupPlanningView({ onGoToday }) {
  const {
    groupReservations, agencies, guides, tables, bookings, settings,
    reserveGroupTables, removeGroupReservation, addAgency, addGuide,
    createAndReserveGroup, purgeBlankGroups,
  } = useBooking()
  const toast = useToast()

  const today = todayStr()
  const [selectedDate, setSelectedDate] = useState(today)
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date(today + 'T00:00:00')
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [editorGroup, setEditorGroup] = useState(null) // 傳給編輯器的初始資料（既有團複本 或 空白範本）
  const [editorIsNew, setEditorIsNew] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  // 首次進入清除既有殘留空白團單（草稿優先改版前的舊資料），每裝置一次。
  useEffect(() => {
    if (localStorage.getItem(PURGE_FLAG) === '1') return
    const n = purgeBlankGroups()
    localStorage.setItem(PURGE_FLAG, '1')
    if (n) toast.info(`已清除 ${n} 筆未完成的空白團單`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const slots = useMemo(
    () => generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval),
    [settings],
  )
  const totalSeats = useMemo(() => totalActiveSeats(tables), [tables])

  const dayGroups = useMemo(
    () => groupReservations
      .filter(g => g.date === selectedDate)
      .sort((a, b) => (a.agencyName || '').localeCompare(b.agencyName || '')),
    [groupReservations, selectedDate],
  )

  // 月曆：整月團體彙總（只吃 groups+tables，不碰 bookings）
  const monthSummary = useMemo(
    () => summarizeGroupMonth(groupReservations, tables, monthCursor.year, monthCursor.month, settings),
    [groupReservations, tables, monthCursor, settings],
  )

  // 當日總覽：抵達時間軸 / 備餐重點 / 警示 / 各場次容量（吃 bookings 做散客×團客合併）
  const daySummary = useMemo(
    () => buildGroupDaySummary({ groupReservations, bookings, tables, date: selectedDate, settings }),
    [groupReservations, bookings, tables, selectedDate, settings],
  )

  // === 轉場 ===
  const openExisting = (id) => {
    const g = groupReservations.find(x => x.id === id)
    if (!g) return
    setEditorGroup(g)
    setEditorIsNew(false)
  }

  // seatingId 可選：由當日總覽的「某場次 ＋新增團單」帶入，預先鎖定主梯次的場次（= 場次.start）。
  // 注意 Hero 的純「新增團單」按鈕會把事件物件當參數傳入，故先正規化成字串或 null。
  const openNewDraft = (seatingId) => {
    const sid = typeof seatingId === 'string' ? seatingId : null
    const seating = sid ? (settings.seatings || []).find(s => s.id === sid) : null
    const firstBatchId = 'BT' + Date.now().toString(36)
    setEditorGroup({
      date: selectedDate,
      schemaVersion: groupReservationService.GROUP_SCHEMA_VERSION,
      agencyId: null, agencyName: '', guideId: null, guideName: '', guidePhone: '',
      batches: [{ id: firstBatchId, label: '第一梯', timeSlot: seating?.start || slots[0] || '11:00', tableNumbers: [], guests: 0, note: '' }],
      counts: { total: 0, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '', tableSideNeeds: '', busInfo: '', notes: '', spend: 0,
      status: 'planned',
    })
    setEditorIsNew(true)
  }

  // 複製團單為新草稿（清空桌號，須重新圈桌）。
  const duplicateGroupToDraft = (sourceId, targetDate) => {
    const src = groupReservations.find(g => g.id === sourceId)
    if (!src) return
    const target = targetDate || selectedDate
    const draft = groupReservationService.cloneGroupForDuplicate(src, { date: target })
    if (target !== selectedDate) setSelectedDate(target)
    setEditorGroup(draft)
    setEditorIsNew(true)
    toast.info('已複製為新團單草稿，請重新圈桌後儲存')
  }

  const backToConsole = () => { setEditorGroup(null); setEditorIsNew(false) }

  // 編輯精靈整頁接管（與既有 stage==='editor' 行為一致）。
  if (editorGroup) {
    return (
      <GroupEditorStage
        key={editorIsNew ? 'new' : editorGroup.id}
        initialGroup={editorGroup}
        isNew={editorIsNew}
        date={selectedDate}
        slots={slots}
        tables={tables}
        settings={settings}
        bookings={bookings}
        agencies={agencies}
        guides={guides}
        groupReservations={groupReservations}
        onBack={backToConsole}
        onSaved={backToConsole}
        onDeleted={backToConsole}
        reserveExisting={reserveGroupTables}
        createGroup={createAndReserveGroup}
        removeGroup={removeGroupReservation}
        addAgency={addAgency}
        addGuide={addGuide}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] gap-3 items-start">
      <GroupCalendar
        value={selectedDate}
        onSelect={setSelectedDate}
        cursor={monthCursor}
        onCursorChange={setMonthCursor}
        monthSummary={monthSummary}
        settings={settings}
        totalSeats={totalSeats}
      />
      <GroupDayPanel
        date={selectedDate}
        daySummary={daySummary}
        dayGroups={dayGroups}
        isToday={selectedDate === today}
        onSelectGroup={openExisting}
        onNewGroup={openNewDraft}
        onDuplicate={duplicateGroupToDraft}
        onGoToday={onGoToday}
        onPrintSheet={() => setSheetOpen(true)}
      />

      {sheetOpen && (
        <GroupDaySheet
          date={selectedDate}
          daySummary={daySummary}
          groups={dayGroups}
          store={settings}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}
