import { useParams, useLocation, useSearchParams, Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as bookingService from '../services/bookingService'
import { dayLabel } from '../utils/timeSlots'
import { copyText } from '../utils/clipboard'
import { Card, Button, Badge } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import { lineLoginStartUrl, lineOfficialUrl } from '../services/lineService'
import { useLineAuthorizeUrl } from '../hooks/useLineAuthorizeUrl'
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
  const [guestStoreSettings, setGuestStoreSettings] = useState(null)

  useEffect(() => {
    let cancelled = false
    // 客人線上訂位：後端 guestCreateBooking 已回傳完整訂位（含 manageToken），
    // 透過 route state 帶入。但若重新整理、或把確認頁網址傳到另一支手機開，
    // route state 與本機資料都會消失 → 改用網址帶的 token 向後端補抓，避免「找不到此訂位」。
    async function load() {
      setLoading(true)
      const fromState = location.state?.booking
      const fromStateStore = location.state?.store || location.state?.settings || null
      if (fromStateStore && !cancelled) setGuestStoreSettings(fromStateStore)
      if (fromState && fromState.id === id) {
        if (!cancelled) { setB(fromState); setLoading(false) }
        const token = urlToken || fromState.manageToken || ''
        if (token && !fromStateStore) {
          guestGetBooking(id, token).then((remote) => {
            if (cancelled) return
            if (remote?.store) setGuestStoreSettings(remote.store)
            if (remote?.ok && remote.booking) {
              setB(current => current || { ...remote.booking, manageToken: remote.booking.manageToken || token })
            }
          }).catch(() => {})
        }
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
          if (remote.store) setGuestStoreSettings(remote.store)
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
  const lineSettings = useMemo(() => ({ ...settings, ...(guestStoreSettings || {}) }), [settings, guestStoreSettings])
  const manageUrl = useMemo(() => {
    if (!b?.manageToken) return ''
    return `${window.location.origin}/manage/${b.id}?token=${encodeURIComponent(b.manageToken)}`
  }, [b])
  const lineOfficialName = lineSettings.lineOfficialName || 'LINE 官方帳號'
  const lineFriendUrl = lineOfficialUrl(lineSettings)
  // 直達授權預取：CTA href 直指 access.line.me 才能觸發 Universal Link 直跳 LINE app
  // （經後端 302 中轉會掉到帳密網頁表單）。已綁定/待加好友時不預取。
  const authorizeUrl = useLineAuthorizeUrl(lineSettings, b, !!b && !b.lineUserId && !b.linePushBlocked)
  // 這兩個 URL 在 render 階段計算；任何例外（如異常日期）都不該讓整頁白屏，故 try/catch 後退成空字串。
  // 預取沒回來/失敗 → 退回舊 302 路（lineLoginStart GET），保底不壞。
  const lineReceiveUrl = useMemo(() => {
    if (authorizeUrl) return authorizeUrl
    try { return b ? lineLoginStartUrl(lineSettings, b) : '' } catch { return '' }
  }, [authorizeUrl, b, lineSettings])
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
          <p className="mt-1.5 text-xs font-bold leading-5 text-chicken-brown/55">
            📸 建議截圖保存此頁；或綁定下方 LINE 通知，之後在 LINE 隨時可查詢、修改訂位
          </p>
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

        {/* LINE 通知：頁面第一順位 CTA——綁定流程自帶加好友引導（getFriendship 檢查 +
            follow 事件自動補發），單一按鈕即可完成，不再拆「加好友/綁定」兩顆按鈕。 */}
        <div
          className="animate-soft-enter mt-4 rounded-2xl border-2 border-[#06C755]/35 bg-[#06C755]/5 p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#06C755] text-sm font-black text-white">LINE</div>
            <div className="flex-1">
              <h2 className="text-base font-black text-chicken-brown">別漏接訂位通知</h2>
              <p className="mt-1 text-xs leading-5 text-chicken-brown/60">
                訂位卡片、店家定位與任何異動，自動傳到您的 LINE。
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {/* 已綁定（頁面重新整理走 guestGetBooking 才會有此狀態）→ 顯示綁定成功取代重複的加入流程 */}
            {b.lineUserId && !b.linePushBlocked ? (
              <div className="rounded-xl bg-white/80 px-3 py-2.5 text-sm font-black text-[#06A848]">
                ✓ 已綁定 LINE{b.lineDisplayName ? `（${b.lineDisplayName}）` : ''}，訂位卡片與異動會自動傳送
              </div>
            ) : b.linePushBlocked ? (
              <>
                <div className="rounded-xl bg-chicken-yellow/15 px-3 py-2.5 text-sm font-black text-chicken-brown">
                  ⚠ LINE 通知暫時無法送達，請重新加入官方帳號好友（加入後會自動補發）
                </div>
                {lineFriendUrl && (
                  <a href={lineFriendUrl} target="_blank" rel="noreferrer" className="btn-primary w-full text-center !bg-[#06C755]">
                    重新加入 {lineOfficialName} 好友
                  </a>
                )}
              </>
            ) : lineReceiveUrl ? (
              <>
                <a href={lineReceiveUrl} className="btn-primary w-full text-center !bg-[#06C755] text-base">
                  加入並綁定 LINE 通知
                </a>
                <p className="text-center text-[11px] font-bold leading-4 text-chicken-brown/50">
                  會開啟 LINE 完成授權並加入官方帳號好友；完成後自動傳送訂位資訊。先綁定才加好友也會自動補發。
                </p>
              </>
            ) : lineFriendUrl ? (
              <a href={lineFriendUrl} target="_blank" rel="noreferrer" className="btn-primary w-full text-center !bg-[#06C755]">
                加入 {lineOfficialName} 好友
              </a>
            ) : (
              <button className="btn-primary w-full opacity-70" disabled>
                LINE 官方帳號尚未設定
              </button>
            )}
          </div>
        </div>

        {/* 到店工具：上移到 LINE 卡之後，第一屏內就拿得到 */}
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

        {/* 訂位管理 */}
        <div
          className="animate-soft-enter mt-4 rounded-2xl border border-chicken-brown/10 bg-white/80 p-4"
        >
          <p className="mb-3 text-center text-xs font-bold text-chicken-brown/60">
            📸 到店時出示訂位編號；需要改期或取消可用下方管理連結
          </p>
          <div className="grid gap-2">
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
