import { useMemo, useRef, useState, useEffect } from 'react'
import { groupTableNumbers } from '../../../utils/capacity'
import { FIXTURES } from '../../../data/tables'

// 旅行社回傳單（給導遊）— 品牌化專業模板。
// 單一自包含 SVG，同時支援：列印 / 另存 PDF（@media print + A4）與 存成 PNG 傳 LINE（SVG→canvas→toBlob）。
// 設計重點：座位圖為主視覺 —— 您的桌位以品牌紅 + 椅位標示醒目呈現，其他桌與設施淡化作方位參考。

// 品牌色
const C = {
  red: '#e60012',
  redDark: '#b80010',
  yellow: '#f29100',
  green: '#9eb63a',
  cream: '#FAF7F0',
  brown: '#3a2e26',
  brownSoft: '#8a7e72',
  line: '#ece4d8',
  ctx: '#e7e9ee',       // 其他桌（淡灰）
  ctxStroke: '#cfd4dc',
  ctxText: '#9aa1ab',
}

const SHEET_W = 794   // A4 portrait @96dpi
const SHEET_H = 1123
const M = 36          // 邊距

function floorBBox(groupTables) {
  if (!groupTables.length) return { x: 0, y: 0, w: 1200, h: 800 }
  const pad = 90
  const x = Math.max(0, Math.min(...groupTables.map(t => t.x)) - pad)
  const y = Math.max(0, Math.min(...groupTables.map(t => t.y)) - pad)
  const w = Math.min(1200, Math.max(...groupTables.map(t => t.x + t.w)) + pad) - x
  const h = Math.min(800, Math.max(...groupTables.map(t => t.y + t.h)) + pad) - y
  return { x, y, w, h }
}

export default function GroupSheet({ group, tables = [], store = {}, fixtureSource = null, onClose }) {
  const svgRef = useRef(null)
  const [logo, setLogo] = useState(null)

  // 載入品牌 logo 並轉成 data URI（SVG 匯出 PNG 時外部資源不會載入，必須內嵌）
  useEffect(() => {
    let cancelled = false
    fetch('/brand/master-of-chicken-logo.jpg')
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b) }))
      .then(uri => { if (!cancelled) setLogo(uri) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const groupNums = useMemo(() => new Set(groupTableNumbers(group)), [group])
  const tableByNumber = useMemo(() => {
    const m = {}; tables.forEach(t => { m[t.number] = t }); return m
  }, [tables])
  const floorsUsed = useMemo(() => {
    const s = new Set(); groupNums.forEach(n => { const t = tableByNumber[n]; if (t) s.add(t.floor) }); return [...s].sort()
  }, [groupNums, tableByNumber])
  const heldSeats = useMemo(
    () => [...groupNums].reduce((s, n) => s + (tableByNumber[n]?.capacity || 0), 0),
    [groupNums, tableByNumber],
  )
  const c = group.counts || {}
  const storeName = store.storeName || store.name || '雞王涮涮鍋'

  // 兩段用餐是否共用同一批桌
  const batches = group.batches || []
  const sameTablesAllBatches = batches.length > 1 &&
    batches.every(b => JSON.stringify([...(b.tableNumbers || [])].sort()) === JSON.stringify([...(batches[0].tableNumbers || [])].sort()))

  // 桌號（主資訊）：依數字排序；桌數多時自動縮字級避免溢出
  const tablesStr = [...groupNums].sort((a, b) => Number(a) - Number(b)).join('、') || '尚未圈桌'
  const tableFont = tablesStr.length > 26 ? 18 : tablesStr.length > 16 ? 24 : 30

  // 次要資訊（極簡版收進頁尾一行小字；只列非空/非零者）
  const extras = []
  if (c.vegetarian) extras.push(`素食 ${c.vegetarian}`)
  if (c.child) extras.push(`兒童 ${c.child}`)
  if (c.mobility) extras.push(`行動不便 ${c.mobility}`)
  if (c.wheelchair) extras.push(`輪椅 ${c.wheelchair}`)
  if (group.allergyText) extras.push(`過敏：${group.allergyText}`)
  if (group.tableSideNeeds) extras.push(`桌邊：${group.tableSideNeeds}`)
  if (group.busInfo) extras.push(`遊覽車：${group.busInfo}`)
  const extrasText = extras.length ? extras.join('　·　') : '無特殊需求'

  const exportPng = () => {
    const svg = svgRef.current
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
    const img = new Image()
    img.onload = () => {
      const scale = 2.5
      const canvas = document.createElement('canvas')
      canvas.width = SHEET_W * scale
      canvas.height = SHEET_H * scale
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        if (!blob) return
        const u = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = u
        a.download = `回傳單_${group.agencyName || '團體'}_${group.date}.png`
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(u), 1000)
      }, 'image/png')
    }
    img.src = url
  }

  // 椅位小標（讓桌子像「有椅子的餐桌」）—— 沿桌子上下緣排列
  const seatPips = (t, color) => {
    const cap = t.capacity || 0
    const top = Math.ceil(cap / 2), bot = cap - top
    const out = []
    const row = (n, yy, key) => {
      if (!n) return
      const gap = 5, cw = (t.w - gap * (n + 1)) / n
      for (let i = 0; i < n; i++) {
        out.push(<rect key={`${key}-${i}`} x={t.x + gap + i * (cw + gap)} y={yy} width={cw} height={7} rx={3.5} fill={color} opacity={0.5} />)
      }
    }
    row(top, t.y - 11, 'tp')
    row(bot, t.y + t.h + 4, 'bt')
    return out
  }

  // 單一樓層座位圖卡片
  const renderFloorCard = (floor, x, y, w, h) => {
    const floorTables = tables.filter(t => t.floor === floor)
    const mine = floorTables.filter(t => groupNums.has(t.number))
    const bb = floorBBox(mine)
    const innerX = x + 14, innerY = y + 40, innerW = w - 28, innerH = h - 54
    const fixtures = (fixtureSource && fixtureSource[floor]) || FIXTURES?.[floor] || []
    return (
      <g key={floor}>
        <rect x={x} y={y} width={w} height={h} rx={16} fill="#ffffff" stroke={C.line} filter="url(#cardShadow)" />
        <circle cx={x + 22} cy={y + 22} r={5} fill={C.red} />
        <text x={x + 36} y={y + 27} fontSize={15} fontWeight="800" fill={C.brown}>
          {floor === '1F' ? '1F · 主用餐區' : '2F · 用餐區'}
        </text>
        <text x={x + w - 14} y={y + 27} fontSize={12} fontWeight="700" fill={C.brownSoft} textAnchor="end">
          {mine.map(t => t.number).sort().join('、')}
        </text>
        <rect x={innerX} y={innerY} width={innerW} height={innerH} rx={10} fill={C.cream} />
        <svg x={innerX} y={innerY} width={innerW} height={innerH} viewBox={`${bb.x} ${bb.y} ${bb.w} ${bb.h}`} preserveAspectRatio="xMidYMid meet">
          {/* 設施（方位參考，淡化） */}
          {fixtures.map((f, i) => {
            if (f.type === 'label') return <text key={`fx${i}`} x={f.x} y={f.y} fontSize={15} fontWeight="700" fill="#c3bcb1">{f.text}</text>
            const cx = f.x + f.w / 2, cy = f.y + f.h / 2
            return (
              <g key={`fx${i}`} opacity={0.6}>
                <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={4} fill="#f0ebe3" stroke="#d8cfc2" />
                <text x={cx} y={cy} fontSize={11} fontWeight="700" fill="#b3a99c" textAnchor="middle" dominantBaseline="central"
                  transform={f.vtext ? `rotate(90 ${cx} ${cy})` : undefined}>{f.text}</text>
              </g>
            )
          })}
          {/* 其他桌（淡化作參考） */}
          {floorTables.filter(t => !groupNums.has(t.number)).map(t => (
            <g key={t.number} opacity={0.7}>
              <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={8} fill={C.ctx} stroke={C.ctxStroke} strokeWidth={1} />
              <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 5} fontSize={14} fontWeight="700" fill={C.ctxText} textAnchor="middle">{t.number}</text>
            </g>
          ))}
          {/* 您的桌位（品牌紅 + 椅位 + 陰影） */}
          {mine.map(t => (
            <g key={t.number}>
              {seatPips(t, C.red)}
              <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={9} fill={C.red} stroke={C.redDark} strokeWidth={2} filter="url(#tableShadow)" />
              <text x={t.x + t.w / 2} y={t.y + t.h / 2 - 4} fontSize={20} fontWeight="800" fill="#ffffff" textAnchor="middle">{t.number}</text>
              <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 16} fontSize={12} fontWeight="700" fill="#ffffff" opacity={0.92} textAnchor="middle">{t.capacity} 席</text>
            </g>
          ))}
        </svg>
      </g>
    )
  }

  // 座位圖區域配置（極簡版：上移 + 放大成主視覺）
  const mapTop = 356
  const mapBottom = 1006
  const mapH = mapBottom - mapTop
  const floorCards = floorsUsed.length === 0
    ? null
    : floorsUsed.length === 1
      ? renderFloorCard(floorsUsed[0], M, mapTop, SHEET_W - 2 * M, mapH)
      : floorsUsed.map((f, i) => renderFloorCard(f, M, mapTop + i * (mapH / 2 + 6) - (i ? 6 : 0), SHEET_W - 2 * M, mapH / 2 - 6))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #group-sheet-print, #group-sheet-print * { visibility: visible !important; }
          #group-sheet-print { position: absolute; left: 0; top: 0; width: 100%; }
          #group-sheet-actions { display: none !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
      <div className="min-h-full flex flex-col items-center py-6 px-3" onClick={e => e.stopPropagation()}>
        <div id="group-sheet-actions" className="mb-3 flex gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-chicken-red text-white font-bold text-sm shadow">🖨 列印 / 存 PDF</button>
          <button onClick={exportPng} className="px-4 py-2 rounded-xl bg-chicken-brown text-white font-bold text-sm shadow">📷 存成圖片（傳 LINE）</button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white border-2 border-chicken-brown/15 text-chicken-brown font-bold text-sm">關閉</button>
        </div>

        <div id="group-sheet-print" className="bg-white shadow-2xl rounded-sm overflow-hidden">
          <svg ref={svgRef} width={SHEET_W} height={SHEET_H} viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
            xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: 'system-ui, -apple-system, "Noto Sans TC", "PingFang TC", sans-serif' }}>
            <defs>
              <filter id="cardShadow" x="-8%" y="-8%" width="116%" height="120%">
                <feDropShadow dx="0" dy="3" stdDeviation="6" floodColor="#3a2e26" floodOpacity="0.10" />
              </filter>
              <filter id="tableShadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#b80010" floodOpacity="0.35" />
              </filter>
              <clipPath id="logoClip"><circle cx="78" cy="56" r="34" /></clipPath>
            </defs>

            <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />
            {/* 頂部品牌色條 */}
            <rect x={0} y={0} width={SHEET_W} height={8} fill={C.red} />

            {/* === Header === */}
            <rect x={0} y={8} width={SHEET_W} height={104} fill={C.cream} />
            <circle cx={78} cy={56} r={37} fill="#ffffff" stroke={C.line} />
            {logo
              ? <image href={logo} x={44} y={22} width={68} height={68} clipPath="url(#logoClip)" preserveAspectRatio="xMidYMid slice" />
              : <text x={78} y={64} fontSize={26} fontWeight="800" fill={C.red} textAnchor="middle">王</text>}
            <text x={134} y={50} fontSize={27} fontWeight="800" fill={C.brown}>{storeName}</text>
            <text x={135} y={74} fontSize={12} fontWeight="700" fill={C.red} letterSpacing="3">MASTER OF CHICKEN</text>
            <rect x={566} y={30} width={192} height={32} rx={16} fill={C.red} />
            <text x={662} y={51} fontSize={15} fontWeight="800" fill="#ffffff" textAnchor="middle">團體座位確認單</text>
            <text x={758} y={84} fontSize={13} fontWeight="700" fill={C.brown} textAnchor="end">用餐日期 {group.date}</text>

            {/* === 關鍵資訊（極簡：旅行社 / 導遊 / 梯次） === */}
            <text x={M} y={148} fontSize={11.5} fill={C.brownSoft}>旅行社</text>
            <text x={M} y={173} fontSize={21} fontWeight="800" fill={C.brown}>{group.agencyName || '—'}</text>
            <text x={M + 400} y={148} fontSize={11.5} fill={C.brownSoft}>導遊</text>
            <text x={M + 400} y={173} fontSize={21} fontWeight="800" fill={C.brown}>{group.guideName || '—'}{group.guidePhone ? `　${group.guidePhone}` : ''}</text>
            <text x={M} y={206} fontSize={11.5} fill={C.brownSoft}>梯次</text>
            <text x={M} y={229} fontSize={18} fontWeight="800" fill={C.brown}>{batches.map(b => `${b.label} ${b.timeSlot}`).join('　／　') || '—'}</text>
            {sameTablesAllBatches && (
              <text x={M + 360} y={228} fontSize={12} fontWeight="700" fill={C.yellow}>※ 兩梯次共用同一批桌位</text>
            )}

            {/* === 桌號（主資訊帶） === */}
            <rect x={M} y={250} width={SHEET_W - 2 * M} height={78} rx={14} fill={C.cream} stroke={C.line} />
            <text x={M + 22} y={278} fontSize={12.5} fontWeight="700" fill={C.red}>您的桌位</text>
            <text x={M + 22} y={311} fontSize={tableFont} fontWeight="800" fill={C.brown}>{tablesStr}</text>
            <line x1={SHEET_W - M - 214} y1={266} x2={SHEET_W - M - 214} y2={312} stroke={C.line} />
            <text x={SHEET_W - M - 22} y={277} fontSize={12.5} fill={C.brownSoft} textAnchor="end">用餐總人數</text>
            <text x={SHEET_W - M - 22} y={308} fontSize={25} fontWeight="800" fill={C.red} textAnchor="end">
              {c.total || 0}<tspan fontSize={13} fill={C.brownSoft} fontWeight="700">　位 · {groupNums.size} 桌 {heldSeats} 席</tspan>
            </text>

            {/* === 座位圖（主視覺） === */}
            <text x={M} y={348} fontSize={14} fontWeight="800" fill={C.brown}>座位圖</text>
            <g>
              <rect x={SHEET_W - M - 168} y={336} width={15} height={15} rx={4} fill={C.red} />
              <text x={SHEET_W - M - 148} y={348} fontSize={11.5} fontWeight="700" fill={C.brown}>您的桌位</text>
              <rect x={SHEET_W - M - 78} y={336} width={15} height={15} rx={4} fill={C.ctx} stroke={C.ctxStroke} />
              <text x={SHEET_W - M - 58} y={348} fontSize={11.5} fontWeight="700" fill={C.brownSoft}>其他桌</text>
            </g>

            {floorCards || (
              <g>
                <rect x={M} y={mapTop} width={SHEET_W - 2 * M} height={mapH} rx={16} fill="#ffffff" stroke={C.line} />
                <text x={SHEET_W / 2} y={mapTop + mapH / 2} fontSize={16} fill={C.brownSoft} textAnchor="middle">尚未圈選桌位</text>
              </g>
            )}

            {/* === Footer（次要資訊收於此一行小字） === */}
            <line x1={M} y1={1020} x2={SHEET_W - M} y2={1020} stroke={C.line} />
            <text x={M} y={1041} fontSize={11} fill={C.brownSoft}>特殊需求　<tspan fontWeight="700" fill={C.brown}>{extrasText}</tspan></text>
            <text x={M} y={1078} fontSize={11.5} fontWeight="700" fill={C.brown}>溫馨提醒</text>
            <text x={M} y={1094} fontSize={10.5} fill={C.brownSoft}>請於用餐時段前 5–10 分鐘抵達，由領位台引導入座；如需調整人數或時間，請提前與門市聯繫。</text>
            <text x={SHEET_W - M} y={1078} fontSize={11} fontWeight="700" fill={C.brown} textAnchor="end">{store.storePhone || store.phone || '049-2753377'}</text>
            <text x={SHEET_W - M} y={1094} fontSize={10} fill={C.brownSoft} textAnchor="end">{store.storeAddress || store.address || '南投縣鹿谷鄉中正路二段377號'}</text>
          </svg>
        </div>
      </div>
    </div>
  )
}
