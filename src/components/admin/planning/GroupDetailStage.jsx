import { useMemo, useState } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import Icon from '../../ui/Icon'
import StatGroup from '../../ui/StatGroup'
import SegmentedControl from '../../ui/SegmentedControl'
import FloorMap from '../floormap/FloorMap'
import GroupSheet from '../group/GroupSheet'
import { dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { groupTableNumbers, guestBatches } from '../../../utils/capacity'

const STATUS_LABEL = {
  planned: { label: '已預排', cls: 'bg-chicken-brown/[0.08] text-chicken-brown/80' },
  confirmed: { label: '已確認', cls: 'bg-chicken-yellow/[0.14] text-[#b06600]' },
  arrived: { label: '已到店', cls: 'bg-chicken-green/15 text-[#5b8c1f]' },
  completed: { label: '已完成', cls: 'bg-chicken-brown text-white' },
  cancelled: { label: '已取消', cls: 'bg-chicken-red/10 text-chicken-red' },
}

// 備餐需求列（與規劃頁備餐重點同一組圖示 / 顏色）
const NEEDS = [
  { key: 'vegetarian', label: '素食', icon: 'leaf', color: 'text-[#5b8c1f]', unit: '份' },
  { key: 'child', label: '兒童', icon: 'child', color: 'text-sky-600', unit: '位' },
  { key: 'mobility', label: '行動不便', icon: 'walk', color: 'text-amber-600', unit: '位' },
  { key: 'wheelchair', label: '輪椅', icon: 'wheelchair', color: 'text-violet-600', unit: '位' },
]

function SectionTitle({ children }) {
  return <h3 className="px-1 text-xs font-semibold text-chicken-brown/55 tracking-wide">{children}</h3>
}
function Row({ children, className = '' }) {
  return <div className={`flex items-center gap-2.5 min-h-[44px] px-3.5 text-sm ${className}`}>{children}</div>
}
function Pill({ cls, children }) {
  return <span className={`inline-flex items-center h-[22px] px-2 rounded-full text-[11px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>
}

// 團單詳情（唯讀確認頁）：點團卡 / 儲存後落地於此。
// 領位與備餐視角的彙整 + 回傳單輸出；要改內容才進編輯精靈（onEdit）。
export default function GroupDetailStage({ group, tables, settings, onBack, onEdit, onReschedule }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const { fixtures, zones } = useBooking()

  const st = STATUS_LABEL[group.status] || STATUS_LABEL.planned
  // 可改期：僅限尚未入座的團（planned/confirmed）。入座後 status→arrived，桌帶 currentRef，
  // 不得整團搬日；已完成/已取消亦不可改期。
  const canReschedule = ['planned', 'confirmed'].includes(group.status)
  const counts = group.counts || {}
  const batches = group.batches || []
  const gBatches = guestBatches(group)            // 旅客梯次（排除司領桌）
  const singleGuest = gBatches.length === 1
  const batchGuests = (b) => (b && !b.isEscort && singleGuest) ? (Number(counts.total) || 0) : (Number(b?.guests) || 0)

  const capByNum = useMemo(() => {
    const m = {}; (tables || []).forEach(t => { m[t.number] = Number(t.capacity) || 0 }); return m
  }, [tables])
  const heldNumbers = useMemo(() => groupTableNumbers(group), [group])
  const heldSeats = useMemo(() => heldNumbers.reduce((s, n) => s + (capByNum[n] || 0), 0), [heldNumbers, capByNum])

  // 座位示意只列有圈桌的樓層；無圈桌則不渲染地圖
  const floorsWithTables = useMemo(() => {
    const byNum = {}; (tables || []).forEach(t => { byNum[t.number] = t.floor || '1F' })
    return [...new Set(heldNumbers.map(n => byNum[n]).filter(Boolean))].sort()
  }, [tables, heldNumbers])
  const [floor, setFloor] = useState(null)
  const activeFloor = floor && floorsWithTables.includes(floor) ? floor : (floorsWithTables[0] || '1F')

  const needRows = NEEDS.filter(n => (Number(counts[n.key]) || 0) > 0)
  const noNeeds = needRows.length === 0 && !(group.allergyText || '').trim() && !(group.tableSideNeeds || '').trim() && !(group.notes || '').trim()

  return (
    <div className="space-y-3">
      {/* 頂部：返回 + 標題 + 動作 */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <button type="button" onClick={onBack} className="tap inline-flex items-center gap-0.5 h-8 pr-2 rounded-lg text-[13px] font-semibold text-chicken-brown/60 hover:text-chicken-brown">
          <Icon name="chevronLeft" size={14} strokeWidth={2.4} />返回當日總覽
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => setSheetOpen(true)} className="tap inline-flex items-center gap-1 h-9 px-3 rounded-[9px] bg-white border border-chicken-brown/15 text-[13px] font-semibold text-chicken-brown"><Icon name="print" size={14} />回傳單</button>
        {canReschedule && onReschedule && (
          <button type="button" onClick={onReschedule} className="tap inline-flex items-center gap-1 h-9 px-3 rounded-[9px] bg-white border border-chicken-brown/15 text-[13px] font-semibold text-chicken-brown"><Icon name="calendar" size={14} />改期</button>
        )}
        <button type="button" onClick={onEdit} className="tap inline-flex items-center gap-1 h-9 px-3.5 rounded-[9px] bg-chicken-red text-white text-[13px] font-semibold shadow-sm">編輯</button>
      </div>
      <div className="flex items-center gap-2 flex-wrap px-1">
        <Icon name="bus" size={20} className="text-chicken-red" />
        <h2 className="text-xl font-semibold tracking-tight text-chicken-brown">{group.agencyName || '（未填旅行社）'}</h2>
        <Pill cls={st.cls}>{st.label}</Pill>
        <span className="text-sm text-chicken-brown/60 tabular-nums">{dayLabel(group.date)}</span>
      </div>

      {/* 三格統計 */}
      <StatGroup items={[
        { label: '總人數', big: counts.total || 0, small: '位' },
        { label: '梯次', big: gBatches.length, small: gBatches.length > 1 ? '梯 · 分批用餐' : '梯' },
        { label: '保留', big: heldNumbers.length, small: `桌 · ${heldSeats} 席` },
      ]} />

      {/* 梯次與桌位 */}
      <div className="space-y-1.5">
        <SectionTitle>梯次與桌位</SectionTitle>
        <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden divide-y divide-chicken-brown/[0.08]">
          {batches.map(b => {
            const sea = seatingForSlot(settings, b.timeSlot)
            const nums = (b.tableNumbers || []).map(String)
            return (
              <div key={b.id} className="px-3.5 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${b.isEscort ? 'text-indigo-700' : 'text-chicken-brown'}`}>{b.isEscort ? '司領桌' : b.label}</span>
                  {sea && !b.isEscort && <span className="text-xs text-chicken-brown/60">{sea.name}</span>}
                  <span className="text-xs text-chicken-brown/60 tabular-nums">{b.timeSlot || '未排'} · {batchGuests(b)} 位</span>
                  <span className="flex-1" />
                  {nums.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {nums.map(n => (
                        <span key={n} className="inline-flex items-center h-[22px] px-2 rounded-md bg-indigo-50 text-indigo-700 text-xs font-semibold tabular-nums">{n}</span>
                      ))}
                    </span>
                  ) : (
                    <Pill cls="bg-amber-100 text-amber-700">未圈桌</Pill>
                  )}
                </div>
                {b.note && <div className="text-xs text-chicken-brown/55">{b.note}</div>}
              </div>
            )
          })}
          {batches.length === 0 && <div className="px-3.5 py-3 text-xs text-chicken-brown/40">尚無梯次</div>}
        </div>
      </div>

      {/* 聯絡 / 接駁 */}
      <div className="space-y-1.5">
        <SectionTitle>聯絡 / 接駁</SectionTitle>
        <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden divide-y divide-chicken-brown/[0.08]">
          <Row><span className="text-chicken-brown/60 shrink-0">旅行社</span><span className="flex-1" /><span className="font-semibold text-chicken-brown text-right">{group.agencyName || '（未填）'}</span></Row>
          <Row>
            <span className="text-chicken-brown/60 shrink-0">導遊</span><span className="flex-1" />
            <span className="font-semibold text-chicken-brown text-right">{group.guideName || '（未填）'}</span>
            {group.guidePhone && (
              <a href={`tel:${group.guidePhone}`} className="inline-flex items-center gap-1 text-chicken-red font-semibold tabular-nums"><Icon name="phone" size={13} />{group.guidePhone}</a>
            )}
          </Row>
          <Row><span className="text-chicken-brown/60 shrink-0">遊覽車 / 司機</span><span className="flex-1" /><span className="font-semibold text-chicken-brown text-right">{group.busInfo || '（未填）'}</span></Row>
        </div>
      </div>

      {/* 備餐重點 */}
      <div className="space-y-1.5">
        <SectionTitle>備餐重點</SectionTitle>
        <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden divide-y divide-chicken-brown/[0.08]">
          {needRows.map(n => (
            <Row key={n.key}>
              <Icon name={n.icon} size={18} className={n.color} />
              <span className="font-semibold text-chicken-brown">{n.label}</span>
              <span className="flex-1" />
              <span className={`text-[15px] font-semibold tabular-nums ${n.color}`}>{counts[n.key]} <span className="text-xs font-medium">{n.unit}</span></span>
            </Row>
          ))}
          {(group.allergyText || '').trim() && (
            <Row><Icon name="warning" size={18} className="text-chicken-red" /><span className="font-semibold text-chicken-brown shrink-0">過敏 / 禁忌</span><span className="flex-1" /><span className="text-chicken-red font-semibold text-right">{group.allergyText.trim()}</span></Row>
          )}
          {(group.tableSideNeeds || '').trim() && (
            <Row><Icon name="utensils" size={18} className="text-chicken-brown/60" /><span className="font-semibold text-chicken-brown shrink-0">桌邊需求</span><span className="flex-1" /><span className="text-chicken-brown/80 text-right">{group.tableSideNeeds.trim()}</span></Row>
          )}
          {(group.notes || '').trim() && (
            <Row><Icon name="info" size={18} className="text-chicken-brown/60" /><span className="font-semibold text-chicken-brown shrink-0">備註</span><span className="flex-1" /><span className="text-chicken-brown/80 text-right">{group.notes.trim()}</span></Row>
          )}
          {(Number(group.spend) || 0) > 0 && (
            <Row><Icon name="receipt" size={18} className="text-chicken-brown/60" /><span className="font-semibold text-chicken-brown shrink-0">消費金額</span><span className="flex-1" /><span className="font-semibold text-chicken-brown tabular-nums">${Number(group.spend).toLocaleString()}</span></Row>
          )}
          {noNeeds && <div className="px-3.5 py-3 text-xs text-chicken-brown/40">無特殊需求</div>}
        </div>
      </div>

      {/* 座位示意（唯讀） */}
      {heldNumbers.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 px-1">
            <SectionTitle>座位示意</SectionTitle>
            <span className="flex-1" />
            {floorsWithTables.length > 1 && (
              <SegmentedControl size="sm" ariaLabel="樓層" value={activeFloor} onChange={setFloor} options={floorsWithTables.map(f => ({ key: f, label: f }))} />
            )}
          </div>
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-2.5">
            <div className="rounded-lg overflow-hidden border border-chicken-brown/5 min-h-[320px]" style={{ background: '#faf8f5' }}>
              <FloorMap
                floor={activeFloor}
                tables={tables}
                settings={settings}
                planningMode
                selectedTables={heldNumbers}
                blockedTables={[]}
                mapDate={group?.date}
                fixtures={fixtures}
                zones={zones}
                onSelectTable={() => {}}
              />
            </div>
            <div className="text-center text-[11px] text-chicken-brown/45 mt-2">靛色 = 本團保留桌 · 要調整圈桌請點右上「編輯」</div>
          </div>
        </div>
      )}

      {sheetOpen && (
        <GroupSheet group={group} tables={tables} store={settings} fixtureSource={fixtures} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  )
}
