import { useParams, useLocation, useSearchParams, Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as bookingService from '../services/bookingService'
import { dayLabel } from '../utils/timeSlots'
import { copyText } from '../utils/clipboard'
import { Card, Button, Badge } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import { lineBindUrl } from '../services/lineService'
import { guestGetBooking } from '../services/cloudDataService'

export default function ConfirmPage() {
  const { id } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const urlToken = searchParams.get('token') || ''
  const { settings } = useBooking()
  const diningDuration = Number(settings.diningDurationMin) || 90
  const cleanupBuffer = Number(settings.cleanupBufferMin) || 10
  const [b, setB] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copiedManage, setCopiedManage] = useState(false)
  const [showConfetti, setShowConfetti] = useState(true)

  useEffect(() => {
    let cancelled = false
    // 客人線上訂位：後端 guestCreateBooking 已回傳完整訂位（含 manageToken），
    // 透過 route state 帶入。但若重新整理、或把確認頁網址傳到另一支手機開，
    // route state 與本機資料都會消失 → 改用網址帶的 token 向後端補抓，避免「找不到此訂位」。
    async function load() {
      setLoading(true)
      const fromState = location.state?.booking
      if (fromState && fromState.id === id) {
        if (!cancelled) { setB(fromState); setLoading(false) }
        return
      }
      // 後台建立的訂位（員工已同步至本機）走 localStorage fallback。
      const local = bookingService.ensureManageToken(id)
      if (local) {
        if (!cancelled) { setB(local); setLoading(false) }
        return
      }
      const token = urlToken || fromState?.manageToken || ''
      if (token) {
        const remote = await guestGetBooking(id, token).catch(() => null)
        if (!cancelled && remote?.ok && remote.booking) {
          setB({ ...remote.booking, manageToken: remote.booking.manageToken || token })
          setLoading(false)
          return
        }
      }
      if (!cancelled) { setB(null); setLoading(false) }
    }
    load()
    const t = setTimeout(() => setShowConfetti(false), 2400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [id, location.state, urlToken])

  const confettiPieces = useMemo(() => generateConfetti(18), [])
  const manageUrl = useMemo(() => {
    if (!b?.manageToken) return ''
    return `${window.location.origin}/manage/${b.id}?token=${encodeURIComponent(b.manageToken)}`
  }, [b])
  const lineOfficialName = settings.lineOfficialName || 'LINE 官方帳號'
  // 這兩個 URL 在 render 階段計算；任何例外（如異常日期）都不該讓整頁白屏，故 try/catch 後退成空字串。
  const lineReceiveUrl = useMemo(() => {
    try { return b ? lineBindUrl(settings, b, manageUrl) : '' } catch { return '' }
  }, [b, manageUrl, settings])
  const calendarUrl = useMemo(() => {
    try { return b ? googleCalendarUrl(b, settings) : '' } catch { return '' }
  }, [b, settings])
  const mapUrl = settings.storeMapUrl || (settings.storeAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.storeAddress)}` : '')
  const telUrl = settings.storePhone ? `tel:${settings.storePhone}` : ''

  const copyId = async () => {
    if (!b) return
    if (await copyText(b.id)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const copyManageUrl = async () => {
    if (!manageUrl) return
    if (await copyText(manageUrl)) {
      setCopiedManage(true)
      setTimeout(() => setCopiedManage(false), 1800)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-chicken-cream">
        <Card className="text-center max-w-sm">
          <div className="text-5xl mb-2 animate-bounce">🐔</div>
          <p className="font-bold text-chicken-brown/70">正在讀取訂位...</p>
        </Card>
      </div>
    )
  }

  if (!b) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-chicken-cream">
        <Card className="text-center max-w-sm">
          <div className="text-5xl mb-2">🤔</div>
          <p className="font-bold text-chicken-brown">找不到此訂位</p>
          <p className="text-sm text-chicken-brown/60 mt-2">連結可能已失效，或需要從原本訂位的裝置開啟。可改用「查詢訂位」找回。</p>
          <Link to="/lookup" className="text-chicken-red text-sm mt-3 inline-block underline">查詢我的訂位</Link>
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
          <div
            className="animate-check-pop inline-flex w-24 h-24 rounded-full items-center justify-center mb-3 shadow-lg relative"
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
          </div>
          <h1 className="text-2xl font-black text-chicken-brown">訂位成功！</h1>
          <p className="text-sm text-chicken-brown/70 mt-1">訂位已建立，到店出示訂位編號即可</p>
        </div>

        {/* 訂位券：品牌紅色 header + 票券感虛線分隔 */}
        <div
          className="animate-soft-enter bg-white rounded-3xl shadow-lg border border-chicken-brown/10 overflow-hidden"
        >
          <div className="bg-chicken-red text-white px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="leading-tight">
                <div className="text-xs opacity-90">雞王涮涮鍋 · 訂位券</div>
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
        </div>

        <div
          className="animate-soft-enter mt-4 grid grid-cols-3 gap-2"
        >
          <MiniRule label="保留" value={`${cleanupBuffer} 分鐘`} />
          <MiniRule label="用餐" value={`${diningDuration} 分鐘`} />
          <MiniRule label="狀態" value="已確認" />
        </div>

        {/* 截圖提示 */}
        <div
          className="animate-soft-enter mt-4 text-center"
        >
          <p className="inline-flex items-center gap-1.5 text-xs font-bold text-chicken-brown/70 bg-white/60 px-3 py-1.5 rounded-full">
            📸 到店時出示訂位編號；需修改可使用下方管理連結
          </p>
        </div>

        {/* LINE 與訂位管理 */}
        <div
          className="animate-soft-enter mt-5 rounded-2xl border border-[#06C755]/25 bg-[#06C755]/5 p-4"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#06C755] text-sm font-black text-white">LINE</div>
            <div className="flex-1">
              <h2 className="text-base font-black text-chicken-brown">加入雞王 LINE 官方帳號</h2>
              <p className="mt-1 text-xs leading-5 text-chicken-brown/60">
                先加好友，之後即可由官方帳號接收訂位提醒、店家定位與修改連結。
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {lineReceiveUrl ? (
              <a href={lineReceiveUrl} target="_blank" rel="noreferrer" className="btn-primary w-full text-center">
                加入 LINE 官方帳號
              </a>
            ) : (
              <button className="btn-primary w-full opacity-70" disabled>
                LINE 官方帳號尚未設定
              </button>
            )}
            <div className="rounded-xl bg-white/80 px-3 py-2 text-xs font-bold leading-5 text-chicken-brown/60">
              目前按鈕會先開啟 {lineOfficialName} 加好友；正式 LIFF 推播上線後，官方帳號才會自動發送訂位摘要與修改連結。在那之前，請以本頁訂位編號與下方管理連結為準。
            </div>
            <Link to={`/manage/${b.id}?token=${encodeURIComponent(b.manageToken || '')}`} className="btn-yellow w-full text-center">
              管理 / 修改我的訂位
            </Link>
            <button
              type="button"
              onClick={copyManageUrl}
              className="rounded-2xl border border-chicken-brown/15 bg-white px-4 py-3 text-sm font-black text-chicken-brown transition hover:border-chicken-red/40"
            >
              {copiedManage ? '已複製管理連結' : '複製訂位管理連結'}
            </button>
          </div>
        </div>

        {/* 到店工具 */}
        <div
          className="animate-soft-enter mt-4 grid grid-cols-3 gap-2"
        >
          {calendarUrl ? (
            <a href={calendarUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center shadow-sm transition hover:border-chicken-red/30">
              <div className="text-xl">📅</div>
              <div className="mt-1 text-xs font-black text-chicken-brown">加到行事曆</div>
            </a>
          ) : (
            <button disabled className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center opacity-45 shadow-sm">
              <div className="text-xl">📅</div>
              <div className="mt-1 text-xs font-black text-chicken-brown">加到行事曆</div>
            </button>
          )}
          {mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center shadow-sm transition hover:border-chicken-red/30">
              <div className="text-xl">📍</div>
              <div className="mt-1 text-xs font-black text-chicken-brown">導航到店</div>
            </a>
          ) : (
            <button disabled className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center opacity-45 shadow-sm">
              <div className="text-xl">📍</div>
              <div className="mt-1 text-xs font-black text-chicken-brown">導航到店</div>
            </button>
          )}
          {telUrl ? (
            <a href={telUrl} className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center shadow-sm transition hover:border-chicken-red/30">
              <div className="text-xl">📞</div>
              <div className="mt-1 text-xs font-black text-chicken-brown">撥電話</div>
            </a>
          ) : (
            <button disabled className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center opacity-45 shadow-sm">
              <div className="text-xl">📞</div>
              <div className="mt-1 text-xs font-black text-chicken-brown">撥電話</div>
            </button>
          )}
        </div>

        {/* 注意事項 */}
        <div
          className="animate-soft-enter mt-5 rounded-2xl border-2 border-chicken-yellow/40 bg-chicken-yellow/5 overflow-hidden"
        >
          <div className="px-4 py-2 bg-chicken-yellow/15 flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-bold text-chicken-brown text-sm">用餐前請留意</span>
          </div>
          <ul className="px-4 py-3 space-y-2 text-sm text-chicken-brown leading-relaxed">
            <Tip icon="⏱">請於用餐時段前 <strong>5 分鐘</strong> 抵達現場</Tip>
            <Tip icon="⌛">用餐時間 <strong>{diningDuration} 分鐘</strong>，保留 <strong>{cleanupBuffer} 分鐘</strong> 翻桌緩衝</Tip>
            <Tip icon="📞">用餐前 2 小時以前可用管理連結修改或取消；更近時間請來電</Tip>
            <Tip icon="🐔">本店使用 <strong>48 小時冷藏文昌雞</strong>，當日限量供應</Tip>
          </ul>
        </div>

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

function MiniRule({ label, value }) {
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-white px-2 py-3 text-center shadow-sm">
      <div className="text-[11px] font-bold text-chicken-brown/50">{label}</div>
      <div className="mt-1 text-sm font-black text-chicken-brown">{value}</div>
    </div>
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

function googleCalendarUrl(booking, settings = {}) {
  const start = new Date(`${booking.date}T${booking.timeSlot}:00`)
  // 日期/時段異常時 start 會是 Invalid Date，後續 toISOString() 會丟 RangeError 並讓整頁白屏。
  // 這裡先擋掉：回傳空字串，呼叫端會改顯示停用的「加到行事曆」按鈕。
  if (Number.isNaN(start.getTime())) return ''
  const diningDuration = Number(settings.diningDurationMin) || 90
  const cleanupBuffer = Number(settings.cleanupBufferMin) || 10
  const end = new Date(start.getTime() + diningDuration * 60 * 1000)
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: '雞王涮涮鍋訂位',
    dates: `${fmt(start)}/${fmt(end)}`,
    details: [
      `訂位編號：${booking.id}`,
      `姓名：${booking.name}`,
      `人數：${booking.guests} 位`,
      `請於用餐時段前 5 分鐘抵達。用餐時間 ${diningDuration} 分鐘，店內保留 ${cleanupBuffer} 分鐘翻桌緩衝。`,
    ].join('\n'),
    location: settings.storeAddress || '雞王涮涮鍋',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
