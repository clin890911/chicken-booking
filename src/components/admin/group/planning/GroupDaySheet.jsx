import { useEffect, useMemo, useRef, useState } from 'react'
import { groupTableNumbers } from '../../../../utils/capacity'
import { dayLabel } from '../../../../utils/timeSlots'

// 當日團體預排總表（給廚房 / 外場當天備餐用的紙本）。
// 沿用 GroupSheet.jsx 模板手法：自包含 A4 SVG、@media print（A4）、SVG→PNG 匯出。
// 內容：日期 + 本日彙總（團數/人數/保留/備餐總量）+ 每團一列（旅行社·導遊·梯次·桌·人數·過敏/桌邊）+ 抵達高峰提醒。

const C = {
  red: '#e60012', redDark: '#b80010', yellow: '#f29100', green: '#9eb63a',
  cream: '#FAF7F0', brown: '#3a2e26', brownSoft: '#8a7e72', line: '#ece4d8',
}
const SHEET_W = 794   // A4 portrait @96dpi
const SHEET_H = 1123
const M = 36
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export default function GroupDaySheet({ date, daySummary, groups = [], store = {}, onClose }) {
  const svgRef = useRef(null)
  const [logo, setLogo] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/brand/master-of-chicken-logo.jpg')
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b) }))
      .then(uri => { if (!cancelled) setLogo(uri) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const storeName = store.storeName || store.name || '雞王涮涮鍋'
  const counts = daySummary?.prep?.counts || {}
  const collisions = useMemo(
    () => (daySummary?.warnings || []).filter(w => w.type === 'collision'),
    [daySummary],
  )

  // 依最早抵達時間排序，給每團整理一列資料
  const rows = useMemo(() => {
    return [...groups]
      .map(g => {
        const times = (g.batches || []).map(b => b.timeSlot).filter(Boolean).sort()
        return {
          id: g.id,
          agencyName: g.agencyName || '（未填旅行社）',
          guideName: g.guideName || '',
          guidePhone: g.guidePhone || '',
          batchLabel: (g.batches || []).map(b => `${b.timeSlot || '—'}`).join('、') || '未排梯',
          tables: groupTableNumbers(g),
          total: g.counts?.total || 0,
          allergy: g.allergyText || '',
          tableside: g.tableSideNeeds || '',
        }
      })
      .sort((a, b) => (a.batchLabel || '').localeCompare(b.batchLabel || ''))
  }, [groups])

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
        a.download = `當日團體預排總表_${date}.png`
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(u), 1000)
      }, 'image/png')
    }
    img.src = url
  }

  const statChip = (x, y, label, value, accent) => (
    <g>
      <rect x={x} y={y} width={118} height={48} rx={10} fill="#ffffff" stroke={C.line} />
      <rect x={x} y={y} width={5} height={48} rx={2.5} fill={accent} />
      <text x={x + 16} y={y + 20} fontSize={11} fill={C.brownSoft}>{label}</text>
      <text x={x + 16} y={y + 40} fontSize={20} fontWeight="800" fill={C.brown}>{value}</text>
    </g>
  )

  const LIST_TOP = 300
  const ROW_H = 58
  const MAX_ROWS = 12
  const shown = rows.slice(0, MAX_ROWS)
  const overflow = rows.length - shown.length

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #group-day-sheet-print, #group-day-sheet-print * { visibility: visible !important; }
          #group-day-sheet-print { position: absolute; left: 0; top: 0; width: 100%; }
          #group-day-sheet-actions { display: none !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
      <div className="min-h-full flex flex-col items-center py-6 px-3" onClick={e => e.stopPropagation()}>
        <div id="group-day-sheet-actions" className="mb-3 flex gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-chicken-red text-white font-bold text-sm shadow">🖨 列印 / 存 PDF</button>
          <button onClick={exportPng} className="px-4 py-2 rounded-xl bg-chicken-brown text-white font-bold text-sm shadow">📷 存成圖片</button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white border-2 border-chicken-brown/15 text-chicken-brown font-bold text-sm">關閉</button>
        </div>

        <div id="group-day-sheet-print" className="bg-white shadow-2xl rounded-sm overflow-hidden">
          <svg ref={svgRef} width={SHEET_W} height={SHEET_H} viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
            xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: 'system-ui, -apple-system, "Noto Sans TC", "PingFang TC", sans-serif' }}>
            <defs>
              <clipPath id="dayLogoClip"><circle cx="78" cy="56" r="34" /></clipPath>
            </defs>

            <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />
            <rect x={0} y={0} width={SHEET_W} height={8} fill={C.red} />

            {/* Header */}
            <rect x={0} y={8} width={SHEET_W} height={104} fill={C.cream} />
            <circle cx={78} cy={56} r={37} fill="#ffffff" stroke={C.line} />
            {logo
              ? <image href={logo} x={44} y={22} width={68} height={68} clipPath="url(#dayLogoClip)" preserveAspectRatio="xMidYMid slice" />
              : <text x={78} y={64} fontSize={26} fontWeight="800" fill={C.red} textAnchor="middle">王</text>}
            <text x={134} y={50} fontSize={27} fontWeight="800" fill={C.brown}>{storeName}</text>
            <text x={135} y={74} fontSize={12} fontWeight="700" fill={C.red} letterSpacing="3">MASTER OF CHICKEN</text>
            <rect x={566} y={30} width={192} height={32} rx={16} fill={C.red} />
            <text x={662} y={51} fontSize={15} fontWeight="800" fill="#ffffff" textAnchor="middle">當日團體預排總表</text>
            <text x={758} y={84} fontSize={13} fontWeight="700" fill={C.brown} textAnchor="end">{dayLabel(date)}{daySummary?.closed ? '（公休）' : ''}</text>

            {/* 彙總列 */}
            {statChip(M, 126, '本日團數', `${daySummary?.groupCount || 0} 團`, C.red)}
            {statChip(M + 130, 126, '總人數', `${daySummary?.guests || 0} 位`, C.brown)}
            {statChip(M + 260, 126, '保留桌數', `${daySummary?.heldTableCount || 0} 桌`, C.yellow)}
            {statChip(M + 390, 126, '保留席數', `${daySummary?.heldSeats || 0} 席`, C.green)}

            <text x={M} y={206} fontSize={12.5} fontWeight="700" fill={C.brownSoft}>備餐總量</text>
            {statChip(M, 214, '素食', `${counts.vegetarian || 0}`, C.green)}
            {statChip(M + 130, 214, '兒童', `${counts.child || 0}`, C.yellow)}
            {statChip(M + 260, 214, '行動不便', `${counts.mobility || 0}`, '#b45309')}
            {statChip(M + 390, 214, '輪椅', `${counts.wheelchair || 0}`, '#7c3aed')}

            {/* 抵達高峰提醒 */}
            <rect x={M + 524} y={126} width={SHEET_W - M - (M + 524)} height={136} rx={12} fill={collisions.length ? '#fff7ed' : C.cream} stroke={collisions.length ? '#fed7aa' : C.line} />
            <text x={M + 540} y={150} fontSize={12} fontWeight="800" fill={collisions.length ? '#c2410c' : C.brown}>⚠ 抵達高峰</text>
            {collisions.length ? collisions.slice(0, 5).map((c, i) => (
              <text key={i} x={M + 540} y={172 + i * 18} fontSize={11} fill="#9a3412">{c.timeSlot} {c.count}團/{c.guests}位</text>
            )) : <text x={M + 540} y={172} fontSize={11} fill={C.brownSoft}>無同時段多團</text>}

            {/* 團單列表 */}
            <text x={M} y={290} fontSize={13} fontWeight="800" fill={C.brown}>團單明細</text>
            <text x={M + 250} y={290} fontSize={11} fontWeight="700" fill={C.brownSoft}>梯次抵達</text>
            <text x={M + 392} y={290} fontSize={11} fontWeight="700" fill={C.brownSoft}>保留桌號</text>
            <text x={SHEET_W - M - 14} y={290} fontSize={11} fontWeight="700" fill={C.brownSoft} textAnchor="end">人數</text>

            {shown.length === 0 && (
              <text x={SHEET_W / 2} y={LIST_TOP + 60} fontSize={15} fill={C.brownSoft} textAnchor="middle">本日尚無團單</text>
            )}
            {shown.map((r, i) => {
              const y = LIST_TOP + i * ROW_H
              const needs = [r.allergy && `過敏：${r.allergy}`, r.tableside && `桌邊：${r.tableside}`].filter(Boolean).join('　')
              return (
                <g key={r.id}>
                  <rect x={M} y={y} width={SHEET_W - 2 * M} height={ROW_H - 8} rx={10} fill="#ffffff" stroke={C.line} />
                  <rect x={M} y={y} width={5} height={ROW_H - 8} rx={2.5} fill={C.red} />
                  <text x={M + 16} y={y + 22} fontSize={15} fontWeight="800" fill={C.brown}>{clip(r.agencyName, 12)}</text>
                  <text x={M + 16} y={y + 40} fontSize={11} fill={C.brownSoft}>{clip(`${r.guideName}${r.guidePhone ? ` ${r.guidePhone}` : ''}` || '—', 16)}{needs ? `　${clip(needs, 28)}` : ''}</text>
                  <text x={M + 250} y={y + 30} fontSize={13} fontWeight="700" fill={C.brown}>{clip(r.batchLabel, 14)}</text>
                  <text x={M + 392} y={y + 30} fontSize={13} fontWeight="700" fill={C.brown}>{clip(r.tables.join('、') || '未圈', 14)}</text>
                  <text x={SHEET_W - M - 14} y={y + 30} fontSize={18} fontWeight="800" fill={C.red} textAnchor="end">{r.total}</text>
                </g>
              )
            })}
            {overflow > 0 && (
              <text x={M} y={LIST_TOP + MAX_ROWS * ROW_H + 16} fontSize={12} fontWeight="700" fill={C.brownSoft}>※ 其餘 {overflow} 團詳見後台「團體 → 預排規劃」</text>
            )}

            {/* Footer */}
            <line x1={M} y1={1066} x2={SHEET_W - M} y2={1066} stroke={C.line} />
            <text x={M} y={1086} fontSize={11.5} fontWeight="700" fill={C.brown}>備餐提醒</text>
            <text x={M} y={1102} fontSize={11} fill={C.brownSoft}>請依各團抵達時間預備桌邊與特殊餐食；輪椅 / 行動不便團建議安排 1F 地面層。</text>
            <text x={SHEET_W - M} y={1086} fontSize={11} fontWeight="700" fill={C.brown} textAnchor="end">{store.storePhone || store.phone || '049-2753377'}</text>
            <text x={SHEET_W - M} y={1102} fontSize={10.5} fill={C.brownSoft} textAnchor="end">{store.storeAddress || store.address || '南投縣鹿谷鄉中正路二段377號'}</text>
          </svg>
        </div>
      </div>
    </div>
  )
}
