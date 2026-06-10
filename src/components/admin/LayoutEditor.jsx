import { useState, useRef, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBooking } from '../../contexts/BookingContext'
import { useToast, useConfirm } from '../ui/Toast'
import { FLOOR_VIEWBOX, INITIAL_TABLES, tableDims } from '../../data/tables'

// 全螢幕桌位佈局編輯器
// 操作：
// - 拖拉桌位移動位置（snap to grid 10）
// - 點選桌位 → 右側編輯面板（容量、樓層、啟用、刪除）
// - 點空白處 → 新增桌位於該位置
// - 1F / 2F 切換
// - 儲存（持久化所有變更） / 取消（捨棄）

const STATUS_FILL = {
  vacant:   '#86efac',  // 編輯模式下用淡色，避免跟運營狀態混淆
  reserved: '#fde68a',
  dining:   '#fca5a5',
  cleaning: '#fdba74',
  blocked:  '#cbd5e1',
}

export default function LayoutEditor({ open, onClose }) {
  const { tables, bulkSaveTables, resetTables, removeTable: serviceRemoveTable } = useBooking()
  const toast = useToast()
  const confirmDialog = useConfirm()

  // 本地狀態（編輯中、未存檔）
  const [localTables, setLocalTables] = useState(() => tables.map(t => ({ ...t })))
  const [floor, setFloor] = useState('1F')
  const [selectedNumber, setSelectedNumber] = useState(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(null) // { x, y } when clicked empty
  const svgRef = useRef(null)

  // 進入編輯時 reset localTables 為當前 tables
  useEffect(() => {
    if (open) {
      setLocalTables(tables.map(t => ({ ...t })))
      setIsDirty(false)
      setSelectedNumber(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const selected = useMemo(
    () => selectedNumber ? localTables.find(t => t.number === selectedNumber) : null,
    [selectedNumber, localTables]
  )

  // 把螢幕座標換成 SVG viewBox 座標
  const screenToSvg = (clientX, clientY) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const scaleX = FLOOR_VIEWBOX.width / rect.width
    const scaleY = FLOOR_VIEWBOX.height / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const updateLocal = (number, patch) => {
    setLocalTables(list => list.map(t => t.number === number ? { ...t, ...patch } : t))
    setIsDirty(true)
  }

  // === Drag handling ===
  const dragRef = useRef(null) // { number, offsetX, offsetY }

  const handleTablePointerDown = (e, table) => {
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    const { x, y } = screenToSvg(e.clientX, e.clientY)
    dragRef.current = {
      number: table.number,
      offsetX: x - table.x,
      offsetY: y - table.y,
      moved: false,
    }
    setSelectedNumber(table.number)
  }

  const handleSvgPointerMove = (e) => {
    if (!dragRef.current) return
    const { x, y } = screenToSvg(e.clientX, e.clientY)
    const drag = dragRef.current
    let nx = Math.round((x - drag.offsetX) / 10) * 10
    let ny = Math.round((y - drag.offsetY) / 10) * 10
    const t = localTables.find(t => t.number === drag.number)
    if (!t) return
    nx = Math.max(0, Math.min(FLOOR_VIEWBOX.width - t.w, nx))
    ny = Math.max(0, Math.min(FLOOR_VIEWBOX.height - t.h, ny))
    drag.moved = true
    updateLocal(drag.number, { x: nx, y: ny })
  }

  const handleSvgPointerUp = () => {
    dragRef.current = null
  }

  // 點空白處 → 提示新增桌位
  const handleSvgClick = (e) => {
    if (e.target.tagName !== 'svg') return
    if (dragRef.current?.moved) return
    const { x, y } = screenToSvg(e.clientX, e.clientY)
    setShowAddDialog({ x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 })
  }

  // === Edit panel ops ===
  const handleCapacityChange = (capacity) => {
    if (!selected) return
    // 依容量自動帶入寬高（六人桌橫式 90×75、四人桌 80×75），與預設佈局同一來源。
    updateLocal(selected.number, { capacity, ...tableDims(capacity) })
  }

  const handleFloorChange = (newFloor) => {
    if (!selected) return
    updateLocal(selected.number, { floor: newFloor })
    setFloor(newFloor)
  }

  const handleActiveToggle = () => {
    if (!selected) return
    updateLocal(selected.number, { isActive: !selected.isActive })
  }

  const handleDelete = async () => {
    if (!selected) return
    if (selected.currentBookingId) {
      return toast.error('此桌目前有訂位/用餐，無法刪除')
    }
    const ok = await confirmDialog(`刪除桌位 ${selected.number}？\n此動作不可復原`,
      { title: '刪除桌位', confirmLabel: '刪除', danger: true })
    if (!ok) return
    setLocalTables(list => list.filter(t => t.number !== selected.number))
    setSelectedNumber(null)
    setIsDirty(true)
  }

  // === Add new table ===
  const [newTableForm, setNewTableForm] = useState({ capacity: 4 })

  const handleAddTable = () => {
    if (!showAddDialog) return
    const capacity = newTableForm.capacity
    const prefix = capacity === 6 ? 'B' : 'A'
    const used = new Set(localTables.filter(t => t.number.startsWith(prefix)).map(t => parseInt(t.number.slice(1), 10)).filter(n => !isNaN(n)))
    let n = 1
    while (used.has(n)) n++
    const newTable = {
      number: `${prefix}${n}`,
      capacity,
      floor,
      x: showAddDialog.x,
      y: showAddDialog.y,
      ...tableDims(capacity),
      isActive: true,
      status: 'vacant',
      currentBookingId: null,
      seatedAt: null,
      mergedWith: null,
      blockReason: null,
      updatedAt: new Date().toISOString(),
    }
    setLocalTables(list => [...list, newTable])
    setSelectedNumber(newTable.number)
    setIsDirty(true)
    setShowAddDialog(null)
    toast.success(`已新增 ${newTable.number}`)
  }

  // === Save / Cancel / Reset ===
  const handleSave = () => {
    bulkSaveTables(localTables)
    toast.success(`✅ 已儲存 ${localTables.length} 張桌位`)
    onClose?.()
  }

  const handleCancel = async () => {
    if (isDirty) {
      const ok = await confirmDialog('有未儲存的變更，確定捨棄？', { title: '取消編輯', danger: true })
      if (!ok) return
    }
    onClose?.()
  }

  const handleReset = async () => {
    const ok = await confirmDialog('將桌位佈局重設為預設值（52 桌、原始位置）？目前所有變更會被覆蓋。',
      { title: '重設預設佈局', danger: true })
    if (!ok) return
    setLocalTables(INITIAL_TABLES.map(t => ({ ...t })))
    setIsDirty(true)
    toast.info('已載入預設佈局，記得按儲存')
  }

  // 統計
  const floorTables = localTables.filter(t => t.floor === floor)
  const stats = useMemo(() => ({
    total: localTables.length,
    f1: localTables.filter(t => t.floor === '1F').length,
    f2: localTables.filter(t => t.floor === '2F').length,
    cap4: localTables.filter(t => t.capacity === 4).length,
    cap6: localTables.filter(t => t.capacity === 6).length,
  }), [localTables])

  // ESC 取消
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') handleCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDirty])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-chicken-cream flex flex-col"
        >
          {/* === Header === */}
          <header className="bg-chicken-brown text-white px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <span className="text-2xl">🛠</span>
            <div className="flex-1">
              <h1 className="text-base font-black leading-tight">桌位佈局編輯器</h1>
              <p className="text-[11px] opacity-80 leading-tight">
                {stats.total} 桌（4P×{stats.cap4} + 6P×{stats.cap6}）· 1F:{stats.f1} · 2F:{stats.f2}
                {isDirty && <span className="ml-2 px-1.5 py-0.5 bg-chicken-yellow text-chicken-brown rounded text-[10px] font-black">未儲存</span>}
              </p>
            </div>
            <button onClick={handleReset} className="px-3 py-1.5 min-h-[44px] text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg">↺ 重設預設</button>
            <button onClick={handleCancel} className="px-3 py-1.5 min-h-[44px] text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg flex items-center gap-1.5">
              {isDirty ? (
                <>
                  返回
                  <span className="px-1.5 py-0.5 bg-chicken-yellow text-chicken-brown rounded text-[10px] font-black">有未儲存</span>
                </>
              ) : '返回'}
            </button>
            <button onClick={handleSave} disabled={!isDirty}
                    className={`px-4 py-1.5 min-h-[44px] text-xs font-bold rounded-lg
                      ${isDirty ? 'bg-chicken-green text-white hover:opacity-90' : 'bg-white/10 text-white/40 cursor-not-allowed'}`}>
              💾 儲存並返回
            </button>
          </header>

          {/* === 樓層切換 + 工具列 === */}
          <div className="bg-white border-b border-chicken-brown/10 px-4 py-2 flex items-center gap-2 flex-wrap flex-shrink-0">
            <div className="flex gap-1.5">
              {['1F', '2F'].map(f => (
                <button
                  key={f}
                  onClick={() => setFloor(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${
                    floor === f ? 'bg-chicken-red border-chicken-red text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'
                  }`}
                >{f}（{f === '1F' ? stats.f1 : stats.f2}）</button>
              ))}
            </div>
            <div className="text-xs text-chicken-brown/60 ml-2">
              💡 拖桌移動 · 點選桌看右側編輯 · 點空白新增 · 對齊 10px 網格
            </div>
          </div>

          {/* === 主區：地圖 + 編輯面板 === */}
          <div className="flex-1 flex overflow-hidden">
            {/* 編輯地圖 */}
            <div className="flex-1 p-3 overflow-hidden">
              <div className="bg-white rounded-2xl border border-chicken-brown/10 h-full overflow-hidden">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="w-full h-full"
                  onPointerMove={handleSvgPointerMove}
                  onPointerUp={handleSvgPointerUp}
                  onPointerLeave={handleSvgPointerUp}
                  onClick={handleSvgClick}
                  style={{ cursor: 'crosshair' }}
                >
                  {/* 網格背景 */}
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e0d8" strokeWidth="0.5"/>
                    </pattern>
                  </defs>
                  <rect width={FLOOR_VIEWBOX.width} height={FLOOR_VIEWBOX.height} fill="url(#grid)" />

                  {/* 樓層名 */}
                  <text x={20} y={36} fontSize={28} fontWeight={800} fill="#3a2e26" opacity={0.1}>
                    {floor}
                  </text>

                  {/* 桌位 */}
                  {floorTables.map(t => {
                    const isSelected = selectedNumber === t.number
                    const fill = !t.isActive ? '#e5e0d8' : STATUS_FILL[t.status] || STATUS_FILL.vacant
                    return (
                      <g
                        key={t.number}
                        onPointerDown={(e) => handleTablePointerDown(e, t)}
                        onClick={(e) => { e.stopPropagation(); setSelectedNumber(t.number) }}
                        style={{ cursor: 'grab' }}
                      >
                        <rect
                          x={t.x} y={t.y} width={t.w} height={t.h} rx={8}
                          fill={fill}
                          stroke={isSelected ? '#e60012' : t.isActive ? '#3a2e26' : '#94a3b8'}
                          strokeWidth={isSelected ? 3 : 1.5}
                          strokeDasharray={t.isActive ? null : '4 3'}
                        />
                        <text x={t.x + t.w / 2} y={t.y + t.h / 2 - 2} fontSize={14} fontWeight={800}
                              fill={t.isActive ? '#3a2e26' : '#64748b'} textAnchor="middle" pointerEvents="none">
                          {t.number}
                        </text>
                        <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 14} fontSize={10}
                              fill={t.isActive ? '#3a2e26' : '#64748b'} opacity={0.7} textAnchor="middle" pointerEvents="none">
                          {t.capacity} 人
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>

            {/* 編輯面板 */}
            <aside className="w-80 bg-white border-l border-chicken-brown/10 overflow-y-auto p-4 flex-shrink-0">
              {selected ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-3xl font-black text-chicken-red">{selected.number}</div>
                    <div className="text-xs text-chicken-brown/60 mt-1">編輯桌位屬性</div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-chicken-brown/70 block mb-2">容量</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[4, 6].map(c => (
                        <button
                          key={c}
                          onClick={() => handleCapacityChange(c)}
                          className={`py-2.5 rounded-xl border-2 text-sm font-bold ${
                            selected.capacity === c
                              ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                              : 'border-chicken-brown/15 bg-white text-chicken-brown'
                          }`}
                        >
                          {c} 人
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-chicken-brown/70 block mb-2">所屬樓層</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['1F', '2F'].map(f => (
                        <button
                          key={f}
                          onClick={() => handleFloorChange(f)}
                          className={`py-2 rounded-lg border-2 text-sm font-bold ${
                            selected.floor === f
                              ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                              : 'border-chicken-brown/15 bg-white text-chicken-brown'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selected.isActive} onChange={handleActiveToggle} className="w-4 h-4" />
                    <span className="text-sm font-bold text-chicken-brown">啟用此桌</span>
                  </label>

                  <div className="pt-3 border-t border-chicken-brown/10 space-y-1 text-xs text-chicken-brown/60">
                    <div className="flex justify-between"><span>位置</span><span className="font-mono">x={selected.x} y={selected.y}</span></div>
                    <div className="flex justify-between"><span>尺寸</span><span className="font-mono">{selected.w}×{selected.h}</span></div>
                    <div className="flex justify-between"><span>運營狀態</span><span>{selected.status}</span></div>
                  </div>

                  <button
                    onClick={handleDelete}
                    disabled={!!selected.currentBookingId}
                    className={`w-full py-2.5 rounded-xl text-sm font-bold ${
                      selected.currentBookingId
                        ? 'bg-chicken-brown/5 text-chicken-brown/30 cursor-not-allowed'
                        : 'bg-chicken-red/10 text-chicken-red hover:bg-chicken-red/20'
                    }`}
                  >
                    🗑 刪除此桌
                  </button>
                  {selected.currentBookingId && (
                    <p className="text-[11px] text-chicken-red text-center">⚠️ 有訂位/用餐中，無法刪除</p>
                  )}
                </div>
              ) : (
                <div className="text-center text-chicken-brown/50 text-sm py-8">
                  <div className="text-5xl mb-3 opacity-30">🪑</div>
                  <p>點桌位查看編輯</p>
                  <p className="text-xs mt-2 text-chicken-brown/40">點空白區域 → 新增桌位</p>
                </div>
              )}
            </aside>
          </div>

          {/* === Add table dialog === */}
          {showAddDialog && (
            <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAddDialog(null)}>
              <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-chicken-brown mb-3">➕ 新增桌位</h3>
                <p className="text-xs text-chicken-brown/60 mb-4">
                  位置：{floor} · x={showAddDialog.x} y={showAddDialog.y}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-chicken-brown/70 block mb-1.5">容量</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[4, 6].map(c => (
                        <button
                          key={c}
                          onClick={() => setNewTableForm(f => ({ ...f, capacity: c }))}
                          className={`py-2.5 rounded-xl border-2 text-sm font-bold ${
                            newTableForm.capacity === c
                              ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                              : 'border-chicken-brown/15 bg-white text-chicken-brown'
                          }`}
                        >{c} 人</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => setShowAddDialog(null)} className="flex-1 btn-secondary py-2 text-sm">取消</button>
                  <button onClick={handleAddTable} className="flex-1 btn-primary py-2 text-sm">新增</button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
