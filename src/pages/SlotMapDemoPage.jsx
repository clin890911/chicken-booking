// ⚠️ Phase 0 概念 Demo（純前端 mock，不接後端、不動既有流程）
// 目的：給老闆看「依日期 + 場次切換、同時呈現散客(暖色)與團客(冷色)佔位」的統一座位地圖概念。
// 路由：/demo/slot-map（免登入）。正式版邏輯見 plan：resolveSlotOccupancy + FloorMap scoped 分支。
import { useMemo, useState } from 'react'
import { INITIAL_TABLES, FLOOR_VIEWBOX, FIXTURES } from '../data/tables'
import StatsCard from '../components/admin/StatsCard'

// ── Mock：場次設定（正式版會放 settings.seatings，老闆可在後台自訂）──
const SEATINGS = [
  { id: 'L1', name: '午餐第一批', start: '11:00', end: '12:30' },
  { id: 'L2', name: '午餐第二批', start: '12:30', end: '14:00' },
  { id: 'D1', name: '晚餐第一批', start: '17:00', end: '18:30' },
]

// ── Mock：關閉設定（正式版會放 settings.closures，後台可勾選）──
// 6/9 的「午餐第二批」整批關閉訂位（示範「無法關閉時段」修好後的樣子）。
const CLOSURES = {
  closedDates: ['2026-06-12'],                 // 整天公休（示範）
  closedSeatings: { '2026-06-09': ['L2'] },    // 某天某場次關閉
}

// ── Mock：散客訂位（bookings）。部分已預先配桌、部分尚未指派（到店才配）──
const MOCK_BOOKINGS = [
  { id: 'b1', name: '王小明', guests: 4, date: '2026-06-09', timeSlot: '11:00', assignedTableId: '101', status: 'confirmed' },
  { id: 'b2', name: '陳大文', guests: 2, date: '2026-06-09', timeSlot: '11:30', assignedTableId: '107', status: 'confirmed' },
  { id: 'b3', name: '林家四口', guests: 4, date: '2026-06-09', timeSlot: '11:00', assignedTableId: null, status: 'confirmed' },
  { id: 'b4', name: '黃先生', guests: 3, date: '2026-06-09', timeSlot: '12:00', assignedTableId: null, status: 'confirmed' },
  { id: 'b5', name: '吳小姐', guests: 2, date: '2026-06-09', timeSlot: '11:30', assignedTableId: '111', status: 'confirmed' },
  // 晚餐第一批
  { id: 'b6', name: '張先生', guests: 4, date: '2026-06-09', timeSlot: '17:00', assignedTableId: '251', status: 'confirmed' },
  { id: 'b7', name: '蔡家', guests: 5, date: '2026-06-09', timeSlot: '17:30', assignedTableId: null, status: 'confirmed' },
]

// ── Mock：團體預排（groupReservations）。每團一到多梯、整桌保留 ──
const MOCK_GROUPS = [
  {
    id: 'g1', date: '2026-06-09', agencyName: '幸福旅行社', guideName: '小芳', status: 'confirmed',
    batches: [{ id: 'g1b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['102', '103'], guests: 12 }],
  },
  {
    id: 'g2', date: '2026-06-09', agencyName: '大來旅行社', guideName: '阿明', status: 'confirmed',
    batches: [{ id: 'g2b1', label: '第一梯', timeSlot: '17:00', tableNumbers: ['201', '202', '203'], guests: 18 }],
  },
]

const DATES = ['2026-06-09', '2026-06-10', '2026-06-12']

// 顏色語彙：散客=暖色(橙)、團客=冷色(靛)、空桌=淺色、關閉=灰
const COLOR = {
  walkin: { fill: '#ea580c', stroke: '#c2410c' },
  group: { fill: '#4f46e5', stroke: '#3730a3' },
  free: { fill: '#e2e8f0', stroke: '#94a3b8', text: '#334155' },
  closed: { fill: '#cbd5e1', stroke: '#94a3b8', text: '#64748b' },
}

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
const inSeating = (timeSlot, seating) => {
  const x = toMin(timeSlot)
  return x >= toMin(seating.start) && x < toMin(seating.end)
}
const dateLabel = (d) => {
  const dt = new Date(d + 'T00:00:00')
  const w = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()]
  return `${dt.getMonth() + 1}/${dt.getDate()} (${w})`
}

// Demo 版佔用解析器（正式版 = utils/capacity.js resolveSlotOccupancy，複用容量 helper）
function resolveOccupancy(date, seating) {
  const byTable = {}
  let walkinGuests = 0, unassignedWalkinGuests = 0, groupHeldSeats = 0
  const capByNum = {}
  INITIAL_TABLES.forEach(t => { capByNum[t.number] = t.capacity })

  MOCK_BOOKINGS.filter(b => b.date === date && inSeating(b.timeSlot, seating)).forEach(b => {
    walkinGuests += b.guests
    if (b.assignedTableId) byTable[b.assignedTableId] = { kind: 'walkin', label: b.name, sub: `${b.guests}人 · ${b.timeSlot}` }
    else unassignedWalkinGuests += b.guests
  })

  MOCK_GROUPS.filter(g => g.date === date).forEach(g => {
    g.batches.filter(bt => inSeating(bt.timeSlot, seating)).forEach(bt => {
      bt.tableNumbers.forEach(n => {
        if (!byTable[n]) { byTable[n] = { kind: 'group', label: g.agencyName, sub: `${bt.label} · ${bt.timeSlot}` }; groupHeldSeats += capByNum[n] || 0 }
      })
    })
  })

  const totalSeats = INITIAL_TABLES.filter(t => t.isActive).reduce((s, t) => s + t.capacity, 0)
  const remaining = Math.max(0, totalSeats - walkinGuests - groupHeldSeats)
  return { byTable, summary: { totalSeats, walkinGuests, unassignedWalkinGuests, groupHeldSeats, remaining } }
}

function isClosed(date, seatingId) {
  return CLOSURES.closedDates.includes(date) || (CLOSURES.closedSeatings[date] || []).includes(seatingId)
}

function Fixtures({ floor }) {
  return (
    <g pointerEvents="none">
      {(FIXTURES[floor] || []).map((f, i) => {
        if (f.type === 'label') return <text key={i} x={f.x} y={f.y} fontSize={15} fontWeight={700} fill="#6b5b4d">{f.text}</text>
        const cx = f.x + f.w / 2, cy = f.y + f.h / 2
        return (
          <g key={i}>
            <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={4} fill={f.type === 'stairs' ? '#f1ede8' : '#ece7e1'} stroke="#bcae9f" />
            <text x={cx} y={cy} fontSize={12} fontWeight={700} fill="#6b5b4d" textAnchor="middle" dominantBaseline="central"
              transform={f.vtext ? `rotate(90 ${cx} ${cy})` : undefined}>{f.text}</text>
          </g>
        )
      })}
    </g>
  )
}

export default function SlotMapDemoPage() {
  const [date, setDate] = useState('2026-06-09')
  const [seatingId, setSeatingId] = useState('L1')
  const [floor, setFloor] = useState('1F')

  const seating = SEATINGS.find(s => s.id === seatingId) || SEATINGS[0]
  const closed = isClosed(date, seatingId)
  const { byTable, summary } = useMemo(() => resolveOccupancy(date, seating), [date, seatingId])
  const floorTables = INITIAL_TABLES.filter(t => t.floor === floor)

  return (
    <div className="min-h-screen bg-chicken-cream/40 p-3 sm:p-5">
      <div className="max-w-6xl mx-auto space-y-3">
        {/* 標題 */}
        <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-black text-chicken-brown">🗺️ 統一座位地圖</h1>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-chicken-yellow/20 text-chicken-brown">概念 Demo · mock 資料</span>
          </div>
          <p className="text-xs text-chicken-brown/60 mt-1">依「日期 + 場次」切換，同時看散客（暖色）與團客（冷色）佔位。此頁為概念展示，未接後端。</p>
        </div>

        {/* 日期 + 場次 選擇器 */}
        <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4 space-y-3">
          <div>
            <div className="text-xs font-bold text-chicken-brown/55 mb-1.5">選擇日期</div>
            <div className="flex gap-1.5 flex-wrap">
              {DATES.map(d => (
                <button key={d} onClick={() => setDate(d)}
                  className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all ${date === d ? 'bg-chicken-red border-chicken-red text-white shadow' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                  {dateLabel(d)}{CLOSURES.closedDates.includes(d) ? ' · 公休' : ''}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-chicken-brown/55 mb-1.5">選擇場次（批次）</div>
            <div className="flex gap-1.5 flex-wrap">
              {SEATINGS.map(s => {
                const c = isClosed(date, s.id)
                return (
                  <button key={s.id} onClick={() => setSeatingId(s.id)}
                    className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all ${seatingId === s.id ? 'bg-indigo-600 border-indigo-600 text-white shadow' : c ? 'bg-slate-100 border-slate-200 text-slate-400 line-through' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                    {s.name}
                    <span className="ml-1 text-[10px] opacity-70">{s.start}–{s.end}</span>
                    {c && <span className="ml-1 text-[10px]">🚫</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 關閉徽章 */}
        {closed && (
          <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl px-4 py-3 flex items-center gap-2">
            <span className="text-xl">🚫</span>
            <div>
              <div className="font-black text-rose-700 text-sm">此場次已關閉訂位</div>
              <div className="text-xs text-rose-600/80">{dateLabel(date)} · {seating.name}（{seating.start}–{seating.end}）— 停止接收新散客 / 團體訂位，既有訂位不受影響。</div>
            </div>
          </div>
        )}

        {/* 容量摘要卡 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatsCard icon="🪑" label="全店座位" value={summary.totalSeats} color="brown" />
          <StatsCard icon="🧍" label="散客已訂(人)" value={summary.walkinGuests} color="yellow" />
          <StatsCard icon="🚌" label="團客保留(席)" value={summary.groupHeldSeats} color="red" />
          <StatsCard icon="✅" label="剩餘可訂(席)" value={closed ? 0 : summary.remaining} color="green" />
        </div>
        {summary.unassignedWalkinGuests > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">
            ⚠️ 尚有 <span className="text-base">{summary.unassignedWalkinGuests}</span> 位散客已訂位但未配桌（到店才指派／可在地圖預先配桌）
          </div>
        )}

        {/* 地圖 */}
        <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="flex gap-1.5">
              {['1F', '2F'].map(f => (
                <button key={f} onClick={() => setFloor(f)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border-2 ${floor === f ? 'bg-chicken-red border-chicken-red text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                  {f === '1F' ? '1F 主用餐區' : '2F 用餐區'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] font-bold text-chicken-brown/60 flex-wrap">
              <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded" style={{ background: COLOR.walkin.fill }} />散客</span>
              <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded" style={{ background: COLOR.group.fill }} />團客</span>
              <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded border" style={{ background: COLOR.free.fill }} />空桌</span>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden border border-chicken-brown/5" style={{ background: '#faf8f5' }}>
            <svg viewBox={`0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto">
              <text x={20} y={36} fontSize={28} fontWeight={800} fill="#3a2e26" opacity={0.12}>{floor === '1F' ? '1F · 主用餐區' : '2F · 用餐區'}</text>
              <Fixtures floor={floor} />
              {floorTables.map(t => {
                const occ = byTable[t.number]
                const kind = closed ? 'closed' : occ ? occ.kind : 'free'
                const c = COLOR[kind]
                const textFill = (kind === 'free' || kind === 'closed') ? c.text : '#ffffff'
                return (
                  <g key={t.number} opacity={closed ? 0.55 : 1}>
                    <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={8} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} />
                    <text x={t.x + t.w / 2} y={t.y + 22} fontSize={15} fontWeight={800} fill={textFill} textAnchor="middle" pointerEvents="none">{t.number}</text>
                    <text x={t.x + t.w / 2} y={t.y + 37} fontSize={9} fontWeight={600} fill={textFill} opacity={0.9} textAnchor="middle" pointerEvents="none">{t.capacity}人</text>
                    {occ && !closed && (
                      <text x={t.x + t.w / 2} y={t.y + t.h - 8} fontSize={8.5} fontWeight={700} fill={textFill} textAnchor="middle" pointerEvents="none">
                        {occ.label.length > 5 ? occ.label.slice(0, 5) : occ.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="text-center text-[11px] text-chicken-brown/45 mt-2">
            概念展示 · 桌上顯示佔用者（散客姓名 / 團客旅行社）· 正式版可點桌看詳情並預先配桌
          </div>
        </div>
      </div>
    </div>
  )
}
