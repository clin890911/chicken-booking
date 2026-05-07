import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, ChevronLeft, Loader2, MessageCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button, Card } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import * as bookingService from '../services/bookingService'
import { bookingLinePayload, decodeLinePayload, lineBindEndpoint, lineLiffId, lineLiffUrl, lineOfficialUrl, loadLiffSdk } from '../services/lineService'
import { dayLabel } from '../utils/timeSlots'

const LINE_BIND_STATE_KEY = 'chicken_line_bind_params_v1'
const LINE_BIND_REDIRECT_KEY = 'chicken_line_bind_redirect_v1'
const LINE_BIND_SUBMITTED_KEY = 'chicken_line_bind_submitted_v1'
const LINE_BIND_SUBMIT_DEDUPE_MS = 5 * 60 * 1000

export default function LineBindPage() {
  const location = useLocation()
  const { settings } = useBooking()
  const bindParams = useMemo(() => collectBindParams(location.search, location.hash), [location.search, location.hash])
  const decodedPayload = useMemo(() => decodeLinePayload(bindParams.get('payload') || ''), [bindParams])
  const bookingId = bindParams.get('bookingId') || decodedPayload?.booking?.id || ''
  const token = bindParams.get('token') || decodedPayload?.booking?.token || decodedPayload?.booking?.manageToken || ''
  const manageUrl = bindParams.get('manageUrl') || decodedPayload?.booking?.manageUrl || ''
  const officialUrl = lineOfficialUrl(settings)
  const liffId = lineLiffId(settings)
  const liffUrl = lineLiffUrl(settings)
  const endpoint = lineBindEndpoint(settings)
  const shouldUseLiff = (bindParams.get('useLiff') === '1' || settings.lineUseLiff) && !!liffId && !!liffUrl

  const [state, setState] = useState('loading')
  const [message, setMessage] = useState('正在準備 LINE 訂位通知...')
  const [profile, setProfile] = useState(null)
  const submittedRef = useRef(new Set())

  const booking = useMemo(() => {
    const localBooking = bookingId ? bookingService.ensureManageToken(bookingId) : null
    if (localBooking) return localBooking
    return normalizePayloadBooking(decodedPayload?.booking)
  }, [bookingId, decodedPayload])
  const payload = useMemo(() => {
    if (decodedPayload?.booking && booking?.id) {
      return {
        ...decodedPayload,
        booking: {
          ...decodedPayload.booking,
          id: booking.id,
          token: booking.manageToken || token,
          manageUrl: manageUrl || decodedPayload.booking.manageUrl,
        },
      }
    }
    return booking ? bookingLinePayload(booking, settings, manageUrl) : null
  }, [booking, decodedPayload, manageUrl, settings, token])

  useEffect(() => {
    let cancelled = false
    async function run() {
      let activeSubmitKey = ''
      if (!booking) {
        setState('error')
        setMessage('找不到此訂位資料，請回到訂位成功頁重新按一次 LINE 接收按鈕。')
        return
      }
      if (!token || token !== booking.manageToken) {
        setState('error')
        setMessage('訂位連結驗證失敗，請使用最新的 LINE 接收連結。')
        return
      }
      if (!liffId) {
        setState('setup')
        setMessage('請先加入雞王 LINE 官方帳號，並保留此頁的管理訂位入口。正式 LIFF 自動綁定開通後，官方帳號會自動傳送訂位與定位。')
        return
      }
      if (!endpoint) {
        setState('setup')
        setMessage('LINE 後端推播端點尚未設定。請先加入官方帳號，待後端啟用後即可自動接收訊息。')
        return
      }

      try {
        persistBindParams(bindParams)
        if (shouldUseLiff && !isLikelyLiffCallback(location.search, location.hash) && !hasRecentlyRedirected(booking.id)) {
          rememberLiffRedirect(booking.id)
          setState('loading')
          setMessage('正在開啟 LINE 授權，完成後官方帳號會傳送訂位資訊。')
          window.location.href = buildLiffUrl(liffUrl, bindParams)
          return
        }
        const liff = await loadLiffSdk()
        await liff.init({ liffId })
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href })
          return
        }
        const nextProfile = await liff.getProfile()
        if (cancelled) return
        setProfile(nextProfile)
        setMessage('正在綁定您的 LINE 訂位通知...')
        activeSubmitKey = `${booking.id}:${nextProfile.userId}`
        if (submittedRef.current.has(activeSubmitKey) || hasRecentlySubmittedBind(activeSubmitKey)) {
          setState('success')
          setMessage('LINE 訂位通知已完成設定；剛剛已傳送過訂位資訊，因此不重複發送。')
          return
        }
        submittedRef.current.add(activeSubmitKey)
        rememberSubmittedBind(activeSubmitKey)

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            line: {
              userId: nextProfile.userId,
              displayName: nextProfile.displayName,
              pictureUrl: nextProfile.pictureUrl,
            },
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) throw new Error(data.error || 'LINE 綁定失敗')
        clearPersistedBindParams()
        setState('success')
        setMessage(data.skippedPush
          ? 'LINE 訂位通知已完成設定；剛剛已傳送過訂位資訊，因此不重複發送。'
          : '已完成 LINE 訂位通知設定，官方帳號會傳送訂位摘要與定位資訊。')
      } catch (err) {
        console.warn('LINE bind failed:', err)
        if (activeSubmitKey) {
          submittedRef.current.delete(activeSubmitKey)
          forgetSubmittedBind(activeSubmitKey)
        }
        setState('error')
        setMessage(err.message || 'LINE 綁定失敗，請稍後再試。')
      }
    }
    run()
    return () => { cancelled = true }
  }, [bindParams, booking, endpoint, liffId, liffUrl, location.hash, location.search, payload, shouldUseLiff, token])

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#06C755]/10 via-chicken-cream to-white pb-12">
      <header className="sticky top-0 z-30 border-b border-chicken-brown/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Link to={booking ? `/confirm/${booking.id}` : '/'} className="flex h-10 w-10 items-center justify-center rounded-full bg-chicken-brown/5 text-chicken-brown">
            <ChevronLeft size={22} />
          </Link>
          <div>
            <div className="text-base font-black text-chicken-brown">LINE 訂位通知</div>
            <div className="text-xs font-bold text-chicken-brown/55">接收訂位、定位與修改入口</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden !p-0">
            <div className="bg-[#06C755] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
                  <MessageCircle size={24} />
                </div>
                <div>
                  <div className="text-xs font-bold opacity-85">雞王刷刷鍋</div>
                  <h1 className="text-xl font-black">用 LINE 接收訂位資訊</h1>
                </div>
              </div>
            </div>

            {booking && (
              <div className="grid gap-2 border-b border-chicken-brown/10 bg-chicken-cream/50 px-5 py-4 text-sm font-bold text-chicken-brown">
                <div className="flex justify-between"><span className="text-chicken-brown/55">訂位編號</span><span className="font-mono">{booking.id}</span></div>
                <div className="flex justify-between"><span className="text-chicken-brown/55">日期時間</span><span>{dayLabel(booking.date)} {booking.timeSlot}</span></div>
                <div className="flex justify-between"><span className="text-chicken-brown/55">人數</span><span>{booking.guests} 位</span></div>
              </div>
            )}

            <div className="p-5 text-center">
              <StatusIcon state={state} />
              <h2 className="mt-4 text-lg font-black text-chicken-brown">{statusTitle(state)}</h2>
              <p className="mt-2 text-sm leading-6 text-chicken-brown/60">{message}</p>
              {profile?.displayName && (
                <p className="mt-2 text-xs font-bold text-chicken-brown/45">LINE：{profile.displayName}</p>
              )}

              <div className="mt-5 grid gap-2">
                {officialUrl && (
                  <a href={officialUrl} target="_blank" rel="noreferrer" className="btn-primary text-center !bg-[#06C755]">
                    加入 LINE 官方帳號
                  </a>
                )}
                {shouldUseLiff && (
                  <a href={buildLiffUrl(liffUrl, bindParams)} className="btn-primary text-center">
                    在 LINE 完成訂位綁定
                  </a>
                )}
                {booking && (
                  <Link to={`/manage/${booking.id}?token=${encodeURIComponent(booking.manageToken || '')}`} className="btn-secondary text-center">
                    管理 / 修改我的訂位
                  </Link>
                )}
              </div>
            </div>
          </Card>

          <div className="mt-4 rounded-2xl border border-chicken-brown/10 bg-white/75 p-4 text-xs font-bold leading-5 text-chicken-brown/55">
            若沒有自動收到 LINE 訂位摘要，請先加入官方帳號並保留此頁的管理訂位入口；LIFF 自動綁定確認可用後，官方帳號會自動發送訂位摘要、店家定位與修改訂位連結。
          </div>
        </motion.div>
      </main>
    </div>
  )
}

function collectBindParams(search = '', hash = '') {
  const params = new URLSearchParams(search)
  mergeParams(params, params.get('liff.state'))

  const hashText = hash.startsWith('#') ? hash.slice(1) : hash
  if (hashText) {
    mergeParams(params, hashText)
    const hashQueryIndex = hashText.indexOf('?')
    if (hashQueryIndex >= 0) mergeParams(params, hashText.slice(hashQueryIndex))
  }

  if (!params.get('bookingId') && !params.get('payload')) {
    mergeParams(params, readPersistedBindParams())
  }

  return params
}

function mergeParams(target, source) {
  if (!source) return
  const decoded = safeDecode(source)
  const query = decoded.includes('?') ? decoded.slice(decoded.indexOf('?')) : decoded
  const sourceParams = new URLSearchParams(query.startsWith('?') ? query : `?${query}`)
  sourceParams.forEach((value, key) => {
    if (!target.get(key)) target.set(key, value)
  })
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function persistBindParams(params) {
  if (!params.get('bookingId') && !params.get('payload')) return
  try {
    sessionStorage.setItem(LINE_BIND_STATE_KEY, params.toString())
  } catch {}
}

function readPersistedBindParams() {
  try {
    return sessionStorage.getItem(LINE_BIND_STATE_KEY) || ''
  } catch {
    return ''
  }
}

function clearPersistedBindParams() {
  try {
    sessionStorage.removeItem(LINE_BIND_STATE_KEY)
    sessionStorage.removeItem(LINE_BIND_REDIRECT_KEY)
  } catch {}
}

function isLikelyLiffCallback(search = '', hash = '') {
  const text = `${search || ''}${hash || ''}`
  return text.includes('liff.state') || text.includes('access_token') || text.includes('id_token') || text.includes('friendship_status_changed')
}

function hasRecentlyRedirected(bookingId) {
  try {
    const raw = sessionStorage.getItem(LINE_BIND_REDIRECT_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    return data.bookingId === bookingId && Date.now() - Number(data.at || 0) < 90 * 1000
  } catch {
    return false
  }
}

function rememberLiffRedirect(bookingId) {
  try {
    sessionStorage.setItem(LINE_BIND_REDIRECT_KEY, JSON.stringify({ bookingId, at: Date.now() }))
  } catch {}
}

function hasRecentlySubmittedBind(key) {
  try {
    const data = JSON.parse(sessionStorage.getItem(LINE_BIND_SUBMITTED_KEY) || '{}')
    const submittedAt = Number(data[key] || 0)
    return submittedAt > 0 && Date.now() - submittedAt < LINE_BIND_SUBMIT_DEDUPE_MS
  } catch {
    return false
  }
}

function rememberSubmittedBind(key) {
  try {
    const data = JSON.parse(sessionStorage.getItem(LINE_BIND_SUBMITTED_KEY) || '{}')
    const now = Date.now()
    const next = Object.fromEntries(
      Object.entries(data).filter(([, value]) => now - Number(value || 0) < LINE_BIND_SUBMIT_DEDUPE_MS)
    )
    next[key] = now
    sessionStorage.setItem(LINE_BIND_SUBMITTED_KEY, JSON.stringify(next))
  } catch {}
}

function forgetSubmittedBind(key) {
  try {
    const data = JSON.parse(sessionStorage.getItem(LINE_BIND_SUBMITTED_KEY) || '{}')
    delete data[key]
    sessionStorage.setItem(LINE_BIND_SUBMITTED_KEY, JSON.stringify(data))
  } catch {}
}

function buildLiffUrl(base, params) {
  const url = new URL(base)
  params.forEach((value, key) => {
    if (!url.searchParams.get(key)) url.searchParams.set(key, value)
  })
  return url.toString()
}

function normalizePayloadBooking(booking) {
  if (!booking?.id) return null
  return {
    id: booking.id,
    manageToken: booking.manageToken || booking.token || '',
    name: booking.name || '訂位客人',
    phone: booking.phone || '',
    guests: Number(booking.guests) || 1,
    date: booking.date,
    timeSlot: booking.timeSlot,
    notes: booking.notes || {},
    status: booking.status || 'confirmed',
  }
}

function StatusIcon({ state }) {
  if (state === 'success') return <CheckCircle2 className="mx-auto text-chicken-green" size={46} />
  if (state === 'error') return <TriangleAlert className="mx-auto text-chicken-red" size={46} />
  if (state === 'setup') return <ShieldCheck className="mx-auto text-chicken-yellow" size={46} />
  return <Loader2 className="mx-auto animate-spin text-[#06C755]" size={46} />
}

function statusTitle(state) {
  if (state === 'success') return 'LINE 訂位通知已啟用'
  if (state === 'error') return 'LINE 綁定未完成'
  if (state === 'setup') return 'LINE 自動通知準備中'
  return '正在連接 LINE'
}
