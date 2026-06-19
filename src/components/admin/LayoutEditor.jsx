import { useState, useRef, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBooking } from '../../contexts/BookingContext'
import { useToast, useConfirm } from '../ui/Toast'
import {
  FLOOR_VIEWBOX, INITIAL_TABLES, tableDims,
  FIXTURES, ZONE_PALETTE, DEFAULT_BACKGROUND_IMAGES,
} from '../../data/tables'

// 全螢幕桌位佈局編輯器（2026-06 升級）
// 三種模式：
//   桌位：拖移 / 縮放（拖四角八把手）/ 旋轉 / 多選（框選＋Shift）/ 對齊＋等距 / 方向鍵微調 / 改容量樓層 / 指派分區
//   設施：醬料台/樓梯/冰箱… 拖移、縮放、改名、直書、新增、刪除
//   分區：建立/改名/改色/刪除分區，點桌「上色」指派分區
// 另：每樓層可上傳半透明底圖（描繪對齊用）。
// 存檔：saveFloorPlan({ tables, fixtures, zones, backgroundImages })——桌位走守門，設施/分區/底圖寫 settings.floorPlan。

const GRID = 10
const MIN_SIZE = 40       // 桌最小寬高
const FIX_MIN = 16        // 設施最小寬高
const SNAP_TOL = 6        // 吸附對齊容差（viewBox 單位）
const MOVE_THRESHOLD = 4  // 點擊 vs 拖移/框選 判定
const DEG = Math.PI / 180

const STATUS_FILL = {
  vacant:   '#86efac',  // 編輯模式下用淡色，避免跟運營狀態混淆
  reserved: '#fde68a',
  dining:   '#fca5a5',
  cleaning: '#fdba74',
  blocked:  '#cbd5e1',
}

// 八個縮放把手：ax/ay = 該把手相對中心的方向（-1/0/1）
const HANDLES = [
  { k: 'nw', fx: 0,   fy: 0,   ax: -1, ay: -1 },
  { k: 'n',  fx: 0.5, fy: 0,   ax: 0,  ay: -1 },
  { k: 'ne', fx: 1,   fy: 0,   ax: 1,  ay: -1 },
  { k: 'e',  fx: 1,   fy: 0.5, ax: 1,  ay: 0 },
  { k: 'se', fx: 1,   fy: 1,   ax: 1,  ay: 1 },
  { k: 's',  fx: 0.5, fy: 1,   ax: 0,  ay: 1 },
  { k: 'sw', fx: 0,   fy: 1,   ax: -1, ay: 1 },
  { k: 'w',  fx: 0,   fy: 0.5, ax: -1, ay: 0 },
]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const snapGrid = (v) => Math.round(v / GRID) * GRID

// 旋轉桌的軸對齊外框（AABB）：用半長軸投影，吸附/對齊/框選都以此口徑。
function aabb(t, x = t.x, y = t.y) {
  const r = (Number(t.rotation) || 0) * DEG
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const hx = (t.w / 2) * c + (t.h / 2) * s
  const hy = (t.w / 2) * s + (t.h / 2) * c
  const cx = x + t.w / 2, cy = y + t.h / 2
  return { left: cx - hx, right: cx + hx, top: cy - hy, bottom: cy + hy, cx, cy }
}

// 上傳圖縮圖成 data URL（避免撐爆 settings 文件 / Firestore 1MB）。
function downscaleImage(file, maxDim = 1280, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        const scale = Math.min(1, maxDim / Math.max(w, h))
        w = Math.round(w * scale); h = Math.round(h * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const genId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`

export default function LayoutEditor({ open, onClose }) {
  const { tables, settings, saveFloorPlan } = useBooking()
  const toast = useToast()
  const confirmDialog = useConfirm()

  // 本地編輯狀態（未存檔）
  const [localTables, setLocalTables] = useState(() => tables.map(t => ({ ...t })))
  const [localFixtures, setLocalFixtures] = useState(() => deepFixtures(settings?.floorPlan?.fixtures))
  const [localZones, setLocalZones] = useState(() => (settings?.floorPlan?.zones || []).map(z => ({ ...z })))
  const [localBg, setLocalBg] = useState(() => ({ ...DEFAULT_BACKGROUND_IMAGES, ...(settings?.floorPlan?.backgroundImages || {}) }))

  const [floor, setFloor] = useState('1F')
  const [mode, setMode] = useState('tables')        // 'tables' | 'fixtures' | 'zones'
  const [selectedNumbers, setSelectedNumbers] = useState(() => new Set())
  const [selectedNumber, setSelectedNumber] = useState(null)
  const [selectedFixtureId, setSelectedFixtureId] = useState(null)
  const [activeZoneId, setActiveZoneId] = useState(null) // 分區模式：上色用的分區（null = 橡皮擦清除）
  const [showZoneColor, setShowZoneColor] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(null)
  const [marquee, setMarquee] = useState(null)
  const [guides, setGuides] = useState([])

  const svgRef = useRef(null)
  const opRef = useRef(null)
  const marqueeRef = useRef(null)

  // 進入編輯時 reset 本地狀態
  useEffect(() => {
    if (!open) return
    setLocalTables(tables.map(t => ({ ...t })))
    setLocalFixtures(deepFixtures(settings?.floorPlan?.fixtures))
    setLocalZones((settings?.floorPlan?.zones || []).map(z => ({ ...z })))
    setLocalBg({ ...DEFAULT_BACKGROUND_IMAGES, ...(settings?.floorPlan?.backgroundImages || {}) })
    setIsDirty(false)
    setSelectedNumbers(new Set())
    setSelectedNumber(null)
    setSelectedFixtureId(null)
    setMode('tables')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const selected = useMemo(
    () => selectedNumber ? localTables.find(t => t.number === selectedNumber) : null,
    [selectedNumber, localTables]
  )
  const selectedFixture = useMemo(
    () => selectedFixtureId ? (localFixtures[floor] || []).find(f => f.id === selectedFixtureId) : null,
    [selectedFixtureId, localFixtures, floor]
  )

  const floorTables = localTables.filter(t => t.floor === floor)
  const floorFixtures = localFixtures[floor] || []
  const zoneColorOf = (zoneId) => (zoneId && localZones.find(z => z.id === zoneId)?.color) || null

  const stats = useMemo(() => ({
    total: localTables.length,
    f1: localTables.filter(t => t.floor === '1F').length,
    f2: localTables.filter(t => t.floor === '2F').length,
    cap4: localTables.filter(t => t.capacity === 4).length,
    cap6: localTables.filter(t => t.capacity === 6).length,
  }), [localTables])

  // === 座標換算 ===
  const screenToSvg = (clientX, clientY) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * (FLOOR_VIEWBOX.width / rect.width),
      y: (clientY - rect.top) * (FLOOR_VIEWBOX.height / rect.height),
    }
  }

  const updateLocal = (number, patch) => {
    setLocalTables(list => list.map(t => t.number === number ? { ...t, ...patch } : t))
    setIsDirty(true)
  }
  const updateFixture = (id, patch) => {
    setLocalFixtures(fx => ({ ...fx, [floor]: (fx[floor] || []).map(f => f.id === id ? { ...f, ...patch } : f) }))
    setIsDirty(true)
  }

  // === 共用：起始一個操作（含 pointer capture）===
  const beginOp = (e, op) => {
    e.stopPropagation()
    try { svgRef.current?.setPointerCapture?.(e.pointerId) } catch { /* noop */ }
    opRef.current = op
  }

  // === 桌位 pointer down ===
  const onTablePointerDown = (e, t) => {
    if (mode === 'fixtures') return
    if (mode === 'zones') { e.stopPropagation(); paintZone(t.number); return }
    const additive = e.shiftKey
    let nextSel
    if (additive) {
      nextSel = new Set(selectedNumbers)
      nextSel.has(t.number) ? nextSel.delete(t.number) : nextSel.add(t.number)
    } else if (selectedNumbers.has(t.number) && selectedNumbers.size > 1) {
      nextSel = new Set(selectedNumbers)   // 已在多選內：保留群組以便整組拖移
    } else {
      nextSel = new Set([t.number])
    }
    setSelectedNumbers(nextSel)
    setSelectedNumber(nextSel.size === 1 ? [...nextSel][0] : t.number)
    setSelectedFixtureId(null)
    const start = screenToSvg(e.clientX, e.clientY)
    const origins = new Map()
    nextSel.forEach(num => { const tt = localTables.find(x => x.number === num); if (tt) origins.set(num, { x: tt.x, y: tt.y }) })
    beginOp(e, { type: 'drag', moved: false, startX: start.x, startY: start.y, primary: t.number, origins, additive, wasInSet: selectedNumbers.has(t.number) })
  }

  const onResizeDown = (e, t, handle) => beginOp(e, { type: 'resize', number: t.number, handle, orig: { x: t.x, y: t.y, w: t.w, h: t.h }, rot: Number(t.rotation) || 0 })
  const onRotateDown = (e, t) => beginOp(e, { type: 'rotate', number: t.number, cx: t.x + t.w / 2, cy: t.y + t.h / 2 })

  // === 設施 pointer down ===
  const onFixturePointerDown = (e, f) => {
    if (mode !== 'fixtures') return
    setSelectedFixtureId(f.id)
    setSelectedNumber(null); setSelectedNumbers(new Set())
    const start = screenToSvg(e.clientX, e.clientY)
    beginOp(e, { type: 'fixdrag', id: f.id, moved: false, startX: start.x, startY: start.y, orig: { x: f.x, y: f.y } })
  }
  const onFixResizeDown = (e, f, handle) => beginOp(e, { type: 'fixresize', id: f.id, handle, orig: { x: f.x, y: f.y, w: f.w, h: f.h } })

  // === 空白 pointer down（可能起框選 / 點擊新增）===
  const onSvgPointerDown = (e) => {
    if (e.target !== svgRef.current) return
    const start = screenToSvg(e.clientX, e.clientY)
    beginOp(e, { type: 'empty', moved: false, startX: start.x, startY: start.y })
  }

  // === pointer move 分派 ===
  const onSvgPointerMove = (e) => {
    const op = opRef.current
    if (!op) return
    const p = screenToSvg(e.clientX, e.clientY)
    if (op.type === 'drag') doDrag(op, p)
    else if (op.type === 'resize') doResize(op, p)
    else if (op.type === 'rotate') doRotate(op, p, e.altKey)
    else if (op.type === 'fixdrag') doFixDrag(op, p)
    else if (op.type === 'fixresize') doFixResize(op, p)
    else if (op.type === 'empty' || op.type === 'marquee') {
      const dx = p.x - op.startX, dy = p.y - op.startY
      if (op.type === 'empty' && Math.hypot(dx, dy) < MOVE_THRESHOLD) return
      op.type = 'marquee'
      const m = { x: Math.min(op.startX, p.x), y: Math.min(op.startY, p.y), w: Math.abs(dx), h: Math.abs(dy) }
      marqueeRef.current = m
      setMarquee(m)
    }
  }

  const onSvgPointerUp = () => {
    const op = opRef.current
    opRef.current = null
    setGuides([])
    if (!op) return
    if (op.type === 'empty' && !op.moved) {
      const x = snapGrid(op.startX), y = snapGrid(op.startY)
      if (mode === 'tables') setShowAddDialog({ x, y })
      else if (mode === 'fixtures') addFixtureAt(x, y)
    } else if (op.type === 'marquee') {
      const m = marqueeRef.current
      if (m && mode === 'tables') {
        const sel = new Set()
        floorTables.forEach(t => {
          const b = aabb(t)
          if (b.right >= m.x && b.left <= m.x + m.w && b.bottom >= m.y && b.top <= m.y + m.h) sel.add(t.number)
        })
        setSelectedNumbers(sel)
        setSelectedNumber(sel.size === 1 ? [...sel][0] : null)
      }
      marqueeRef.current = null
      setMarquee(null)
    } else if (op.type === 'drag') {
      // 沒移動、非加選、原本在多選群組 → 收斂成單選
      if (!op.moved && !op.additive && op.wasInSet && selectedNumbers.size > 1) {
        setSelectedNumbers(new Set([op.primary]))
        setSelectedNumber(op.primary)
      }
    }
  }

  // === 拖移（含吸附對齊）===
  function doDrag(op, p) {
    op.moved = true
    const t = localTables.find(x => x.number === op.primary)
    if (!t) return
    const po = op.origins.get(op.primary)
    let nx = po.x + (p.x - op.startX)
    let ny = po.y + (p.y - op.startY)
    const snapped = computeSnap(t, nx, ny)
    nx = snapped.x; ny = snapped.y
    setGuides(snapped.guides)
    const adx = nx - po.x, ady = ny - po.y
    setLocalTables(list => list.map(tt => {
      if (!op.origins.has(tt.number)) return tt
      const o = op.origins.get(tt.number)
      return {
        ...tt,
        x: clamp(o.x + adx, 0, FLOOR_VIEWBOX.width - tt.w),
        y: clamp(o.y + ady, 0, FLOOR_VIEWBOX.height - tt.h),
      }
    }))
    setIsDirty(true)
  }

  function computeSnap(t, nx, ny) {
    const others = localTables.filter(o => o.floor === floor && o.number !== t.number)
    const me = aabb(t, nx, ny)
    const myX = [me.left, me.cx, me.right]
    const myY = [me.top, me.cy, me.bottom]
    let bestX = null, bestY = null
    others.forEach(o => {
      const ob = aabb(o)
      ;[ob.left, ob.cx, ob.right].forEach(ol => myX.forEach(mv => {
        const d = ol - mv
        if (Math.abs(d) <= SNAP_TOL && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, line: ol }
      }))
      ;[ob.top, ob.cy, ob.bottom].forEach(ol => myY.forEach(mv => {
        const d = ol - mv
        if (Math.abs(d) <= SNAP_TOL && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, line: ol }
      }))
    })
    const guides = []
    let outX, outY
    if (bestX) { outX = nx + bestX.d; guides.push({ kind: 'v', pos: bestX.line }) } else outX = snapGrid(nx)
    if (bestY) { outY = ny + bestY.d; guides.push({ kind: 'h', pos: bestY.line }) } else outY = snapGrid(ny)
    return { x: outX, y: outY, guides }
  }

  // === 縮放（支援旋轉桌：以本地軸計算，錨定對側固定）===
  function doResize(op, p) {
    const { orig, rot, handle } = op
    const H = HANDLES.find(h => h.k === handle)
    const ax = H.ax, ay = H.ay
    const r = rot * DEG, cos = Math.cos(r), sin = Math.sin(r)
    const ux = { x: cos, y: sin }, uy = { x: -sin, y: cos }
    const ocx = orig.x + orig.w / 2, ocy = orig.y + orig.h / 2
    const al = { x: -ax * orig.w / 2, y: -ay * orig.h / 2 }   // 錨點（對側）本地座標
    const anchor = { x: ocx + cos * al.x - sin * al.y, y: ocy + sin * al.x + cos * al.y }
    let W = orig.w, H2 = orig.h
    if (ax !== 0) { const proj = (p.x - anchor.x) * ux.x + (p.y - anchor.y) * ux.y; W = Math.max(MIN_SIZE, snapGrid(proj * ax)) }
    if (ay !== 0) { const proj = (p.x - anchor.x) * uy.x + (p.y - anchor.y) * uy.y; H2 = Math.max(MIN_SIZE, snapGrid(proj * ay)) }
    const ox = ax * W / 2, oy = ay * H2 / 2
    const ncx = anchor.x + cos * ox - sin * oy
    const ncy = anchor.y + sin * ox + cos * oy
    let X = ncx - W / 2, Y = ncy - H2 / 2
    if (rot === 0) { X = clamp(X, 0, FLOOR_VIEWBOX.width - W); Y = clamp(Y, 0, FLOOR_VIEWBOX.height - H2) }
    updateLocal(op.number, { x: X, y: Y, w: W, h: H2 })
  }

  // === 旋轉（預設吸 15°，按住 Alt 自由）===
  function doRotate(op, p, alt) {
    const phi = Math.atan2(p.y - op.cy, p.x - op.cx) * 180 / Math.PI
    const step = alt ? 1 : 15
    let deg = Math.round((phi + 90) / step) * step
    deg = ((deg % 360) + 360) % 360
    updateLocal(op.number, { rotation: deg })
  }

  // === 設施拖移 / 縮放（軸對齊，無旋轉）===
  function doFixDrag(op, p) {
    op.moved = true
    const nx = clamp(snapGrid(op.orig.x + (p.x - op.startX)), 0, FLOOR_VIEWBOX.width)
    const ny = clamp(snapGrid(op.orig.y + (p.y - op.startY)), 0, FLOOR_VIEWBOX.height)
    updateFixture(op.id, { x: nx, y: ny })
  }
  function doFixResize(op, p) {
    const { orig, handle } = op
    const H = HANDLES.find(h => h.k === handle)
    let { x, y, w, h } = orig
    if (H.ax === 1) w = Math.max(FIX_MIN, snapGrid(p.x - orig.x))
    if (H.ax === -1) { const right = orig.x + orig.w; x = Math.min(right - FIX_MIN, snapGrid(p.x)); w = right - x }
    if (H.ay === 1) h = Math.max(FIX_MIN, snapGrid(p.y - orig.y))
    if (H.ay === -1) { const bot = orig.y + orig.h; y = Math.min(bot - FIX_MIN, snapGrid(p.y)); h = bot - y }
    updateFixture(op.id, { x, y, w, h })
  }

  // === 容量 / 樓層 / 啟用 / 刪除（桌位）===
  const handleCapacityChange = (capacity) => { if (selected) updateLocal(selected.number, { capacity }) }
  const applyStdSize = () => { if (selected) updateLocal(selected.number, tableDims(selected.capacity)) }
  const handleFloorChange = (newFloor) => { if (!selected) return; updateLocal(selected.number, { floor: newFloor }); setFloor(newFloor) }

  const isOccupied = (t) => ['dining', 'reserved', 'cleaning'].includes(t?.status) || t?.currentBookingId || t?.currentRef
  const handleActiveToggle = () => {
    if (!selected) return
    if (selected.isActive && isOccupied(selected)) return toast.error(`${selected.number} 使用中（或仍連結訂位/團體），請先清桌再停用`)
    updateLocal(selected.number, { isActive: !selected.isActive })
  }
  const handleDelete = async () => {
    if (!selected) return
    if (isOccupied(selected)) return toast.error('此桌目前有訂位/用餐，無法刪除')
    const ok = await confirmDialog(`刪除桌位 ${selected.number}？\n此動作不可復原`, { title: '刪除桌位', confirmLabel: '刪除', danger: true })
    if (!ok) return
    setLocalTables(list => list.filter(t => t.number !== selected.number))
    setSelectedNumber(null); setSelectedNumbers(new Set()); setIsDirty(true)
  }
  const setWH = (patch) => {
    if (!selected) return
    const w = clamp(Math.round(Number(patch.w ?? selected.w)) || MIN_SIZE, MIN_SIZE, FLOOR_VIEWBOX.width)
    const h = clamp(Math.round(Number(patch.h ?? selected.h)) || MIN_SIZE, MIN_SIZE, FLOOR_VIEWBOX.height)
    updateLocal(selected.number, { w, h })
  }
  const setRotation = (deg) => {
    if (!selected) return
    let d = Math.round(Number(deg)) || 0
    d = ((d % 360) + 360) % 360
    updateLocal(selected.number, { rotation: d })
  }

  // === 對齊 / 等距分布 ===
  const selTables = () => [...selectedNumbers].map(n => localTables.find(t => t.number === n)).filter(Boolean)
  const alignSelected = (kind) => {
    const tabs = selTables(); if (tabs.length < 2) return
    const boxes = tabs.map(t => ({ t, b: aabb(t) }))
    let target
    if (kind === 'left') target = Math.min(...boxes.map(x => x.b.left))
    else if (kind === 'right') target = Math.max(...boxes.map(x => x.b.right))
    else if (kind === 'top') target = Math.min(...boxes.map(x => x.b.top))
    else if (kind === 'bottom') target = Math.max(...boxes.map(x => x.b.bottom))
    else if (kind === 'centerH') target = boxes.reduce((s, x) => s + x.b.cx, 0) / boxes.length
    else if (kind === 'centerV') target = boxes.reduce((s, x) => s + x.b.cy, 0) / boxes.length
    setLocalTables(list => list.map(tt => {
      const box = boxes.find(x => x.t.number === tt.number); if (!box) return tt
      let nx = tt.x, ny = tt.y
      if (kind === 'left') nx = tt.x + (target - box.b.left)
      else if (kind === 'right') nx = tt.x + (target - box.b.right)
      else if (kind === 'centerH') nx = tt.x + (target - box.b.cx)
      else if (kind === 'top') ny = tt.y + (target - box.b.top)
      else if (kind === 'bottom') ny = tt.y + (target - box.b.bottom)
      else if (kind === 'centerV') ny = tt.y + (target - box.b.cy)
      return { ...tt, x: clamp(snapGrid(nx), 0, FLOOR_VIEWBOX.width - tt.w), y: clamp(snapGrid(ny), 0, FLOOR_VIEWBOX.height - tt.h) }
    }))
    setIsDirty(true)
  }
  const distributeSelected = (axis) => {
    const tabs = selTables(); if (tabs.length < 3) return
    const boxes = tabs.map(t => ({ t, b: aabb(t) })).sort((a, b) => axis === 'h' ? a.b.cx - b.b.cx : a.b.cy - b.b.cy)
    const first = boxes[0], last = boxes[boxes.length - 1]
    const span = axis === 'h' ? (last.b.cx - first.b.cx) : (last.b.cy - first.b.cy)
    const step = span / (boxes.length - 1)
    const upd = {}
    boxes.forEach((bx, i) => {
      if (i === 0 || i === boxes.length - 1) return
      const targetC = (axis === 'h' ? first.b.cx : first.b.cy) + step * i
      const cur = axis === 'h' ? bx.b.cx : bx.b.cy
      upd[bx.t.number] = axis === 'h' ? { x: snapGrid(bx.t.x + (targetC - cur)) } : { y: snapGrid(bx.t.y + (targetC - cur)) }
    })
    setLocalTables(list => list.map(tt => upd[tt.number] ? { ...tt, ...upd[tt.number] } : tt))
    setIsDirty(true)
  }

  // === 分區 ===
  const addZone = () => {
    const id = genId('z')
    const color = ZONE_PALETTE[localZones.length % ZONE_PALETTE.length]
    setLocalZones(zs => [...zs, { id, name: `分區${zs.length + 1}`, color }])
    setActiveZoneId(id); setIsDirty(true)
  }
  const renameZone = (id, name) => { setLocalZones(zs => zs.map(z => z.id === id ? { ...z, name } : z)); setIsDirty(true) }
  const recolorZone = (id, color) => { setLocalZones(zs => zs.map(z => z.id === id ? { ...z, color } : z)); setIsDirty(true) }
  const deleteZone = async (id) => {
    const ok = await confirmDialog('刪除此分區？引用的桌會清除分區。', { title: '刪除分區', danger: true })
    if (!ok) return
    setLocalZones(zs => zs.filter(z => z.id !== id))
    setLocalTables(list => list.map(t => t.zoneId === id ? { ...t, zoneId: null } : t))
    if (activeZoneId === id) setActiveZoneId(null)
    setIsDirty(true)
  }
  const paintZone = (number) => updateLocal(number, { zoneId: activeZoneId })
  const assignZoneToSelected = (zoneId) => {
    setLocalTables(list => list.map(t => selectedNumbers.has(t.number) ? { ...t, zoneId } : t))
    setIsDirty(true)
  }

  // === 底圖 ===
  const onBgUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    try {
      const url = await downscaleImage(file)
      if (url.length > 480000) toast.info('底圖較大已壓縮；若同步異常請換解析度較低的圖')
      setLocalBg(bg => ({ ...bg, [floor]: { url, opacity: 0.4, x: 0, y: 0, w: FLOOR_VIEWBOX.width, h: FLOOR_VIEWBOX.height } }))
      setIsDirty(true)
    } catch { toast.error('讀取圖片失敗') }
    e.target.value = ''
  }
  const setBgOpacity = (v) => { setLocalBg(bg => bg[floor] ? { ...bg, [floor]: { ...bg[floor], opacity: Number(v) } } : bg); setIsDirty(true) }
  const clearBg = () => { setLocalBg(bg => ({ ...bg, [floor]: null })); setIsDirty(true) }

  // === 設施新增 / 刪除 ===
  const addFixtureAt = (x, y) => {
    const id = genId('fx')
    const f = { id, type: 'label', x, y, w: 0, h: 0, text: '新設施', vtext: false }
    setLocalFixtures(fx => ({ ...fx, [floor]: [...(fx[floor] || []), f] }))
    setSelectedFixtureId(id); setIsDirty(true)
  }
  const changeFixtureType = (type) => {
    if (!selectedFixture) return
    const patch = { type }
    if (type !== 'label' && (!selectedFixture.w || !selectedFixture.h)) { patch.w = 80; patch.h = 40 }
    updateFixture(selectedFixture.id, patch)
  }
  const deleteFixture = () => {
    if (!selectedFixture) return
    setLocalFixtures(fx => ({ ...fx, [floor]: (fx[floor] || []).filter(f => f.id !== selectedFixture.id) }))
    setSelectedFixtureId(null); setIsDirty(true)
  }

  // === 存檔 / 取消 / 重設 ===
  const handleSave = () => {
    const r = saveFloorPlan({ tables: localTables, fixtures: localFixtures, zones: localZones, backgroundImages: localBg })
    if (!r?.ok) return toast.error(r?.error || '儲存失敗')
    toast.success(`✅ 已儲存佈局（${localTables.length} 桌）`)
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
    const ok = await confirmDialog('將桌位、設施、分區、底圖全部重設為預設值？目前所有變更會被覆蓋。', { title: '重設預設佈局', danger: true })
    if (!ok) return
    setLocalTables(INITIAL_TABLES.map(t => ({ ...t })))
    setLocalFixtures(deepFixtures(FIXTURES))
    setLocalZones([])
    setLocalBg({ ...DEFAULT_BACKGROUND_IMAGES })
    setSelectedNumber(null); setSelectedNumbers(new Set()); setSelectedFixtureId(null)
    setIsDirty(true)
    toast.info('已載入預設佈局，記得按儲存')
  }

  // === 新增桌位 ===
  const [newTableForm, setNewTableForm] = useState({ capacity: 4 })
  const handleAddTable = () => {
    if (!showAddDialog) return
    const capacity = newTableForm.capacity
    const prefix = capacity === 6 ? 'B' : 'A'
    const used = new Set(localTables.filter(t => t.number.startsWith(prefix)).map(t => parseInt(t.number.slice(1), 10)).filter(n => !isNaN(n)))
    let n = 1; while (used.has(n)) n++
    const newTable = {
      number: `${prefix}${n}`, capacity, floor, x: showAddDialog.x, y: showAddDialog.y, ...tableDims(capacity),
      rotation: 0, zoneId: null, isActive: true, outage: null, status: 'vacant',
      currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null,
      updatedAt: new Date().toISOString(),
    }
    setLocalTables(list => [...list, newTable])
    setSelectedNumber(newTable.number); setSelectedNumbers(new Set([newTable.number]))
    setIsDirty(true); setShowAddDialog(null)
    toast.success(`已新增 ${newTable.number}`)
  }

  // === 鍵盤：ESC 取消、方向鍵微調 ===
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { handleCancel(); return }
      if (mode !== 'tables' || selectedNumbers.size === 0) return
      const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const d = map[e.key]; if (!d) return
      e.preventDefault()
      const step = e.shiftKey ? GRID : 1
      setLocalTables(list => list.map(tt => selectedNumbers.has(tt.number)
        ? { ...tt, x: clamp(tt.x + d[0] * step, 0, FLOOR_VIEWBOX.width - tt.w), y: clamp(tt.y + d[1] * step, 0, FLOOR_VIEWBOX.height - tt.h) }
        : tt))
      setIsDirty(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDirty, mode, selectedNumbers])

  const bg = localBg[floor]
  const multi = selectedNumbers.size >= 2

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
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-black leading-tight">桌位佈局編輯器</h1>
              <p className="text-[11px] opacity-80 leading-tight truncate">
                {stats.total} 桌（4P×{stats.cap4} + 6P×{stats.cap6}）· 1F:{stats.f1} · 2F:{stats.f2}
                {isDirty && <span className="ml-2 px-1.5 py-0.5 bg-chicken-yellow text-chicken-brown rounded text-[10px] font-black">未儲存</span>}
              </p>
            </div>
            <button onClick={handleReset} className="px-3 py-1.5 min-h-[44px] text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg">↺ 重設預設</button>
            <button onClick={handleCancel} className="px-3 py-1.5 min-h-[44px] text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg">返回</button>
            <button onClick={handleSave} disabled={!isDirty}
                    className={`px-4 py-1.5 min-h-[44px] text-xs font-bold rounded-lg ${isDirty ? 'bg-chicken-green text-white hover:opacity-90' : 'bg-white/10 text-white/40 cursor-not-allowed'}`}>
              💾 儲存並返回
            </button>
          </header>

          {/* === 工具列：模式 + 樓層 + 對齊 === */}
          <div className="bg-white border-b border-chicken-brown/10 px-4 py-2 flex items-center gap-2 flex-wrap flex-shrink-0">
            <div className="flex gap-1.5">
              {[['tables', '🪑 桌位'], ['fixtures', '🏷 設施'], ['zones', '🎨 分區']].map(([m, label]) => (
                <button key={m} onClick={() => { setMode(m); setSelectedNumber(null); setSelectedNumbers(new Set()); setSelectedFixtureId(null) }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${mode === m ? 'bg-chicken-brown border-chicken-brown text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-chicken-brown/10 mx-1" />
            <div className="flex gap-1.5">
              {['1F', '2F'].map(f => (
                <button key={f} onClick={() => { setFloor(f); setSelectedFixtureId(null) }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${floor === f ? 'bg-chicken-red border-chicken-red text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                  {f}（{f === '1F' ? stats.f1 : stats.f2}）
                </button>
              ))}
            </div>
            {mode === 'tables' && (
              <button onClick={() => setShowZoneColor(v => !v)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 ${showZoneColor ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                {showZoneColor ? '✓ 顯示分區色' : '顯示分區色'}
              </button>
            )}
            {/* 對齊 / 等距（多選時） */}
            {mode === 'tables' && multi && (
              <div className="flex items-center gap-1 ml-1 px-2 py-1 bg-chicken-cream rounded-lg">
                <span className="text-[11px] font-bold text-chicken-brown/60 mr-1">已選 {selectedNumbers.size}</span>
                {[['left', '⬅'], ['centerH', '↔'], ['right', '➡'], ['top', '⬆'], ['centerV', '↕'], ['bottom', '⬇']].map(([k, ic]) => (
                  <button key={k} title={`對齊 ${k}`} onClick={() => alignSelected(k)} className="w-7 h-7 rounded bg-white border border-chicken-brown/15 text-xs hover:bg-chicken-brown/5">{ic}</button>
                ))}
                <button title="水平等距" onClick={() => distributeSelected('h')} className="px-1.5 h-7 rounded bg-white border border-chicken-brown/15 text-[11px] font-bold hover:bg-chicken-brown/5">⇔等距</button>
                <button title="垂直等距" onClick={() => distributeSelected('v')} className="px-1.5 h-7 rounded bg-white border border-chicken-brown/15 text-[11px] font-bold hover:bg-chicken-brown/5">⇕等距</button>
              </div>
            )}
            <div className="text-[11px] text-chicken-brown/55 ml-1">
              {mode === 'tables' && '拖移／拖角縮放／頂端轉桿旋轉 · Shift 點＝多選 · 空白拖＝框選 · 方向鍵微調 · 點空白新增'}
              {mode === 'fixtures' && '拖移設施／拖角縮放 · 點選看右側編輯 · 點空白新增設施'}
              {mode === 'zones' && '左側建分區、選一個當「畫筆」→ 點桌上色（選橡皮擦可清除）'}
            </div>
          </div>

          {/* === 主區：地圖 + 編輯面板 === */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 p-3 overflow-hidden">
              <div className="bg-white rounded-2xl border border-chicken-brown/10 h-full overflow-hidden">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="w-full h-full"
                  onPointerDown={onSvgPointerDown}
                  onPointerMove={onSvgPointerMove}
                  onPointerUp={onSvgPointerUp}
                  onPointerLeave={onSvgPointerUp}
                  style={{ cursor: 'crosshair', touchAction: 'none' }}
                >
                  {/* 底圖（描繪參考） */}
                  {bg?.url && (
                    <image href={bg.url} x={bg.x} y={bg.y} width={bg.w} height={bg.h}
                           opacity={bg.opacity} preserveAspectRatio="none" pointerEvents="none" />
                  )}
                  {/* 網格 */}
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e0d8" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width={FLOOR_VIEWBOX.width} height={FLOOR_VIEWBOX.height} fill="url(#grid)" pointerEvents="none" />
                  <text x={20} y={36} fontSize={28} fontWeight={800} fill="#3a2e26" opacity={0.1} pointerEvents="none">{floor}</text>

                  {/* 設施層 */}
                  {floorFixtures.map(f => {
                    const fixMode = mode === 'fixtures'
                    const isSel = selectedFixtureId === f.id
                    if (f.type === 'label') {
                      return (
                        <g key={f.id} onPointerDown={fixMode ? (e) => onFixturePointerDown(e, f) : undefined}
                           pointerEvents={fixMode ? undefined : 'none'}
                           style={{ cursor: fixMode ? 'grab' : 'default', opacity: mode === 'tables' || mode === 'zones' ? 0.6 : 1 }}>
                          {isSel && <rect x={f.x - 4} y={f.y - 16} width={Math.max(40, f.text.length * 16)} height={22} fill="none" stroke="#e60012" strokeWidth={1.5} strokeDasharray="3 2" />}
                          <text x={f.x} y={f.y} fontSize={15} fontWeight={700} fill="#6b5b4d">{f.text}</text>
                        </g>
                      )
                    }
                    const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2
                    return (
                      <g key={f.id} onPointerDown={fixMode ? (e) => onFixturePointerDown(e, f) : undefined}
                         pointerEvents={fixMode ? undefined : 'none'}
                         style={{ cursor: fixMode ? 'grab' : 'default', opacity: mode === 'tables' || mode === 'zones' ? 0.6 : 1 }}>
                        <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={4}
                              fill={f.type === 'stairs' ? '#f1ede8' : '#ece7e1'} stroke={isSel ? '#e60012' : '#bcae9f'} strokeWidth={isSel ? 2.5 : 1} />
                        <text x={fcx} y={fcy} fontSize={12} fontWeight={700} fill="#6b5b4d" textAnchor="middle" dominantBaseline="central"
                              transform={f.vtext ? `rotate(90 ${fcx} ${fcy})` : undefined} pointerEvents="none">{f.text}</text>
                        {fixMode && isSel && HANDLES.filter(h => h.ax !== 0 || h.ay !== 0).map(h => (
                          <rect key={h.k} x={f.x + h.fx * f.w - 5} y={f.y + h.fy * f.h - 5} width={10} height={10}
                                fill="#ffffff" stroke="#e60012" strokeWidth={1.5}
                                style={{ cursor: 'nwse-resize' }} onPointerDown={(e) => onFixResizeDown(e, f, h.k)} />
                        ))}
                      </g>
                    )
                  })}

                  {/* 桌位層 */}
                  {floorTables.map(t => {
                    const isSel = selectedNumbers.has(t.number)
                    const isPrimary = selectedNumber === t.number
                    const rot = Number(t.rotation) || 0
                    const cx = t.x + t.w / 2, cy = t.y + t.h / 2
                    const gT = rot ? `rotate(${rot} ${cx} ${cy})` : undefined
                    const tT = rot ? `rotate(${-rot} ${cx} ${cy})` : undefined
                    const zc = zoneColorOf(t.zoneId)
                    const useZoneFill = mode === 'zones' || showZoneColor
                    const fill = !t.isActive ? '#e5e0d8' : (useZoneFill ? (zc || '#eef2f7') : (STATUS_FILL[t.status] || STATUS_FILL.vacant))
                    const dim = mode === 'fixtures' ? 0.4 : 1
                    return (
                      <g key={t.number} transform={gT} pointerEvents={mode === 'fixtures' ? 'none' : undefined} style={{ opacity: dim }}>
                        <g onPointerDown={(e) => onTablePointerDown(e, t)} style={{ cursor: mode === 'zones' ? 'pointer' : 'grab' }}>
                          <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={8}
                                fill={fill}
                                stroke={isSel ? '#e60012' : t.isActive ? '#3a2e26' : '#94a3b8'}
                                strokeWidth={isSel ? 3 : 1.5}
                                strokeDasharray={t.isActive ? null : '4 3'} />
                          {zc && !useZoneFill && <circle cx={t.x + 9} cy={t.y + 9} r={4.5} fill={zc} stroke="#fff" strokeWidth={1.2} pointerEvents="none" />}
                          <g transform={tT} pointerEvents="none">
                            <text x={cx} y={cy - 2} fontSize={14} fontWeight={800} fill={t.isActive ? '#3a2e26' : '#64748b'} textAnchor="middle">{t.number}</text>
                            <text x={cx} y={cy + 14} fontSize={10} fill={t.isActive ? '#3a2e26' : '#64748b'} opacity={0.7} textAnchor="middle">{t.capacity} 人</text>
                          </g>
                        </g>
                        {/* 縮放 + 旋轉把手（桌位模式、單選主桌、非多選）*/}
                        {mode === 'tables' && isPrimary && !multi && (
                          <g>
                            <line x1={cx} y1={t.y} x2={cx} y2={t.y - 22} stroke="#2563eb" strokeWidth={1.5} />
                            <circle cx={cx} cy={t.y - 26} r={6} fill="#2563eb" stroke="#fff" strokeWidth={1.5}
                                    style={{ cursor: 'grab' }} onPointerDown={(e) => onRotateDown(e, t)} />
                            {HANDLES.map(h => (
                              <rect key={h.k} x={t.x + h.fx * t.w - 5} y={t.y + h.fy * t.h - 5} width={10} height={10}
                                    fill="#ffffff" stroke="#2563eb" strokeWidth={1.5}
                                    style={{ cursor: 'nwse-resize' }} onPointerDown={(e) => onResizeDown(e, t, h.k)} />
                            ))}
                          </g>
                        )}
                      </g>
                    )
                  })}

                  {/* 對齊參考線 */}
                  {guides.map((g, i) => g.kind === 'v'
                    ? <line key={i} x1={g.pos} y1={0} x2={g.pos} y2={FLOOR_VIEWBOX.height} stroke="#ec4899" strokeWidth={1} strokeDasharray="6 4" pointerEvents="none" />
                    : <line key={i} x1={0} y1={g.pos} x2={FLOOR_VIEWBOX.width} y2={g.pos} stroke="#ec4899" strokeWidth={1} strokeDasharray="6 4" pointerEvents="none" />
                  )}

                  {/* 框選矩形 */}
                  {marquee && (
                    <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
                          fill="#2563eb22" stroke="#2563eb" strokeWidth={1} strokeDasharray="5 3" pointerEvents="none" />
                  )}
                </svg>
              </div>
            </div>

            {/* === 編輯面板 === */}
            <aside className="w-80 bg-white border-l border-chicken-brown/10 overflow-y-auto p-4 flex-shrink-0">
              {/* ---- 桌位模式 ---- */}
              {mode === 'tables' && (
                multi ? (
                  <div className="space-y-4">
                    <div className="text-lg font-black text-chicken-brown">已選 {selectedNumbers.size} 桌</div>
                    <p className="text-xs text-chicken-brown/60">上方工具列可對齊／等距。指派分區：</p>
                    <ZonePicker zones={localZones} value={null} onChange={assignZoneToSelected} />
                    <p className="text-[11px] text-chicken-brown/45">提示：Shift 點可加減選；點單一桌回到單選。</p>
                  </div>
                ) : selected ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-3xl font-black text-chicken-red">{selected.number}</div>
                      <div className="text-xs text-chicken-brown/60 mt-1">編輯桌位屬性</div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">容量（不影響尺寸）</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[4, 6].map(c => (
                          <button key={c} onClick={() => handleCapacityChange(c)}
                                  className={`py-2.5 rounded-xl border-2 text-sm font-bold ${selected.capacity === c ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                            {c} 人
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">尺寸（寬 × 高）</label>
                      <div className="flex items-center gap-2">
                        <input type="number" value={selected.w} min={MIN_SIZE} onChange={(e) => setWH({ w: e.target.value })}
                               className="w-full px-2 py-2 rounded-lg border-2 border-chicken-brown/15 text-sm" />
                        <span className="text-chicken-brown/40">×</span>
                        <input type="number" value={selected.h} min={MIN_SIZE} onChange={(e) => setWH({ h: e.target.value })}
                               className="w-full px-2 py-2 rounded-lg border-2 border-chicken-brown/15 text-sm" />
                      </div>
                      <button onClick={applyStdSize} className="mt-2 w-full py-1.5 rounded-lg text-xs font-bold bg-chicken-brown/5 hover:bg-chicken-brown/10 text-chicken-brown">套用標準尺寸（{selected.capacity}人）</button>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">旋轉（度）</label>
                      <div className="flex items-center gap-2">
                        <input type="number" value={Number(selected.rotation) || 0} onChange={(e) => setRotation(e.target.value)}
                               className="w-full px-2 py-2 rounded-lg border-2 border-chicken-brown/15 text-sm" />
                        <button onClick={() => setRotation(0)} className="px-3 py-2 rounded-lg text-xs font-bold bg-chicken-brown/5 hover:bg-chicken-brown/10 whitespace-nowrap">回正 0°</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">所屬樓層</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['1F', '2F'].map(f => (
                          <button key={f} onClick={() => handleFloorChange(f)}
                                  className={`py-2 rounded-lg border-2 text-sm font-bold ${selected.floor === f ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>{f}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">分區</label>
                      <ZonePicker zones={localZones} value={selected.zoneId} onChange={(zid) => updateLocal(selected.number, { zoneId: zid })} />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={selected.isActive} onChange={handleActiveToggle} className="w-4 h-4" />
                      <span className="text-sm font-bold text-chicken-brown">啟用此桌</span>
                    </label>
                    <div className="pt-3 border-t border-chicken-brown/10 space-y-1 text-xs text-chicken-brown/60">
                      <div className="flex justify-between"><span>位置</span><span className="font-mono">x={Math.round(selected.x)} y={Math.round(selected.y)}</span></div>
                      <div className="flex justify-between"><span>尺寸</span><span className="font-mono">{selected.w}×{selected.h} · {Number(selected.rotation) || 0}°</span></div>
                    </div>
                    <button onClick={handleDelete} disabled={isOccupied(selected)}
                            className={`w-full py-2.5 rounded-xl text-sm font-bold ${isOccupied(selected) ? 'bg-chicken-brown/5 text-chicken-brown/30 cursor-not-allowed' : 'bg-chicken-red/10 text-chicken-red hover:bg-chicken-red/20'}`}>
                      🗑 刪除此桌
                    </button>
                  </div>
                ) : (
                  <div className="text-center text-chicken-brown/50 text-sm py-8">
                    <div className="text-5xl mb-3 opacity-30">🪑</div>
                    <p>點桌位查看編輯</p>
                    <p className="text-xs mt-2 text-chicken-brown/40">空白拖曳＝框選多桌 · 點空白＝新增</p>
                  </div>
                )
              )}

              {/* ---- 設施模式 ---- */}
              {mode === 'fixtures' && (
                selectedFixture ? (
                  <div className="space-y-4">
                    <div className="text-lg font-black text-chicken-brown">編輯設施</div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">類型</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[['label', '文字'], ['rect', '方塊'], ['stairs', '樓梯']].map(([ty, lb]) => (
                          <button key={ty} onClick={() => changeFixtureType(ty)}
                                  className={`py-2 rounded-lg border-2 text-xs font-bold ${selectedFixture.type === ty ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 text-chicken-brown'}`}>{lb}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-chicken-brown/70 block mb-2">文字</label>
                      <input value={selectedFixture.text} onChange={(e) => updateFixture(selectedFixture.id, { text: e.target.value })}
                             className="w-full px-2 py-2 rounded-lg border-2 border-chicken-brown/15 text-sm" />
                    </div>
                    {selectedFixture.type !== 'label' && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!selectedFixture.vtext} onChange={(e) => updateFixture(selectedFixture.id, { vtext: e.target.checked })} className="w-4 h-4" />
                        <span className="text-sm font-bold text-chicken-brown">文字直書</span>
                      </label>
                    )}
                    <div className="pt-3 border-t border-chicken-brown/10 text-xs text-chicken-brown/60">
                      <div className="flex justify-between"><span>位置</span><span className="font-mono">x={Math.round(selectedFixture.x)} y={Math.round(selectedFixture.y)}</span></div>
                      {selectedFixture.type !== 'label' && <div className="flex justify-between"><span>尺寸</span><span className="font-mono">{selectedFixture.w}×{selectedFixture.h}</span></div>}
                    </div>
                    <button onClick={deleteFixture} className="w-full py-2.5 rounded-xl text-sm font-bold bg-chicken-red/10 text-chicken-red hover:bg-chicken-red/20">🗑 刪除設施</button>
                  </div>
                ) : (
                  <div className="text-center text-chicken-brown/50 text-sm py-8">
                    <div className="text-5xl mb-3 opacity-30">🏷</div>
                    <p>點設施查看編輯</p>
                    <p className="text-xs mt-2 text-chicken-brown/40">點空白區域 → 新增設施（預設文字）</p>
                  </div>
                )
              )}

              {/* ---- 分區模式 ---- */}
              {mode === 'zones' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-black text-chicken-brown">分區</div>
                    <button onClick={addZone} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-chicken-green text-white">＋ 新增</button>
                  </div>
                  <button onClick={() => setActiveZoneId(null)}
                          className={`w-full text-left px-3 py-2 rounded-lg border-2 text-sm font-bold ${activeZoneId === null ? 'border-chicken-brown bg-chicken-brown/5' : 'border-chicken-brown/10'}`}>
                    🧽 橡皮擦（點桌清除分區）
                  </button>
                  {localZones.length === 0 && <p className="text-xs text-chicken-brown/45 py-2">尚無分區。按「＋ 新增」建立，選一個當畫筆後點桌上色。</p>}
                  {localZones.map(z => (
                    <div key={z.id} className={`p-2 rounded-lg border-2 ${activeZoneId === z.id ? 'border-chicken-brown' : 'border-chicken-brown/10'}`}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setActiveZoneId(z.id)} title="設為畫筆"
                                className="w-7 h-7 rounded-md flex-shrink-0 border border-black/10" style={{ background: z.color }} />
                        <input value={z.name} onChange={(e) => renameZone(z.id, e.target.value)}
                               className="flex-1 min-w-0 px-2 py-1 rounded border border-chicken-brown/15 text-sm" />
                        <input type="color" value={z.color} onChange={(e) => recolorZone(z.id, e.target.value)} className="w-7 h-7 rounded cursor-pointer" />
                        <button onClick={() => deleteZone(z.id)} className="text-chicken-red text-sm px-1">🗑</button>
                      </div>
                      <div className="text-[11px] text-chicken-brown/45 mt-1">
                        {activeZoneId === z.id ? '✏️ 畫筆中 — 點桌上色' : `${localTables.filter(t => t.zoneId === z.id).length} 桌`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- 底圖（桌位 / 設施模式底部）---- */}
              {mode !== 'zones' && (
                <div className="mt-5 pt-4 border-t border-chicken-brown/10 space-y-2">
                  <div className="text-sm font-black text-chicken-brown">🖼 {floor} 底圖參考</div>
                  {bg?.url ? (
                    <>
                      <div className="rounded-lg overflow-hidden border border-chicken-brown/10">
                        <img src={bg.url} alt="底圖" className="w-full h-20 object-cover" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-chicken-brown/60 whitespace-nowrap">透明度</span>
                        <input type="range" min={0.1} max={1} step={0.05} value={bg.opacity} onChange={(e) => setBgOpacity(e.target.value)} className="flex-1" />
                      </div>
                      <button onClick={clearBg} className="w-full py-1.5 rounded-lg text-xs font-bold bg-chicken-red/10 text-chicken-red">清除底圖</button>
                    </>
                  ) : (
                    <label className="block w-full py-2 rounded-lg text-xs font-bold text-center bg-chicken-brown/5 hover:bg-chicken-brown/10 text-chicken-brown cursor-pointer">
                      上傳平面圖／照片
                      <input type="file" accept="image/*" onChange={onBgUpload} className="hidden" />
                    </label>
                  )}
                  <p className="text-[10px] text-chicken-brown/40">上傳後拖桌照著描；底圖只在此編輯器顯示，不影響現場/規劃圖。</p>
                </div>
              )}
            </aside>
          </div>

          {/* === 新增桌位對話框 === */}
          {showAddDialog && (
            <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAddDialog(null)}>
              <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-chicken-brown mb-3">➕ 新增桌位</h3>
                <p className="text-xs text-chicken-brown/60 mb-4">位置：{floor} · x={showAddDialog.x} y={showAddDialog.y}</p>
                <label className="text-xs font-bold text-chicken-brown/70 block mb-1.5">容量</label>
                <div className="grid grid-cols-2 gap-2">
                  {[4, 6].map(c => (
                    <button key={c} onClick={() => setNewTableForm(f => ({ ...f, capacity: c }))}
                            className={`py-2.5 rounded-xl border-2 text-sm font-bold ${newTableForm.capacity === c ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>{c} 人</button>
                  ))}
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

// 分區下拉（含「無分區」）
function ZonePicker({ zones, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}
            className="w-full px-2 py-2 rounded-lg border-2 border-chicken-brown/15 text-sm bg-white">
      <option value="">無分區</option>
      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
    </select>
  )
}

// 設施深拷貝（含 fallback 預設 + 補 id），避免與 settings 共用參考。
function deepFixtures(src) {
  const out = { '1F': [], '2F': [] }
  for (const floor of ['1F', '2F']) {
    const items = src?.[floor]
    out[floor] = (Array.isArray(items) && items.length ? items : (FIXTURES[floor] || []))
      .map(f => ({ id: f.id || genId('fx'), type: f.type, x: f.x, y: f.y, w: f.w || 0, h: f.h || 0, text: f.text || '', vtext: !!f.vtext }))
  }
  return out
}
