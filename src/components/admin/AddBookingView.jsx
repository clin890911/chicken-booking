import { useState, useEffect, useMemo, useRef } from 'react'
import MonthCalendar from '../booking/MonthCalendar'
import TimeSlotPicker from '../booking/TimeSlotPicker'
import { Card, Input, Textarea, Button } from '../ui'
import GuestCountField from './GuestCountField'
import TablePickField from './TablePickField'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import * as customerService from '../../services/customerService'
import { getNoshowCount } from '../../services/bookingService'
import { todayStr, dayLabel, formatDate, addDays } from '../../utils/timeSlots'
import { isTableUsableOnDate } from '../../utils/tableAvailability'

// 後台新增訂位 — 電話為先導鍵，自動帶顧客檔
// 設計：緊湊單頁、由上而下一路填完；缺漏欄位即時列在底部黏性操作列（點 pill 捲到該欄）；
// 日期用「今天/明天/後天」chips 快選、月曆預設收合（解決日期區佔版面、難以定位缺漏的問題）。
// 註：旅行社團體請走「規劃」分頁的預排流程（整桌容量把關 + 回傳單），不再用單筆 group 訂位，
// 避免與團體預排的容量重複計算。
const SOURCE_OPTIONS = [
  { value: 'phone',  label: '電話' },
  { value: 'line',   label: 'LINE' },
  { value: 'walkin', label: '現場' },
  { value: 'online', label: '線上代訂' },
]

const NOTE_OPTIONS = [
  { key: 'pet',      label: '寵物' },
  { key: 'child',    label: '兒童' },
  { key: 'mobility', label: '行動不便' },
]

// onAssignTable(booking)：「到桌況圖選」或事後「指派桌」→ 今天去現場指派模式、未來去規劃頁預配（AdminPage 分流）
// onMoveTable(booking)：存檔後 toast 的「改桌」→ 現場頁 move 模式
export default function AddBookingView({ onCreated, onAssignTable, onMoveTable, initial }) {
  const { bookings, tables, groupReservations, settings, addBooking, findSuitableTables, assignBookingToTable } = useBooking()
  const { user } = useAuth()
  const toast = useToast()

  const [phone, setPhone] = useState(initial?.phone || '')
  const [source, setSource] = useState(initial?.source || 'phone')
  const [name, setName] = useState(initial?.name || '')
  const [guests, setGuests] = useState(2)
  const [date, setDate] = useState(todayStr())
  const [showCalendar, setShowCalendar] = useState(false)
  const [timeSlot, setTimeSlot] = useState('')
  const [notes, setNotes] = useState({ pet: false, child: false, mobility: false, text: '' })
  // 桌位選擇：'auto'＝跟著建議（第一張候選）｜桌號＝店員點選的桌｜'map'＝到桌況圖選｜'none'＝先不指派
  const [tablePick, setTablePick] = useState('auto')
  const [tableNotice, setTableNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false) // 按過提交才顯示欄位級紅框

  const phoneRef = useRef(null)
  const nameRef = useRef(null)
  const guestsRef = useRef(null)
  const slotRef = useRef(null)

  // 自動帶顧客檔
  const matchedCustomer = useMemo(() => {
    if (phone.length < 4) return null
    const c = customerService.getByPhone(phone)
    if (c) return c
    // 部分模糊：用 search
    const matches = customerService.search(phone)
    return matches.length === 1 ? matches[0] : null
  }, [phone])

  const noshowCount = phone ? getNoshowCount(phone) : 0

  // 偵測 customer 自動填
  useEffect(() => {
    if (matchedCustomer && !name) {
      setName(matchedCustomer.name || '')
      if (matchedCustomer.notes && !notes.text) {
        setNotes(n => ({ ...n, text: matchedCustomer.notes }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedCustomer?.phone])

  // 換日重設時段
  useEffect(() => { setTimeSlot('') }, [date])

  // 預填來源有兩條：名冊「新增訂位」（phone/name/source 一定會給，含空字串代表刻意清空——
  // 例如現場頁「＋新增今日訂位」傳 null 顧客）／日曆選日期後「＋新增訂位」（只給 date）。
  // 用「欄位是否存在於 initial」而非「truthy」判斷是否覆蓋：
  // 這樣只帶 date 的日曆預填不會誤把使用者已填的姓名電話洗掉，名冊路徑的清空語意也不受影響。
  // initial.seq 變更時才重帶（AddBookingView 已掛載時也生效）。
  useEffect(() => {
    if (!initial) return
    if (initial.phone !== undefined) setPhone(initial.phone)
    if (initial.name !== undefined) setName(initial.name)
    if (initial.source) setSource(initial.source)
    if (initial.date) setDate(initial.date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.seq])

  // 來源＝現場：電話選填。現場客常不留電話，過去必填逼得店員填 09000000 這類假號，
  // 而 create 依電話 upsert 顧客檔 → 不同客人被併成同一個顧客檔（過敏備註、no-show 次數全混在一起）。
  // 空電話本來就不建/不併顧客檔（bookingService.create／customerService.upsert 都有守門）。
  const phoneOptional = source === 'walkin'

  // 缺漏清單：底部黏性列即時顯示「還差哪幾欄」，點 pill 捲到該欄
  const missing = useMemo(() => [
    !phoneOptional && !phone.trim() && { key: 'phone', label: '電話', ref: phoneRef },
    !name.trim() && { key: 'name', label: '姓名', ref: nameRef },
    !(guests > 0) && { key: 'guests', label: '人數', ref: guestsRef },
    !timeSlot && { key: 'slot', label: '時段', ref: slotRef },
  ].filter(Boolean), [phoneOptional, phone, name, guests, timeSlot])
  const valid = missing.length === 0

  // === 桌位（僅今天）===
  // 候選＝現在空桌、今日可用、容量 ≥ 人數、且依「鎖桌佔用區間」不撞別筆預配/團保的單桌（排序沿用 findSuitableTables）。
  // 今日存檔即鎖桌（reserved）→ 佔用區間是 [min(現在, 時段), 時段+佔位)（mode 'hold'，capacity.assignmentWindow）：
  // 只比 [時段, 時段+佔位) 會反向撞桌（09:00 幫 13:30 鎖 105，11:00 預配 105 的客人到店時桌已被鎖）。
  // 未來日不在這裡選桌（存檔後 toast 引導到規劃頁預配）。
  const isToday = date === todayStr()
  const tableCandidates = useMemo(
    () => (isToday && timeSlot && guests > 0) ? findSuitableTables(guests, { date, timeSlot, mode: 'hold' }) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isToday, date, timeSlot, guests, tables, bookings, groupReservations],
  )
  // 沒有候選時分辨原因：店裡有沒有「任何」單桌容量坐得下（不看此刻桌況）。
  //   有 → 只是此刻沒空桌可鎖（被佔、被預配、團保）→ 預設「先不指派」，接近用餐時間再到現場頁指派
  //   沒有 → 需要併桌 → 預設「到桌況圖選（可併桌）」
  const anySingleFits = useMemo(
    () => (tables || []).some(t => isTableUsableOnDate(t, date) && (Number(t.capacity) || 0) >= guests),
    [tables, date, guests],
  )
  const emptyDefault = anySingleFits ? 'none' : 'map'
  // 實際會用的選擇（智慧預設：沒選過就用第一張候選；沒有候選時依上面的原因給預設）
  const tableChoice = useMemo(() => {
    if (!isToday || !timeSlot) return null
    if (tablePick === 'none') return { kind: 'none' }
    if (tablePick === 'map') return { kind: 'map' }
    const explicit = tablePick !== 'auto' ? tableCandidates.find(t => t.number === tablePick) : null
    const t = explicit || tableCandidates[0]
    return t ? { kind: 'table', table: t } : { kind: emptyDefault }
  }, [isToday, timeSlot, tablePick, tableCandidates, emptyDefault])

  // 人數/時段改變後，店員點選的桌不再合格 → 回到新的建議，並明講換了（不讓桌號悄悄變掉）
  useEffect(() => {
    if (!isToday || !timeSlot) return
    if (['auto', 'map', 'none'].includes(tablePick)) return
    if (tableCandidates.some(t => t.number === tablePick)) return
    const next = tableCandidates[0]
    setTablePick('auto')
    setTableNotice(next
      ? `${tablePick} 不適用目前的人數／時段，已改回建議桌 ${next.number}`
      : `${tablePick} 不適用目前的人數／時段，且沒有其他空桌可鎖，已改為「${emptyDefault === 'none' ? '先不指派' : '到桌況圖選'}」`)
  }, [isToday, timeSlot, tablePick, tableCandidates, emptyDefault])

  // 跟著建議走時，建議桌因人數／時段／桌況變動而換了 → 同樣提示
  const lastAutoTableRef = useRef(null)
  useEffect(() => {
    const n = tablePick === 'auto' && tableChoice?.kind === 'table' ? tableChoice.table.number : null
    const prev = lastAutoTableRef.current
    lastAutoTableRef.current = n
    if (prev && n && prev !== n) setTableNotice(`建議桌已改為 ${n}（人數、時段或桌況有變動）`)
  }, [tablePick, tableChoice])

  const pickTable = (v) => { setTablePick(v); setTableNotice('') }
  const tableEmptyReason = anySingleFits
    ? '此刻沒有空桌可鎖，先存檔、接近用餐時間再到現場頁指派。'
    : `店裡沒有單桌坐得下 ${guests} 位，需要併桌：存檔後到桌況圖選（可點多張同層空桌）。`
  const tableSuffix = tableChoice?.kind === 'table' ? ` · 桌 ${tableChoice.table.number}`
    : tableChoice?.kind === 'map' ? ' · 到桌況圖選桌'
    : tableChoice?.kind === 'none' ? ' · 先不指派'
    : ''

  // 點「還差」pill：亮出欄位級紅框並捲到該欄（缺欄時不再顯示提交鈕，紅框改由此觸發）
  const scrollToField = (m) => {
    setAttempted(true)
    m.ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 日期快選 chips：今天 / 明天 / 後天 / 其他日期（展開緊湊月曆）
  const quickDates = useMemo(() => {
    const base = new Date()
    return [0, 1, 2].map(i => {
      const d = formatDate(addDays(base, i))
      return { date: d, label: i === 0 ? '今天' : i === 1 ? '明天' : '後天', sub: dayLabel(d) }
    })
  }, [])
  const isQuickDate = quickDates.some(q => q.date === date)

  const handleSubmit = async () => {
    if (!valid) {
      setAttempted(true)
      scrollToField(missing[0])
      return toast.error(`還差：${missing.map(m => m.label).join('、')}`)
    }
    setBusy(true)
    try {
      const choice = tableChoice
      const b = addBooking({
        name, phone: phone.trim(), guests, date, timeSlot, notes,
        source,
        status: 'confirmed',
        createdBy: user?.email || 'staff',
      })
      const summary = `${name} ${guests} 位 · ${date} ${timeSlot}`
      let goToMap = false
      if (isToday && choice?.kind === 'table') {
        // 指派店員選的桌（或建議桌）。走 Context（含 refresh／同步／Telegram 通知），
        // 存檔後清單立刻就是指派後的樣子；toast 帶「改桌」出口。
        const n = choice.table.number
        const r = assignBookingToTable(b.id, n)
        if (r.ok) {
          if (onMoveTable) {
            toast.action(`${summary} · 已指派 ${n}`,
              { label: '改桌', onClick: () => onMoveTable({ ...b, assignedTableId: n }) }, { duration: 8000 })
          } else {
            toast.success(`${summary} · 已指派 ${n}`)
          }
        } else {
          toast.action(`已建立訂位（指派 ${n} 失敗：${r.error}）`, { label: '手動指派', onClick: () => onAssignTable?.(b) })
        }
      } else if (isToday && choice?.kind === 'map') {
        goToMap = true
        toast.info(`${summary} 已建立 · 請在桌況圖點桌指派`)
      } else if (isToday) {
        toast.action(`${summary} 已建立（未指派桌）`, { label: '指派桌', onClick: () => onAssignTable?.(b) })
      } else {
        toast.action(`${summary} 已建立`, { label: '預配桌位', onClick: () => onAssignTable?.(b) })
      }
      // 重設（保留 source）
      setPhone(''); setName(''); setGuests(2); setTimeSlot('')
      setNotes({ pet: false, child: false, mobility: false, text: '' })
      setTablePick('auto'); setTableNotice('')
      setAttempted(false); setShowCalendar(false)
      onCreated?.(b)
      // 「到桌況圖選（可併桌）」→ 既有 handleAssignTable：今天的訂位進現場指派模式（大組自動走併桌）
      if (goToMap) onAssignTable?.(b)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* === ① 客人 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">客人資訊</h2>
        <div className="space-y-3">
          <div ref={phoneRef} className="relative">
            <Input
              label={phoneOptional ? '電話（選填 · 現場客可不填）' : '電話（鍵入時自動帶顧客檔）'}
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder={phoneOptional ? '現場客可不填' : '0912345678'}
              error={attempted && !phoneOptional && !phone.trim() ? '必填' : ''}
            />
            {(matchedCustomer || noshowCount > 0) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {matchedCustomer && (
                  <span className="px-2.5 py-1 bg-chicken-green/15 text-chicken-green rounded-full font-bold">
                    第 {(matchedCustomer.visits || 0) + 1} 次 · 上次 {new Date(matchedCustomer.lastVisit).toLocaleDateString('zh-TW')}
                  </span>
                )}
                {matchedCustomer?.vipTier && matchedCustomer.vipTier !== 'none' && (
                  <span className="px-2.5 py-1 bg-chicken-yellow/20 text-chicken-yellow rounded-full font-bold">
                    {matchedCustomer.vipTier.toUpperCase()}
                  </span>
                )}
                {matchedCustomer?.allergies && (
                  <span className="px-2.5 py-1 bg-chicken-red/10 text-chicken-red rounded-full font-bold">
                    過敏：{matchedCustomer.allergies}
                  </span>
                )}
                {noshowCount > 0 && (
                  <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">
                    no-show ×{noshowCount}
                  </span>
                )}
                {matchedCustomer?.blacklisted && (
                  <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">
                    黑名單：{matchedCustomer.blacklistReason || ''}
                  </span>
                )}
              </div>
            )}
          </div>
          <div ref={nameRef}>
            <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="王小姐"
              error={attempted && !name.trim() ? '必填' : ''} />
          </div>
          {/* 來源：chips 取代下拉（少一次點擊、省高度） */}
          <div>
            <label className="label">來源</label>
            <div className="flex gap-1.5 flex-wrap">
              {SOURCE_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setSource(o.value)} aria-label={`來源：${o.label}`}
                  className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                    source === o.value
                      ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                      : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* === ② 人數 · 日期 · 時段 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">用餐資訊</h2>
        <div className="space-y-4">
          {/* 人數：1–8 快選 + 9+ 自由輸入（上限 200） */}
          <div ref={guestsRef}>
            <GuestCountField
              value={guests}
              onChange={setGuests}
              hint={`已選：${guests} 位${guests >= 9 ? '（大桌建議改走規劃分頁的團體預排）' : ''}`}
            />
          </div>

          {/* 日期：今天/明天/後天 chips + 其他日期（展開緊湊月曆） */}
          <div>
            <label className="label">日期</label>
            <div className="flex gap-1.5 flex-wrap">
              {quickDates.map(q => (
                <button key={q.date} type="button"
                  onClick={() => { setDate(q.date); setShowCalendar(false) }}
                  className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                    date === q.date
                      ? 'border-chicken-red bg-chicken-red text-white'
                      : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                  {q.label}
                  <span className={`block text-[10px] font-bold ${date === q.date ? 'text-white/80' : 'text-chicken-brown/50'}`}>{q.sub}</span>
                </button>
              ))}
              <button type="button" onClick={() => setShowCalendar(s => !s)}
                className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                  !isQuickDate
                    ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                    : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                選月曆
                <span className="block text-[10px] font-bold opacity-70">
                  {!isQuickDate ? `已選 ${dayLabel(date)}` : showCalendar ? '收合 ▴' : '可排數月後 ▾'}
                </span>
              </button>
            </div>
            {showCalendar && (
              <div className="mt-2 animate-soft-enter">
                <MonthCalendar value={date} onChange={(d) => { setDate(d); setShowCalendar(false) }} />
              </div>
            )}
          </div>

          {/* 時段 */}
          <div ref={slotRef} className={attempted && !timeSlot ? 'rounded-xl ring-2 ring-chicken-red/40 p-2 -m-2' : ''}>
            <label className="label">時段（{dayLabel(date)}）</label>
            <TimeSlotPicker
              date={date}
              value={timeSlot}
              onChange={setTimeSlot}
              settings={settings}
              tables={tables}
              bookings={bookings}
              groupReservations={groupReservations}
              guests={guests}
              hideFull={false}
            />
            {attempted && !timeSlot && <p className="text-xs text-chicken-red font-bold mt-1">請選時段</p>}
          </div>

          {/* 桌位：只在今天顯示（未來日存檔後 toast 引導到規劃頁預配） */}
          {isToday && (
            <TablePickField
              hasSlot={!!timeSlot}
              candidates={tableCandidates}
              choice={tableChoice}
              onPick={pickTable}
              notice={tableNotice}
              emptyReason={tableEmptyReason}
            />
          )}
        </div>
      </Card>

      {/* === ③ 備註 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">特殊需求（選填）</h2>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {NOTE_OPTIONS.map(n => {
            const active = notes[n.key]
            return (
              <button
                type="button"
                key={n.key}
                onClick={() => setNotes(p => ({ ...p, [n.key]: !p[n.key] }))}
                className={`px-3 py-2.5 rounded-xl border-2 transition-all text-sm font-bold ${
                  active
                    ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                    : 'border-chicken-brown/15 bg-white text-chicken-brown'
                }`}
              >
                {n.label}
              </button>
            )
          })}
        </div>
        <Textarea
          value={notes.text}
          onChange={e => setNotes(p => ({ ...p, text: e.target.value }))}
          placeholder="例：靠窗、慶生、剪雞肉服務、長輩需軟食..."
        />
      </Card>

      {/* === 底部黏性操作列：缺欄時收成一列「還差」pills（點捲到該欄），
             填齊才展開確認鈕——避免手機上整塊蓋住日期/時段。
             確認鈕帶出所選桌號（今天），存檔前就看得到會指派哪張桌 === */}
      <div className="sticky bottom-20 lg:bottom-3 z-20 pt-2">
        <div className="rounded-xl border border-chicken-brown/10 bg-white/95 p-2.5 shadow-lg backdrop-blur">
          {valid ? (
            <Button onClick={handleSubmit} disabled={busy} className="w-full min-h-[44px]">
              {busy ? '建立中...' : `確認新增 · ${dayLabel(date)} ${timeSlot} · ${guests} 位${tableSuffix}`}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold text-chicken-brown/55">還差</span>
              {missing.map(m => (
                <button key={m.key} type="button" onClick={() => scrollToField(m)}
                  className="rounded-full bg-chicken-red/10 px-2.5 py-1 font-bold text-chicken-red hover:bg-chicken-red/20 min-h-[28px]">
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
