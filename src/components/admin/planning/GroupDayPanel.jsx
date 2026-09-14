import { EmptyState } from '../../ui'
import Icon from '../../ui/Icon'
import { dayLabel } from '../../../utils/timeSlots'
import GroupArrivalTimeline from './GroupArrivalTimeline'
import GroupPrepDigest from './GroupPrepDigest'

// Pane B：當日總覽。2026-09 改版為「群組清單」語彙（iOS 設定頁式）：
//   標題列（日期 + 排位地圖 / 列印 / 今日→現場）→ 三格統計（團體 / 散客 / 保留）→ 警示 →
//   抵達時間軸 → 備餐重點（可展開看哪一團）→ 依場次分組（場次容量堆疊條 + 團列 + 散客列）。
// 主要動作「新增散客 / 新增團單」已上移到 PlanningView 頂列（與分段控制同列，iPad 一眼可見）。
const STATUS_LABEL = {
  planned: { label: '已預排', cls: 'bg-chicken-brown/[0.08] text-chicken-brown/80' },
  confirmed: { label: '已確認', cls: 'bg-chicken-yellow/[0.14] text-[#b06600]' },
  arrived: { label: '已到店', cls: 'bg-chicken-green/15 text-[#5b8c1f]' },
  completed: { label: '已完成', cls: 'bg-chicken-brown text-white' },
  cancelled: { label: '已取消', cls: 'bg-chicken-red/10 text-chicken-red' },
}

// 散客狀態（CAPACITY_EXCLUDED 已被 buildWalkinDaySummary 過濾，只會出現這三種）
const WALKIN_STATUS = {
  pending: { label: '待確認', cls: 'bg-amber-100 text-amber-700' },
  confirmed: { label: '待到', cls: 'bg-chicken-green/15 text-[#5b8c1f]' },
  arrived: { label: '用餐中', cls: 'bg-orange-100 text-orange-700' },
}

function Pill({ cls, children }) {
  return <span className={`inline-flex items-center h-[22px] px-2 rounded-full text-[11px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>
}

// 場次內散客列。整列可點 → 訂位詳情（onOpen）；桌號可點 → 排位地圖標示該桌（onFocusTable）；「配桌」→ 一鍵進預配模式。
function WalkinRow({ row, onAssign, onOpen, onFocusTable }) {
  const b = row.booking
  const st = WALKIN_STATUS[row.status] || WALKIN_STATUS.confirmed
  const n = b.notes || {}
  const extra = Array.isArray(b.extraTableIds) ? b.extraTableIds : []
  const tableLabel = row.assignedTableId ? `${row.assignedTableId}${extra.length ? ` +${extra.length}` : ''}` : ''
  const clickable = !!onOpen
  const needIcons = [n.child && 'child', n.mobility && 'wheelchair'].filter(Boolean)
  return (
    <div className="flex items-center gap-2 min-h-[46px] pl-3.5 pr-2.5 border-t border-chicken-brown/[0.06]">
      <button type="button" onClick={clickable ? () => onOpen(b) : undefined} disabled={!clickable}
        title={clickable ? '點擊看訂位詳情' : undefined}
        className={`tap flex-1 min-w-0 flex items-center gap-2 text-left py-1 ${clickable ? '' : 'cursor-default'}`}>
        <Icon name="person" size={18} className="text-chicken-yellow" />
        <span className="text-sm font-semibold text-chicken-brown truncate">{b.name || '（未填姓名）'}</span>
        <span className="text-xs text-chicken-brown/60 tabular-nums shrink-0">{row.timeSlot || '未排'} · {row.guests} 位</span>
        <Pill cls={st.cls}>{st.label}</Pill>
        {needIcons.map(k => <Icon key={k} name={k} size={14} className="text-chicken-brown/50" />)}
        {n.pet && <span className="text-[11px] text-chicken-brown/50">寵物</span>}
        {n.text && <span className="text-[11px] text-chicken-brown/50 truncate max-w-[8em]" title={n.text}>{n.text}</span>}
      </button>
      {row.assignedTableId ? (
        onFocusTable ? (
          <button type="button" onClick={() => onFocusTable(b)} title={`在排位地圖上標示這桌（${[row.assignedTableId, ...extra].join('、')}）`}
            className="tap text-xs font-semibold text-chicken-brown/70 tabular-nums shrink-0 whitespace-nowrap h-8 px-2 rounded-lg hover:bg-chicken-brown/[0.05]">{tableLabel}</button>
        ) : (
          <span className="text-xs font-semibold text-chicken-brown/70 tabular-nums shrink-0">{tableLabel}</span>
        )
      ) : onAssign ? (
        <button type="button" onClick={() => onAssign(b)}
          className="tap text-xs font-semibold h-8 px-3 rounded-lg bg-chicken-red text-white shrink-0">配桌</button>
      ) : (
        <Pill cls="bg-amber-100 text-amber-700">未配桌</Pill>
      )}
      {clickable && <Icon name="chevronRight" size={14} strokeWidth={2.2} className="text-chicken-brown/30" />}
    </div>
  )
}

// 場次剩餘色調（summary 來自 resolveSlotOccupancy：remaining=席、remainingTables=桌）
function seatingTone(summary) {
  if (!summary || summary.closed) return 'closed'
  if ((summary.remaining ?? 0) <= 0) return 'full'
  if ((summary.remainingTables ?? 0) <= 2 || (summary.totalSeats > 0 && summary.remaining < summary.totalSeats * 0.15)) return 'tight'
  return 'ok'
}
const TONE_TEXT = { ok: 'text-chicken-brown/60', tight: 'text-amber-700', full: 'text-chicken-red', closed: 'text-chicken-brown/40' }

function WarningBanner({ w }) {
  const base = 'flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold'
  if (w.type === 'overcapacity') {
    return (
      <div className={`${base} bg-rose-50 text-rose-700`}><Icon name="warning" size={16} className="shrink-0 mt-px" />
        <span>{w.seatingName} 恐爆量：已用 {w.used} 席 / 全店 {w.totalSeats} 席（超出 {w.over} 席），請調整圈桌或梯次</span></div>
    )
  }
  if (w.type === 'collision') {
    return (
      <div className={`${base} bg-amber-50 text-amber-700`}><Icon name="warning" size={16} className="shrink-0 mt-px" />
        <span>{w.seatingName} {w.timeSlot} 同時段 {w.count} 團 / {w.guests} 位同時抵達，建議錯開帶位、預留接車人力</span></div>
    )
  }
  if (w.type === 'unscheduled') {
    return (
      <div className={`${base} bg-amber-50 text-amber-700`}><Icon name="warning" size={16} className="shrink-0 mt-px" />
        <span>有 {w.count} 個梯次的時間未對應任何場次（{w.rows.map(r => r.timeSlot).join('、')}），請確認帶位時間</span></div>
    )
  }
  return null
}

// 單列「團×梯次」（同團跨兩場次會在兩場次各出現一列，標第一梯/第二梯）。
// 整列可點 → 團單詳情；右側獨立的「複製」圖示鈕 → 複製為新草稿。
function GroupBatchRow({ row, onSelect, onDuplicate }) {
  const g = row.group
  const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned
  const tableCount = (row.tableNumbers || []).length
  return (
    <div className="flex items-center gap-1 min-h-[46px] pl-3.5 pr-2 border-t border-chicken-brown/[0.06]">
      <button type="button" onClick={() => onSelect(g.id)} className="tap flex-1 min-w-0 flex items-center gap-2 text-left py-1">
        <Icon name="bus" size={18} className="text-chicken-red" />
        <span className="text-sm font-semibold text-chicken-brown truncate">{g.agencyName || '（未填旅行社）'}</span>
        <span className="text-xs text-chicken-brown/60 tabular-nums shrink-0">
          {row.timeSlot || '未排'} · {row.guests || 0} 位 · {tableCount} 桌{row.batch?.label ? ` · ${row.batch.label}` : ''}
        </span>
        <span className="flex-1" />
        <Pill cls={st.cls}>{st.label}</Pill>
        <Icon name="chevronRight" size={14} strokeWidth={2.2} className="text-chicken-brown/30" />
      </button>
      <button type="button" onClick={() => onDuplicate(g.id)} title="複製這團為新草稿" aria-label={`複製 ${g.agencyName || '團單'}`}
        className="tap w-8 h-8 rounded-lg flex items-center justify-center text-chicken-brown/40 hover:text-chicken-red hover:bg-chicken-brown/[0.05]">
        <Icon name="copy" size={15} />
      </button>
    </div>
  )
}

function StackedBar({ summary }) {
  const total = summary?.totalSeats || 0
  const g = Math.min(total, summary?.groupHeldSeats || 0)
  const w = Math.min(Math.max(0, total - g), summary?.walkinGuests || 0)
  const pct = (n) => (total > 0 ? `${(n / total) * 100}%` : '0%')
  return (
    <div className="flex h-1.5 rounded-full bg-chicken-brown/[0.08] overflow-hidden gap-px" aria-hidden="true">
      <div className="h-full bg-chicken-red" style={{ width: pct(g) }} />
      <div className="h-full bg-chicken-yellow" style={{ width: pct(w) }} />
    </div>
  )
}

function SessionSection({ seating, summary, rows, walkinRows = [], onNewGroup, onSelectGroup, onDuplicate, onAssignWalkin, onOpenWalkin, onFocusTable }) {
  const tone = seatingTone(summary)
  const closed = tone === 'closed'
  const walkinGuests = walkinRows.reduce((s, r) => s + (r.guests || 0), 0)
  return (
    <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
      <div className="px-3.5 pt-3 pb-2.5 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-chicken-brown">{seating.name}</span>
          <span className="text-xs text-chicken-brown/50 tabular-nums">{seating.start}–{seating.end}</span>
          <span className="flex-1" />
          <span className={`text-xs font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
            {closed ? '已關閉' : tone === 'full' ? '已客滿' : `剩 ${summary.remainingTables} 桌 · ${summary.remaining} 席`}
          </span>
          <button type="button" onClick={() => onNewGroup(seating.id)} disabled={closed}
            className="tap inline-flex items-center gap-0.5 text-xs font-semibold text-chicken-red disabled:text-chicken-brown/30 disabled:cursor-not-allowed">
            <Icon name="plus" size={12} strokeWidth={2.4} />新增團單
          </button>
        </div>
        <StackedBar summary={summary} />
      </div>
      {rows.length === 0 && walkinRows.length === 0 ? (
        <div className="px-3.5 pb-3 text-xs text-chicken-brown/40">本場次尚無團單</div>
      ) : (
        <>
          {rows.map(r => (
            <GroupBatchRow key={`${r.group.id}:${r.batch?.id || r.timeSlot}`} row={r} onSelect={onSelectGroup} onDuplicate={onDuplicate} />
          ))}
          {walkinRows.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-3.5 py-1.5 border-t border-chicken-brown/[0.06] bg-[#fbfaf8] text-[11px] font-semibold text-chicken-brown/55 tabular-nums">
                散客 {walkinRows.length} 組 · {walkinGuests} 位
                <span className="font-medium text-chicken-brown/40">· 點列看詳情</span>
              </div>
              {walkinRows.map(r => (
                <WalkinRow key={r.booking.id} row={r} onAssign={closed ? null : onAssignWalkin} onOpen={onOpenWalkin} onFocusTable={onFocusTable} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, big, small, note, noteCls = '', divider }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3.5 py-3 min-w-0 ${divider ? 'border-l border-chicken-brown/[0.08]' : ''}`}>
      <div className="text-xs font-semibold text-chicken-brown/55">{label}</div>
      <div className="flex items-baseline gap-1 flex-wrap">
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-chicken-brown leading-none">{big}</span>
        <span className="text-xs text-chicken-brown/60 tabular-nums">{small}</span>
      </div>
      {note && <div className={`text-[11px] font-semibold ${noteCls}`}>{note}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h3 className="px-1 text-xs font-semibold text-chicken-brown/55 tracking-wide">{children}</h3>
}

export default function GroupDayPanel({ date, daySummary, dayGroups, isToday, onSelectGroup, onNewGroup, onDuplicate, onGoToday, onPrintSheet, onOpenMap, onAssignWalkin, onOpenWalkin, onFocusTable, onFocusBatch }) {
  const s = daySummary || {}
  const hasGroups = dayGroups.length > 0
  const noSeatings = (s.seatings || []).length === 0

  // 散客名單（buildWalkinDaySummary）：依場次分桶，給領位看名單 + 一鍵跳地圖配桌
  const walkins = s.walkins || { count: 0, guests: 0, unassignedCount: 0, unassignedGuests: 0, bySeating: [], unscheduled: [] }
  const walkinRowsBySeating = {}
  walkins.bySeating.forEach(x => { walkinRowsBySeating[x.seating.id] = x.rows })

  // 依場次分組：場次容量（含剩餘）對齊抵達時間軸的同場次梯次列。
  const timeline = s.timeline || []
  const sections = (s.seatings || []).map(({ seating, summary }) => ({
    seating, summary,
    rows: (timeline.find(b => b.seating?.id === seating.id)?.rows) || [],
    walkinRows: walkinRowsBySeating[seating.id] || [],
  }))
  const unscheduled = timeline.find(b => b.seating === null)
  const hasUnscheduled = (unscheduled?.rows?.length || 0) > 0 || walkins.unscheduled.length > 0

  const linkCls = 'tap inline-flex items-center gap-0.5 h-8 px-1.5 rounded-lg text-[13px] font-semibold text-chicken-red hover:bg-chicken-red/[0.06]'
  const quietCls = 'tap inline-flex items-center gap-1 h-8 px-1.5 rounded-lg text-xs font-semibold text-chicken-brown/60 hover:bg-chicken-brown/[0.05]'

  return (
    <div className="space-y-3">
      {/* 標題列 */}
      <div className="flex items-center gap-1.5 flex-wrap px-1">
        <h2 className="text-xl font-semibold tracking-tight text-chicken-brown">{dayLabel(date)}</h2>
        {s.closed && <Pill cls="bg-chicken-brown/[0.08] text-chicken-brown/70">公休</Pill>}
        {isToday && <Pill cls="bg-chicken-red/10 text-chicken-red">今天</Pill>}
        <span className="flex-1" />
        {hasGroups && (
          <button type="button" onClick={onPrintSheet} className={quietCls} title="列印備餐單" aria-label="列印備餐單"><Icon name="print" size={16} /></button>
        )}
        {isToday && onGoToday && (
          <button type="button" onClick={onGoToday} className={quietCls} title="到現場頁帶位">現場<Icon name="chevronRight" size={12} strokeWidth={2.4} /></button>
        )}
        {onOpenMap && (
          <button type="button" onClick={onOpenMap} className={linkCls}>排位地圖<Icon name="chevronRight" size={13} strokeWidth={2.4} /></button>
        )}
      </div>

      {/* 三格統計（團體 / 散客 / 保留桌） */}
      <div className="grid grid-cols-3 bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
        <Stat label="團體" big={s.guests || 0} small={`位 · ${s.groupCount || 0} 團`} />
        <Stat label="散客" big={walkins.guests} small={`位 · ${walkins.count} 組`} divider
          note={walkins.unassignedCount > 0 ? `未配桌 ${walkins.unassignedCount} 組` : null} noteCls="text-[#b06600]" />
        <Stat label="保留" big={s.heldTableCount || 0} small="桌" divider />
      </div>

      {/* 警示 */}
      {s.closed && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
          <Icon name="ban" size={16} className="shrink-0 mt-px" /><span>本日公休，停止接收新訂位；既有團單不受影響。</span>
        </div>
      )}
      {(s.warnings || []).map((w, i) => <WarningBanner key={i} w={w} />)}
      {noSeatings && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700">
          <Icon name="warning" size={16} className="shrink-0 mt-px" />
          <span>尚未設定場次。依場次分組、抵達時間軸與爆量提醒需先到「設定 → 場次設定」新增午餐/晚餐場次。</span>
        </div>
      )}

      {/* 內容 */}
      {hasGroups || !noSeatings ? (
        <>
          {hasGroups && <GroupArrivalTimeline timeline={s.timeline || []} onFocusBatch={onFocusBatch} />}
          {hasGroups && <GroupPrepDigest prep={s.prep} />}

          {/* 依場次分組（團列 + 散客列） */}
          {!noSeatings && (
            <div className="space-y-1.5">
              <SectionTitle>場次 <span className="font-medium text-chicken-brown/40">· 點列看詳情</span></SectionTitle>
              {sections.map(sec => (
                <SessionSection key={sec.seating.id} {...sec}
                  onNewGroup={onNewGroup} onSelectGroup={onSelectGroup} onDuplicate={onDuplicate}
                  onAssignWalkin={onAssignWalkin} onOpenWalkin={onOpenWalkin} onFocusTable={onFocusTable} />
              ))}
              {hasUnscheduled && (
                <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                  <div className="px-3.5 py-2.5 text-sm font-semibold text-amber-700 bg-amber-50/60">未排場次 / 其他</div>
                  {unscheduled && unscheduled.rows.map(r => (
                    <GroupBatchRow key={`${r.group.id}:${r.batch?.id || r.timeSlot}`} row={r} onSelect={onSelectGroup} onDuplicate={onDuplicate} />
                  ))}
                  {walkins.unscheduled.length > 0 && (
                    <>
                      <div className="px-3.5 py-1.5 border-t border-chicken-brown/[0.06] bg-[#fbfaf8] text-[11px] font-semibold text-chicken-brown/55">散客（時段未對應場次，無法在地圖配桌）</div>
                      {walkins.unscheduled.map(r => (
                        <WalkinRow key={r.booking.id} row={r} onAssign={null} onOpen={onOpenWalkin} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 無場次設定時退回平鋪列表 */}
          {noSeatings && hasGroups && (
            <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
              {dayGroups.map(g => {
                const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned
                const times = (g.batches || []).map(b => b.timeSlot).filter(Boolean).sort()
                return (
                  <button key={g.id} type="button" onClick={() => onSelectGroup(g.id)}
                    className="tap w-full text-left flex items-center gap-2 min-h-[46px] px-3.5 border-t border-chicken-brown/[0.06] first:border-t-0">
                    <Icon name="bus" size={18} className="text-chicken-red" />
                    <span className="text-sm font-semibold text-chicken-brown truncate">{g.agencyName || '（未填旅行社）'}</span>
                    <span className="text-xs text-chicken-brown/60 tabular-nums">{times[0] || '未排'}{times.length > 1 ? ` +${times.length - 1}` : ''} · {g.counts?.total || 0} 位</span>
                    <span className="flex-1" />
                    <Pill cls={st.cls}>{st.label}</Pill>
                    <Icon name="chevronRight" size={14} strokeWidth={2.2} className="text-chicken-brown/30" />
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <EmptyState icon={<Icon name="bus" size={28} className="text-chicken-brown/30" />} title="這天還沒有團單"
          hint={s.closed ? '本日公休；如需仍可建立團單' : '點右上「新增團單」或各場次的「新增團單」開始預排'} />
      )}
    </div>
  )
}
