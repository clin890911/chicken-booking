import { useMemo, useRef } from 'react'
import { groupTableNumbers } from '../../../utils/capacity'

// 旅行社回傳單：單一自包含 SVG（抬頭 + 人數結構表 + 座位圖）。
// 同一份 SVG 同時支援：
//   1) 列印 / 另存 PDF（@media print + @page A4）
//   2) 存成 PNG 圖片貼 LINE（SVG → canvas → toBlob，原生 API、不加重相依）
// 座位圖以「該團桌位的 bounding box」縮放聚焦，非該團桌灰階淡化保留方位感；跨樓層自動分區塊。

const SHEET_W = 794   // A4 portrait @96dpi
const SHEET_H = 1123

function floorBBox(groupTables) {
  if (!groupTables.length) return { x: 0, y: 0, w: 1200, h: 800 }
  const pad = 70
  const xs = groupTables.map(t => t.x)
  const ys = groupTables.map(t => t.y)
  const xe = groupTables.map(t => t.x + t.w)
  const ye = groupTables.map(t => t.y + t.h)
  const x = Math.max(0, Math.min(...xs) - pad)
  const y = Math.max(0, Math.min(...ys) - pad)
  const w = Math.min(1200, Math.max(...xe) + pad) - x
  const h = Math.min(800, Math.max(...ye) + pad) - y
  return { x, y, w, h }
}

export default function GroupSheet({ group, tables = [], store = {}, onClose }) {
  const svgRef = useRef(null)

  const groupTableNums = useMemo(() => new Set(groupTableNumbers(group)), [group])
  const tableByNumber = useMemo(() => {
    const m = {}
    tables.forEach(t => { m[t.number] = t })
    return m
  }, [tables])

  // 該團用到的樓層（依桌位推導）
  const floorsUsed = useMemo(() => {
    const set = new Set()
    groupTableNums.forEach(n => { const t = tableByNumber[n]; if (t) set.add(t.floor) })
    return [...set].sort()
  }, [groupTableNums, tableByNumber])

  const heldSeats = useMemo(
    () => [...groupTableNums].reduce((s, n) => s + (tableByNumber[n]?.capacity || 0), 0),
    [groupTableNums, tableByNumber],
  )

  const storeName = store.storeName || store.name || '雞王涮涮鍋'
  const c = group.counts || {}

  const exportPng = () => {
    const svg = svgRef.current
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const svg64 = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = SHEET_W * scale
      canvas.height = SHEET_H * scale
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `回傳單_${group.agencyName || '團體'}_${group.date}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    }
    img.src = svg64
  }

  // === 座位圖（每樓層一塊，嵌入巢狀 svg 用 bbox viewBox 自動縮放）===
  const mapAreaY = 470
  const mapAreaH = SHEET_H - mapAreaY - 30
  const blockH = floorsUsed.length ? Math.floor(mapAreaH / floorsUsed.length) : mapAreaH

  const renderFloorBlock = (floor, idx) => {
    const floorTables = tables.filter(t => t.floor === floor)
    const groupFloorTables = floorTables.filter(t => groupTableNums.has(t.number))
    const bb = floorBBox(groupFloorTables)
    const top = mapAreaY + idx * blockH
    const innerTop = top + 26
    const innerH = blockH - 34
    return (
      <g key={floor}>
        <text x={40} y={top + 16} fontSize={15} fontWeight="700" fill="#3a2e26">
          {floor === '1F' ? '1F 主用餐區' : '2F 用餐區'}
        </text>
        <rect x={40} y={innerTop} width={SHEET_W - 80} height={innerH} rx={8} fill="#f8fafc" stroke="#cbd5e1" />
        <svg x={44} y={innerTop + 4} width={SHEET_W - 88} height={innerH - 8}
             viewBox={`${bb.x} ${bb.y} ${bb.w} ${bb.h}`} preserveAspectRatio="xMidYMid meet">
          {floorTables.map(t => {
            const mine = groupTableNums.has(t.number)
            return (
              <g key={t.number} opacity={mine ? 1 : 0.28}>
                <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={8}
                      fill={mine ? '#4f46e5' : '#e2e8f0'} stroke={mine ? '#3730a3' : '#94a3b8'} strokeWidth={mine ? 2 : 1} />
                <text x={t.x + t.w / 2} y={t.y + t.h / 2 - 2} fontSize={16} fontWeight="800"
                      fill={mine ? '#ffffff' : '#475569'} textAnchor="middle">{t.number}</text>
                <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 16} fontSize={11}
                      fill={mine ? '#ffffff' : '#64748b'} textAnchor="middle">{t.capacity} 人</text>
              </g>
            )
          })}
        </svg>
      </g>
    )
  }

  const countBox = (label, value, x, accent = '#3a2e26') => (
    <g>
      <rect x={x} y={250} width={138} height={64} rx={8} fill="#ffffff" stroke="#e2d9cd" />
      <text x={x + 12} y={274} fontSize={12} fill="#8a7e72">{label}</text>
      <text x={x + 12} y={302} fontSize={26} fontWeight="800" fill={accent}>{value}</text>
    </g>
  )

  const infoRow = (label, value, y) => (
    <g>
      <text x={40} y={y} fontSize={13} fill="#8a7e72">{label}</text>
      <text x={150} y={y} fontSize={15} fontWeight="700" fill="#3a2e26">{value || '—'}</text>
    </g>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #group-sheet-print, #group-sheet-print * { visibility: visible !important; }
          #group-sheet-print { position: absolute; left: 0; top: 0; width: 100%; }
          #group-sheet-actions { display: none !important; }
          @page { size: A4 portrait; margin: 8mm; }
        }
      `}</style>
      <div className="min-h-full flex flex-col items-center py-6 px-3" onClick={e => e.stopPropagation()}>
        <div id="group-sheet-actions" className="mb-3 flex gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-chicken-red text-white font-bold text-sm">🖨 列印 / 存 PDF</button>
          <button onClick={exportPng} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm">📷 存成圖片（傳 LINE）</button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white border-2 border-chicken-brown/15 text-chicken-brown font-bold text-sm">關閉</button>
        </div>

        <div id="group-sheet-print" className="bg-white shadow-xl">
          <svg ref={svgRef} width={SHEET_W} height={SHEET_H} viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
               xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: 'system-ui, -apple-system, "Noto Sans TC", sans-serif' }}>
            <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />
            {/* 抬頭 */}
            <rect x={0} y={0} width={SHEET_W} height={70} fill="#e60012" />
            <text x={40} y={34} fontSize={22} fontWeight="800" fill="#ffffff">{storeName} · 旅行社座位確認單</text>
            <text x={40} y={56} fontSize={13} fill="#ffffff" opacity={0.9}>{store.storeAddress || store.address || ''}　{store.storePhone || store.phone || ''}</text>

            {/* 基本資訊 */}
            {infoRow('旅行社', group.agencyName, 110)}
            {infoRow('導遊', `${group.guideName || ''}${group.guidePhone ? `（${group.guidePhone}）` : ''}`, 138)}
            {infoRow('用餐日期', group.date, 166)}
            {infoRow('梯次', (group.batches || []).map(b => `${b.label} ${b.timeSlot}（${b.guests}人）`).join('　'), 194)}
            {infoRow('保留桌', [...groupTableNums].sort().join('、'), 222)}

            {/* 人數結構 */}
            {countBox('總人數', c.total || 0, 40, '#e60012')}
            {countBox('素食', c.vegetarian || 0, 188, '#16a34a')}
            {countBox('兒童', c.child || 0, 336, '#0284c7')}
            {countBox('行動不便', c.mobility || 0, 484, '#b45309')}
            {countBox('輪椅', c.wheelchair || 0, 632, '#7c3aed')}

            {/* 特殊需求 */}
            <rect x={40} y={330} width={SHEET_W - 80} height={110} rx={8} fill="#fff7ed" stroke="#fed7aa" />
            <text x={52} y={352} fontSize={13} fontWeight="700" fill="#9a3412">特殊需求</text>
            <text x={52} y={378} fontSize={13} fill="#3a2e26">過敏：{group.allergyText || '—'}</text>
            <text x={52} y={402} fontSize={13} fill="#3a2e26">桌邊需求：{group.tableSideNeeds || '—'}</text>
            <text x={52} y={426} fontSize={13} fill="#3a2e26">遊覽車 / 備註：{group.busInfo || '—'}{group.notes ? `　${group.notes}` : ''}</text>

            <text x={40} y={462} fontSize={14} fontWeight="700" fill="#3a2e26">座位圖（保留 {heldSeats} 席 · 共 {groupTableNums.size} 桌）</text>

            {floorsUsed.length
              ? floorsUsed.map((f, i) => renderFloorBlock(f, i))
              : <text x={40} y={520} fontSize={14} fill="#8a7e72">尚未圈選桌位</text>}
          </svg>
        </div>
      </div>
    </div>
  )
}
