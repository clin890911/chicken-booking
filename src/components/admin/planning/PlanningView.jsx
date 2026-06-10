import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { generateTimeSlots, todayStr, addDays, formatDate, dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { totalActiveSeats, CAPACITY_EXCLUDED_STATUSES } from '../../../utils/capacity'
import { summarizeGroupMonth, buildGroupDaySummary } from '../../../utils/groupDaySummary'
import * as groupReservationService from '../../../services/groupReservationService'
import GroupCalendar from './GroupCalendar'
import GroupDayPanel from './GroupDayPanel'
import GroupDaySheet from './GroupDaySheet'
import GroupDetailStage from './GroupDetailStage'
import GroupEditorStage from './GroupEditorStage'
import SlotMapPanel from './SlotMapPanel'

const PURGE_FLAG = 'chicken_group_blank_purge_v1'

// 規劃：未來日一頁式主控台，多態同頁——
//   pane='day'（預設）：左月曆 + 右當日總覽（團體預排骨架）
//   pane='map'：精簡日期列 + 排位地圖全寬（散客×團客同框、散客預先配桌；
//               地圖塞 420px 右欄會不可用，故獨佔全寬）
//   detailGroupId 有值：團單詳情頁（唯讀確認 + 回傳單；點團卡 / 儲存後落地於此）
//   editorGroup 有值：團單編輯精靈整頁接管（優先級最高，照舊）
// 詳情頁吃 live group（依 id 即時查 context），編輯器吃 draft 複本——
// 編輯儲存回詳情頁時自動顯示新資料；團被刪/同步移除時詳情自動退回主控台。
// 兩態共享 selectedDate；pane 切換用純條件渲染（外層 AdminPage 已有 key=tab 動畫，不再疊動畫）。
// 草稿優先：新團單在記憶體編輯，填好按儲存才落地（杜絕空白團單）。
// 編輯器以 key（new 或 group.id）強制 remount，故 draft 以 initialGroup 初始化即可。
export default function PlanningView({ onGoToday }) {
  const {
    groupReservations, agencies, guides, tables, bookings, settings,
    reserveGroupTables, removeGroupReservation, addAgency, addGuide,
    createAndReserveGroup, purgeBlankGroups,
  } = useBooking()
  const toast = useToast()

  const today = todayStr()
  const [pane, setPane] = useState('day') // day=月曆+當日總覽 | map=排位地圖全寬
  const [selectedDate, setSelectedDate] = useState(today)
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date(today + 'T00:00:00')
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [editorGroup, setEditorGroup] = useState(null) // 傳給編輯器的初始資料（既有團複本 或 空白範本）
  const [editorIsNew, setEditorIsNew] = useState(false)
  const [detailGroupId, setDetailGroupId] = useState(null) // 詳情頁顯示的團單 id（live 查找）
  const [sheetOpen, setSheetOpen] = useState(false)
  const [mapAssign, setMapAssign] = useState(null) // { bookingId, seatingId }：跳排位地圖並自動進預配模式

  // map 態的前一日/後一日：同步月曆游標，回 day 態時月曆停在正確的月份
  const shiftDay = (delta) => {
    const next = formatDate(addDays(new Date(selectedDate + 'T00:00:00'), delta))
    setSelectedDate(next)
    const d = new Date(next + 'T00:00:00')
    setMonthCursor(prev => (prev.year === d.getFullYear() && prev.month === d.getMonth())
      ? prev : { year: d.getFullYear(), month: d.getMonth() })
  }

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

  // 月曆散客量小字：summarizeGroupMonth 刻意不掃 bookings（O(groups) 設計），
  // 散客統計在容器層補一個 O(bookings) 的 useMemo，不動 utils
  const walkinByDate = useMemo(() => {
    const prefix = `${monthCursor.year}-${String(monthCursor.month + 1).padStart(2, '0')}-`
    const map = {}
    ;(bookings || []).forEach(b => {
      if (!b.date?.startsWith(prefix)) return
      if (CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return
      const e = map[b.date] || (map[b.date] = { count: 0, guests: 0 })
      e.count += 1
      e.guests += Number(b.guests) || 0
    })
    return map
  }, [bookings, monthCursor])

  // 當日總覽：抵達時間軸 / 備餐重點 / 警示 / 各場次容量（吃 bookings 做散客×團客合併）
  const daySummary = useMemo(
    () => buildGroupDaySummary({ groupReservations, bookings, tables, date: selectedDate, settings }),
    [groupReservations, bookings, tables, selectedDate, settings],
  )

  // === 轉場 ===
  // 點團卡 → 詳情頁（唯讀確認 + 回傳單）；要改內容由詳情頁的「✏️ 編輯」進精靈。
  const openExisting = (id) => {
    if (!groupReservations.some(x => x.id === id)) return
    setDetailGroupId(id)
  }

  // 詳情頁 live 查找：被刪 / 雲端同步移除時自動退回主控台
  const detailGroup = useMemo(
    () => detailGroupId ? groupReservations.find(g => g.id === detailGroupId) || null : null,
    [groupReservations, detailGroupId],
  )
  useEffect(() => {
    if (detailGroupId && !detailGroup && !editorGroup) setDetailGroupId(null)
  }, [detailGroupId, detailGroup, editorGroup])

  const openEditorFromDetail = () => {
    if (!detailGroup) return
    setEditorGroup(detailGroup)
    setEditorIsNew(false)
  }

  // 當日總覽散客列「→ 配桌」：跳排位地圖該場次並自動進預配模式
  const goAssignWalkin = (booking) => {
    const sid = seatingForSlot(settings, booking.timeSlot)?.id
    if (!sid) return
    setMapAssign({ bookingId: booking.id, seatingId: sid })
    setPane('map')
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

  // 編輯器返回：只清編輯器——從詳情進編輯時自然落回詳情頁；新增草稿（無詳情）回當日總覽。
  const closeEditor = () => { setEditorGroup(null); setEditorIsNew(false) }
  // 儲存後（新增與編輯一致）：進詳情頁，立即可印回傳單傳給導遊。
  const handleSaved = (id) => {
    closeEditor()
    setDetailGroupId(id || null)
  }
  const handleDeleted = () => {
    closeEditor()
    setDetailGroupId(null)
  }

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
        onBack={closeEditor}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        reserveExisting={reserveGroupTables}
        createGroup={createAndReserveGroup}
        removeGroup={removeGroupReservation}
        addAgency={addAgency}
        addGuide={addGuide}
      />
    )
  }

  // 團單詳情頁（唯讀確認 + 回傳單）整頁接管
  if (detailGroup) {
    return (
      <GroupDetailStage
        group={detailGroup}
        tables={tables}
        settings={settings}
        onBack={() => setDetailGroupId(null)}
        onEdit={openEditorFromDetail}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* 視圖切換 +（map 態）精簡日期列 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border-2 border-chicken-brown/15 bg-white p-1">
          {[['day', '📋 當日總覽'], ['map', '🗺️ 排位地圖']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setPane(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                pane === k ? 'bg-chicken-red text-white shadow' : 'text-chicken-brown/60 hover:text-chicken-brown'
              }`}
            >{label}</button>
          ))}
        </div>
        {pane === 'map' && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftDay(-1)} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown">‹ 前一日</button>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-chicken-cream px-3 py-1.5 text-sm font-black text-chicken-brown">
              📅 {dayLabel(selectedDate)}{settings?.closures?.closedDates?.includes(selectedDate) ? ' · 公休' : ''}
            </span>
            <button onClick={() => shiftDay(1)} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown">後一日 ›</button>
          </div>
        )}
      </div>

      {pane === 'day' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] gap-3 items-start">
          <GroupCalendar
            value={selectedDate}
            onSelect={setSelectedDate}
            cursor={monthCursor}
            onCursorChange={setMonthCursor}
            monthSummary={monthSummary}
            settings={settings}
            totalSeats={totalSeats}
            walkinByDate={walkinByDate}
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
            onOpenMap={() => setPane('map')}
            onAssignWalkin={goAssignWalkin}
          />
        </div>
      ) : (
        <SlotMapPanel date={selectedDate} assignRequest={mapAssign} onAssignHandled={() => setMapAssign(null)} />
      )}

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
