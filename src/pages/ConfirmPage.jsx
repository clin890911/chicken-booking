import { useParams, Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as bookingService from '../services/bookingService'
import { dayLabel } from '../utils/timeSlots'
import { Card, Button, Badge } from '../components/ui'

export default function ConfirmPage() {
  const { id } = useParams()
  const [b, setB] = useState(null)
  const [copied, setCopied] = useState(false)
  const [showConfetti, setShowConfetti] = useState(true)

  useEffect(() => {
    setB(bookingService.getById(id))
    const t = setTimeout(() => setShowConfetti(false), 2400)
    return () => clearTimeout(t)
  }, [id])

  const confettiPieces = useMemo(() => generateConfetti(18), [])

  const copyId = async () => {
    if (!b) return
    try {
      await navigator.clipboard.writeText(b.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = b.id
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch {}
      document.body.removeChild(ta)
    }
  }

  if (!b) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-chicken-cream">
        <Card className="text-center max-w-sm">
          <div className="text-5xl mb-2">🤔</div>
          <p className="font-bold text-chicken-brown">找不到此訂位</p>
          <Link to="/book" className="text-chicken-red text-sm mt-3 inline-block underline">重新訂位</Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-red/5 via-chicken-cream to-white p-4 flex flex-col relative overflow-hidden">
      {/* 品牌感的成功動畫：彩帶 + 飛舞的雞 */}
      <AnimatePresence>
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden z-0" aria-hidden>
            {confettiPieces.map((p, i) => (
              <motion.div
                key={i}
                initial={{ y: -40, x: `${p.x}vw`, opacity: 0, rotate: 0 }}
                animate={{ y: '110vh', opacity: [0, 1, 1, 0], rotate: p.rotate }}
                exit={{ opacity: 0 }}
                transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
                className="absolute top-0 text-2xl"
                style={{ left: 0 }}
              >
                {p.glyph}
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-md w-full mx-auto pt-6 flex-1 relative z-10">
        {/* Hero：彈跳勾勾 + 招牌品牌字 */}
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 14 }}
            className="inline-flex w-24 h-24 rounded-full items-center justify-center mb-3 shadow-lg relative"
            style={{ background: 'linear-gradient(135deg, #9eb63a 0%, #f29100 100%)' }}
          >
            <motion.svg
              width="48" height="48" viewBox="0 0 48 48" fill="none"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
            >
              <motion.path
                d="M12 24 L21 33 L36 16"
                stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
              />
            </motion.svg>
            <motion.div
              className="absolute -top-1 -right-2 text-3xl"
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 12 }}
              transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.5 }}
            >
              🐔
            </motion.div>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            className="text-2xl font-black text-chicken-brown"
          >
            訂位成功！
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
            className="text-sm text-chicken-brown/70 mt-1"
          >
            雞王刷刷鍋 · Master of Chicken<br />
            期待您的光臨 🍲
          </motion.p>
        </div>

        {/* 訂位券：品牌紅色 header + 票券感虛線分隔 */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white rounded-3xl shadow-lg border border-chicken-brown/10 overflow-hidden"
        >
          <div className="bg-chicken-red text-white px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🐔</span>
              <div className="leading-tight">
                <div className="text-xs opacity-90">雞王刷刷鍋 · 訂位券</div>
                <div className="font-black text-sm">Master of Chicken</div>
              </div>
            </div>
            <Badge color="yellow" className="bg-chicken-yellow text-white">已確認</Badge>
          </div>

          {/* 訂位編號區塊 */}
          <div className="px-5 pt-4 pb-3 text-center bg-chicken-cream/40">
            <p className="text-xs text-chicken-brown/60 mb-1">訂位編號</p>
            <p className="font-mono font-black text-2xl text-chicken-red tracking-wider break-all">
              {b.id}
            </p>
            <button
              onClick={copyId}
              className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-white border border-chicken-brown/15 hover:border-chicken-red/40 active:scale-95 transition-all"
            >
              {copied ? '✓ 已複製' : '📋 複製編號'}
            </button>
          </div>

          {/* 票券虛線分隔（兩側挖洞效果） */}
          <div className="relative h-4">
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-chicken-cream rounded-full" />
            <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-chicken-cream rounded-full" />
            <div className="absolute left-3 right-3 top-1/2 border-t-2 border-dashed border-chicken-brown/15" />
          </div>

          {/* 訂位摘要 */}
          <div className="px-5 py-4 space-y-3">
            <Row icon="📅" label="日期" value={dayLabel(b.date)} />
            <Row icon="⏰" label="時段" value={<span className="text-lg font-black text-chicken-red">{b.timeSlot}</span>} />
            <Row icon="👥" label="人數" value={`${b.guests} 位`} />
            <Row icon="🙋" label="姓名" value={b.name} />
            <Row icon="📞" label="電話" value={<span className="font-mono">{b.phone}</span>} />
            {(b.notes?.pet || b.notes?.child || b.notes?.mobility) && (
              <Row icon="✨" label="特殊需求" value={
                <div className="flex gap-1 flex-wrap justify-end">
                  {b.notes.pet && <Badge color="yellow">🐾 寵物</Badge>}
                  {b.notes.child && <Badge color="green">👶 兒童</Badge>}
                  {b.notes.mobility && <Badge color="brown">♿ 行動不便</Badge>}
                </div>
              } />
            )}
            {b.notes?.text && <Row icon="📝" label="備註" value={<span className="text-sm">{b.notes.text}</span>} />}
          </div>
        </motion.div>

        {/* 截圖提示 */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          className="mt-4 text-center"
        >
          <p className="inline-flex items-center gap-1.5 text-xs font-bold text-chicken-brown/70 bg-white/60 px-3 py-1.5 rounded-full">
            📸 建議截圖此頁面，到店時出示訂位編號
          </p>
        </motion.div>

        {/* 注意事項 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          className="mt-5 rounded-2xl border-2 border-chicken-yellow/40 bg-chicken-yellow/5 overflow-hidden"
        >
          <div className="px-4 py-2 bg-chicken-yellow/15 flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-bold text-chicken-brown text-sm">用餐前請留意</span>
          </div>
          <ul className="px-4 py-3 space-y-2 text-sm text-chicken-brown leading-relaxed">
            <Tip icon="⏱">請於用餐時段前 <strong>5 分鐘</strong> 抵達現場</Tip>
            <Tip icon="⌛">逾時 <strong>15 分鐘</strong>，訂位將自動釋出</Tip>
            <Tip icon="📞">如需取消或更動，請來電通知，避免影響其他客人</Tip>
            <Tip icon="🐔">本店使用 <strong>48 小時冷藏文昌雞</strong>，當日限量供應</Tip>
          </ul>
        </motion.div>

        {/* 動作按鈕 */}
        <div className="mt-6 space-y-2">
          <Link to="/book" className="block">
            <Button variant="secondary" className="w-full">再訂一筆</Button>
          </Link>
          <Link to="/" className="block text-center text-xs text-chicken-brown/50 underline pt-1">回首頁</Link>
        </div>
      </main>
    </div>
  )
}

function Row({ icon, label, value }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-sm text-chicken-brown/70 flex items-center gap-1.5">
        <span>{icon}</span>
        {label}
      </span>
      <span className="text-chicken-brown font-bold text-right">{value}</span>
    </div>
  )
}

function Tip({ icon, children }) {
  return (
    <li className="flex items-start gap-2">
      <span className="leading-6">{icon}</span>
      <span className="flex-1">{children}</span>
    </li>
  )
}

function generateConfetti(n) {
  const glyphs = ['🐔', '✨', '🎉', '🍲']
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      glyph: glyphs[i % glyphs.length],
      x: Math.random() * 95,
      rotate: (Math.random() - 0.5) * 720,
      duration: 1.6 + Math.random() * 1.0,
      delay: Math.random() * 0.4
    })
  }
  return out
}
