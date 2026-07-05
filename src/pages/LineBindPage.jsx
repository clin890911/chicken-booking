import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, ChevronLeft, Loader2, MessageCircle, TriangleAlert } from 'lucide-react'
import { Card } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import * as bookingService from '../services/bookingService'
import { decodeLinePayload, fetchLineBooking, lineLoginStartUrl, lineOfficialUrl } from '../services/lineService'
import { dayLabel } from '../utils/timeSlots'

// LINE 綁定結果頁。綁定本體已改由「LINE Login 網頁授權」完成（ConfirmPage CTA → 後端
// lineLoginStart → LINE 授權 → lineLoginCallback 寫綁定 + 推播 → 302 導回此頁帶 ?bound=1）。
// 本頁不再跑 LIFF（client SDK 多段重導易卡「一直載入」），只負責：
//   1. 顯示回呼結果（成功 / 待加好友 / 失敗）
//   2. 直接到站（或舊 LIFF 連結落地）時，提供「用 LINE 完成綁定」入口按鈕

const ERR_MESSAGES = {
  expired: '授權連結已過期，請回訂位頁重新點一次「加入並綁定 LINE 通知」。',
  'not-configured': 'LINE 綁定尚未設定完成，請先加入官方帳號；設定開通後即可自動接收訂位資訊。',
  'invalid-booking': '找不到此訂位或連結已失效，請使用最新的訂位確認頁。',
}

export default function LineBindPage() {
  const location = useLocation()
  const { settings } = useBooking()
  const bindParams = useMemo(() => collectBindParams(location.search, location.hash), [location.search, location.hash])
  const decodedPayload = useMemo(() => decodeLinePayload(bindParams.get('payload') || ''), [bindParams])
  const bookingId = bindParams.get('bookingId') || decodedPayload?.booking?.id || ''
  const token = bindParams.get('token') || decodedPayload?.booking?.token || decodedPayload?.booking?.manageToken || ''
  const bound = bindParams.get('bound') === '1'
  const needFriend = bindParams.get('needFriend') === '1'
  const errCode = bindParams.get('err') || ''

  const [remoteBooking, setRemoteBooking] = useState(null)
  const [remoteStoreSettings, setRemoteStoreSettings] = useState(null)
  const remoteFetchRef = useRef('')
  const lineSettings = useMemo(() => ({ ...settings, ...(remoteStoreSettings || {}) }), [settings, remoteStoreSettings])
  const officialUrl = lineOfficialUrl(lineSettings)

  // 顯示用訂位資料來源（依序）：本機 → 舊版連結 payload（相容）→ lineGetBooking 回讀。
  const booking = useMemo(() => {
    const localBooking = bookingId ? bookingService.ensureManageToken(bookingId) : null
    if (localBooking) return localBooking
    return normalizePayloadBooking(decodedPayload?.booking) || remoteBooking
  }, [bookingId, decodedPayload, remoteBooking])

  // 跨裝置 / LINE 內開啟、無本機資料時，回讀訂位摘要供顯示（不影響綁定結果判斷）。
  // StrictMode 守門只用 remoteFetchRef（跑一次）；★ 不可再用 cancelled 旗標擋 setState——
  // dev StrictMode「mount→cleanup→再 mount」會讓 run#1 的 fetch 結果被 cancelled 丟棄、
  // run#2 又被 ref 擋住 → remoteBooking 永遠設不進去、摘要永遠不顯示（本檔註解早已警告此坑）。
  useEffect(() => {
    if (!bookingId || !token) return
    if (remoteFetchRef.current !== '') return
    remoteFetchRef.current = 'pending'
    fetchLineBooking(settings, bookingId, token).then((remote) => {
      if (!booking && remote.ok && remote.booking?.id) setRemoteBooking(normalizePayloadBooking(remote.booking))
      if (remote.ok && remote.store) setRemoteStoreSettings(remote.store)
    })
  }, [booking, bookingId, token, settings])

  const startUrl = useMemo(() => {
    if (!booking?.id) return ''
    if (token && booking.manageToken && token !== booking.manageToken) return ''
    try { return lineLoginStartUrl(lineSettings, booking) } catch { return '' }
  }, [booking, token, lineSettings])

  // 狀態：err > bound（成功 / 待加好友）> ready（入口）> error（缺資料）
  const state = errCode
    ? 'error'
    : bound
      ? (needFriend ? 'need-friend' : 'success')
      : (booking ? 'ready' : 'error')

  const message = errCode
    ? (ERR_MESSAGES[errCode] || 'LINE 綁定未完成，請再試一次。')
    : bound
      ? (needFriend
        ? '綁定已完成，但還沒加入官方帳號好友。請點下方按鈕加入好友，加入後會自動補發訂位資訊。'
        : '已完成 LINE 訂位通知設定，官方帳號會傳送訂位摘要與定位資訊。')
      : (booking
        ? '點下方按鈕，用 LINE 授權即可接收訂位卡片、店家定位與修改入口；同一步驟也會加入官方帳號好友。'
        : '找不到此訂位資料，請回到訂位成功頁重新按一次「加入並綁定 LINE 通知」。')

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
                  <div className="text-xs font-bold opacity-85">雞王涮涮鍋</div>
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

              <div className="mt-5 grid gap-2">
                {/* 入口 / 重試：直接導向 LINE Login 授權（同分頁，完成後自動跳回本頁 ?bound=1） */}
                {(state === 'ready' || (state === 'error' && startUrl)) && startUrl && (
                  <a href={startUrl} className="btn-primary text-center !bg-[#06C755] text-base">
                    用 LINE 完成綁定
                  </a>
                )}
                {officialUrl && (state === 'need-friend' || state === 'ready' || state === 'success') && (
                  <a href={officialUrl} target="_blank" rel="noreferrer" className={`btn-primary text-center !bg-[#06C755] ${state === 'need-friend' ? '' : 'opacity-90'}`}>
                    加入 LINE 官方帳號
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
            完成 LINE 授權後，官方帳號會自動發送訂位摘要、店家定位與修改訂位連結；若先綁定才加好友，加好友後會自動補發。
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
  if (state === 'need-friend') return <MessageCircle className="mx-auto text-[#06C755]" size={46} />
  if (state === 'ready') return <MessageCircle className="mx-auto text-[#06C755]" size={46} />
  return <Loader2 className="mx-auto animate-spin text-[#06C755]" size={46} />
}

function statusTitle(state) {
  if (state === 'success') return 'LINE 訂位通知已啟用'
  if (state === 'error') return 'LINE 綁定未完成'
  if (state === 'need-friend') return '最後一步：加入官方帳號好友'
  if (state === 'ready') return '用 LINE 接收訂位通知'
  return '正在連接 LINE'
}
