import { useMemo, useState } from 'react'
import { Button } from '../../ui'
import FloorMap from '../floormap/FloorMap'
import GroupSheet from '../group/GroupSheet'
import { dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { groupTableNumbers } from '../../../utils/capacity'

const STATUS_LABEL = {
  planned: { label: '已預排', cls: 'bg-chicken-brown/10 text-chicken-brown' },
  confirmed: { label: '已確認', cls: 'bg-chicken-yellow/15 text-chicken-yellow' },
  arrived: { label: '已到店', cls: 'bg-chicken-green/15 text-chicken-green' },
  completed: { label: '已完成', cls: 'bg-chicken-brown text-white' },
  cancelled: { label: '已取消', cls: 'bg-chicken-red/10 text-chicken-red' },
}

const QUICK_NEEDS = [
  { key: 'vegetarian', label: '素食', cls: 'bg-chicken-green/15 text-chicken-green' },
  { key: 'child', label: '兒童', cls: 'bg-sky-100 text-sky-700' },
  { key: 'mobility', label: '行動不便', cls: 'bg-amber-100 text-amber-700' },
  { key: 'wheelchair', label: '輪椅', cls: 'bg-violet-100 text-violet-700' },
]

// 團單詳情（唯讀確認頁）：點團卡 / 儲存後落地於此。
// 領位與備餐視角的彙整 + 回傳單輸出；要改內容才進編輯精靈（onEdit）。
export default function GroupDetailStage({ group, tables, settings, onBack, onEdit }) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const st = STATUS_LABEL[group.status] || STATUS_LABEL.planned
  const counts = group.counts || {}
  const batches = group.batches || []
  const singleBatch = batches.length === 1
  const batchGuests = (b) => singleBatch ? (Number(counts.total) || 0) : (Number(b?.guests) || 0)

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

  return (
    <div className="space-y-3">
      {/* 頂部：返回 + 標題 + 動作 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button onClick={onBack} className="text-sm font-bold text-chicken-brown/70 hover:text-chicken-brown">← 返回當日總覽</button>
          <div className="flex gap-1.5">
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>🖨 回傳單</Button>
            <Button onClick={onEdit}>✏️ 編輯</Button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-black text-chicken-brown">🚌 {group.agencyName || '（未填旅行社）'}</span>
          <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-chicken-cream px-2.5 py-1 text-xs font-black text-chicken-brown">📅 {dayLabel(group.date)}</span>
        </div>
      </div>

      {/* 三大數字 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-chicken-brown/10 text-chicken-brown p-2.5 text-center">
          <div className="text-[11px] font-bold opacity-80">👥 總人數</div>
          <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">{counts.total || 0}</div>
        </div>
        <div className="rounded-xl bg-indigo-50 text-indigo-700 p-2.5 text-center">
          <div className="text-[11px] font-bold opacity-80">🚌 梯次</div>
          <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">{batches.length}</div>
        </div>
        <div className="rounded-xl bg-chicken-yellow/15 text-chicken-yellow p-2.5 text-center">
          <div className="text-[11px] font-bold opacity-80">🪑 保留</div>
          <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">
            {heldNumbers.length}<span className="text-sm">桌</span> <span className="text-sm">{heldSeats} 席</span>
          </div>
        </div>
      </div>

      {/* 梯次與桌位 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
        <h3 className="font-bold text-chicken-brown text-sm mb-2">梯次與桌位</h3>
        <div className="space-y-2">
          {batches.map(b => {
            const sea = seatingForSlot(settings, b.timeSlot)
            const nums = (b.tableNumbers || []).map(String)
            return (
              <div key={b.id} className="rounded-lg border border-chicken-brown/10 bg-chicken-cream/30 p-2.5 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black text-chicken-brown">{b.label}</span>
                {sea && <span className="rounded-full bg-chicken-brown/5 px-2 py-0.5 text-xs font-bold text-chicken-brown/70">{sea.name}</span>}
                <span className="px-2 py-0.5 rounded-full bg-white text-chicken-brown text-xs font-bold tabular-nums">🕐 {b.timeSlot || '未排'}</span>
                <span className="px-2 py-0.5 rounded-full bg-white text-chicken-brown text-xs font-bold tabular-nums">👥 {batchGuests(b)} 位</span>
                {nums.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {nums.map(n => (
                      <span key={n} className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-black tabular-nums">{n}</span>
                    ))}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">未圈桌</span>
                )}
                {b.note && <span className="text-xs text-chicken-brown/55 w-full">📝 {b.note}</span>}
              </div>
            )
          })}
          {batches.length === 0 && <div className="text-xs text-chicken-brown/40">尚無梯次</div>}
        </div>
      </div>

      {/* 聯絡 / 接駁 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-4">
        <h3 className="font-bold text-chicken-brown text-sm mb-2">聯絡 / 接駁</h3>
        <dl className="text-sm divide-y divide-chicken-brown/10">
          <div className="flex justify-between py-1.5 gap-3">
            <dt className="text-chicken-brown/60 shrink-0">旅行社</dt>
            <dd className="font-bold text-chicken-brown text-right">{group.agencyName || '（未填）'}</dd>
          </div>
          <div className="flex justify-between py-1.5 gap-3">
            <dt className="text-chicken-brown/60 shrink-0">導遊</dt>
            <dd className="font-bold text-chicken-brown text-right">
              {group.guideName || '（未填）'}
              {group.guidePhone && (
                <a href={`tel:${group.guidePhone}`} className="ml-2 text-chicken-red underline tabular-nums">📞 {group.guidePhone}</a>
              )}
            </dd>
          </div>
          <div className="flex justify-between py-1.5 gap-3">
            <dt className="text-chicken-brown/60 shrink-0">遊覽車 / 司機</dt>
            <dd className="font-bold text-chicken-brown text-right">{group.busInfo || '（未填）'}</dd>
          </div>
        </dl>
      </div>

      {/* 備餐重點 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-4 space-y-2">
        <h3 className="font-bold text-chicken-brown text-sm">備餐重點</h3>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_NEEDS.filter(n => (Number(counts[n.key]) || 0) > 0).map(n => (
            <span key={n.key} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${n.cls}`}>{n.label} {counts[n.key]}</span>
          ))}
          {QUICK_NEEDS.every(n => (Number(counts[n.key]) || 0) === 0) && !(group.allergyText || '').trim() && (
            <span className="text-[11px] text-chicken-brown/40">無特殊需求</span>
          )}
        </div>
        {(group.allergyText || '').trim() && (
          <div className="rounded-lg bg-chicken-red text-white px-3 py-2 text-xs font-bold">⚠ 過敏：{group.allergyText.trim()}</div>
        )}
        {(group.tableSideNeeds || '').trim() && (
          <div className="text-xs text-chicken-brown"><span className="text-chicken-brown/60">桌邊需求：</span>{group.tableSideNeeds.trim()}</div>
        )}
        {(group.notes || '').trim() && (
          <div className="text-xs text-chicken-brown"><span className="text-chicken-brown/60">備註：</span>{group.notes.trim()}</div>
        )}
        {(Number(group.spend) || 0) > 0 && (
          <div className="text-xs text-chicken-brown"><span className="text-chicken-brown/60">消費金額：</span><span className="font-bold tabular-nums">${Number(group.spend).toLocaleString()}</span></div>
        )}
      </div>

      {/* 座位示意（唯讀） */}
      {heldNumbers.length > 0 && (
        <div className="bg-white rounded-xl border border-chicken-brown/10 p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h3 className="font-bold text-chicken-brown text-sm">座位示意</h3>
            {floorsWithTables.length > 1 && (
              <div className="flex gap-1.5">
                {floorsWithTables.map(f => (
                  <button key={f} onClick={() => setFloor(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 ${activeFloor === f ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>{f}</button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-lg overflow-hidden border border-chicken-brown/5 min-h-[320px]" style={{ background: '#faf8f5' }}>
            <FloorMap
              floor={activeFloor}
              tables={tables}
              settings={settings}
              planningMode
              selectedTables={heldNumbers}
              blockedTables={[]}
              mapDate={group?.date}
              onSelectTable={() => {}}
            />
          </div>
          <div className="text-center text-[11px] text-chicken-brown/45 mt-2">藍紫色＝本團保留桌 · 要調整圈桌請點右上「✏️ 編輯」</div>
        </div>
      )}

      {sheetOpen && (
        <GroupSheet group={group} tables={tables} store={settings} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  )
}
