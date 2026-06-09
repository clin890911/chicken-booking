import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { generateTimeSlots, todayStr } from '../../../utils/timeSlots'
import { groupTableNumbers, CAPACITY_EXCLUDED_STATUSES } from '../../../utils/capacity'
import * as groupReservationService from '../../../services/groupReservationService'
import GroupDateStage from './planning/GroupDateStage'
import GroupDayStage from './planning/GroupDayStage'
import GroupEditorStage from './planning/GroupEditorStage'

const PURGE_FLAG = 'chicken_group_blank_purge_v1'

// 預排規劃：分階段導覽（選日期 → 當日總覽 → 編輯精靈）。
// 草稿優先：新團單在記憶體編輯，填好按儲存才落地（杜絕空白團單）。
export default function GroupPlanningView() {
  const {
    groupReservations, agencies, guides, tables, bookings, settings,
    reserveGroupTables, removeGroupReservation, addAgency, addGuide,
    createAndReserveGroup, purgeBlankGroups,
  } = useBooking()
  const toast = useToast()

  const [stage, setStage] = useState('date')          // 'date' | 'day' | 'editor'
  const [date, setDate] = useState(todayStr())
  const [editorGroup, setEditorGroup] = useState(null) // 傳給編輯器的初始資料（既有團複本 或 空白範本）
  const [editorIsNew, setEditorIsNew] = useState(false)

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
  const capByNum = useMemo(() => {
    const m = {}; tables.forEach(t => { m[t.number] = t.capacity }); return m
  }, [tables])

  const dayGroups = useMemo(
    () => groupReservations
      .filter(g => g.date === date)
      .sort((a, b) => (a.agencyName || '').localeCompare(b.agencyName || '')),
    [groupReservations, date],
  )

  // 每日團數小標（排除已取消/已完成）
  const dateBadges = useMemo(() => {
    const m = {}
    groupReservations.forEach(g => {
      if (CAPACITY_EXCLUDED_STATUSES.includes(g.status)) return
      m[g.date] = (m[g.date] || 0) + 1
    })
    return m
  }, [groupReservations])

  // 當日容量摘要（仍佔位的團所保留的相異桌/席）
  const capacity = useMemo(() => {
    const held = groupReservationService.tablesHeldOnDate(date)
    const numbers = Object.keys(held)
    const seats = numbers.reduce((s, n) => s + (capByNum[n] || 0), 0)
    return { tables: numbers.length, seats }
  }, [date, groupReservations, capByNum]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxDaysCap = Math.max(60, settings.maxDaysAhead || 30)

  // === 階段轉場 ===
  const pickDate = (d) => { setDate(d); setEditorGroup(null); setEditorIsNew(false); setStage('day') }
  const backToDate = () => setStage('date')

  const openExisting = (id) => {
    const g = groupReservations.find(x => x.id === id)
    if (!g) return
    setEditorGroup(g)
    setEditorIsNew(false)
    setStage('editor')
  }

  const openNewDraft = () => {
    const firstBatchId = 'BT' + Date.now().toString(36)
    setEditorGroup({
      date,
      schemaVersion: groupReservationService.GROUP_SCHEMA_VERSION,
      agencyId: null, agencyName: '', guideId: null, guideName: '', guidePhone: '',
      batches: [{ id: firstBatchId, label: '第一梯', timeSlot: slots[0] || '11:00', tableNumbers: [], guests: 0, note: '' }],
      counts: { total: 0, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '', tableSideNeeds: '', busInfo: '', notes: '', spend: 0,
      status: 'planned',
    })
    setEditorIsNew(true)
    setStage('editor')
  }

  const backToDay = () => { setEditorGroup(null); setEditorIsNew(false); setStage('day') }

  return (
    <div className="space-y-3">
      {stage === 'date' && (
        <GroupDateStage date={date} badges={dateBadges} maxDaysCap={maxDaysCap} onPick={pickDate} />
      )}

      {stage === 'day' && (
        <GroupDayStage
          date={date}
          dayGroups={dayGroups}
          capacity={capacity}
          onChangeDate={backToDate}
          onSelectGroup={openExisting}
          onNewGroup={openNewDraft}
        />
      )}

      {stage === 'editor' && editorGroup && (
        <GroupEditorStage
          key={editorIsNew ? 'new' : editorGroup.id}
          initialGroup={editorGroup}
          isNew={editorIsNew}
          date={date}
          slots={slots}
          tables={tables}
          settings={settings}
          bookings={bookings}
          agencies={agencies}
          guides={guides}
          onBack={backToDay}
          onSaved={backToDay}
          onDeleted={backToDay}
          reserveExisting={reserveGroupTables}
          createGroup={createAndReserveGroup}
          removeGroup={removeGroupReservation}
          addAgency={addAgency}
          addGuide={addGuide}
        />
      )}
    </div>
  )
}
