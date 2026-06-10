import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarDays, ChevronLeft, Loader2, MapPin, MessageCircle, Phone, Search, TriangleAlert } from 'lucide-react'
import { Card, Badge } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import { fetchLineMyBookings, lineLiffId, lineMyBookingsEndpoint, loadLiffSdk } from '../services/lineService'

// 「LINE 我的訂位」：店家在 LINE 官方帳號 rich menu 放本頁連結。
// LINE in-app browser 內 liff.login() 為無感自動登入 → getIDToken → 後端驗明身分 → 列出綁定訂位。
// 設計鐵則：任何失敗（LIFF 不可用 / 未開 openid scope / channel ID 未設定 / 驗證失敗）
// 一律優雅退回電話查詢（/lookup），絕不白屏、絕不擋住客人查訂位。

const LINE_MYBOOKINGS_LOGIN_KEY = 'chicken_line_mybookings_login_v1'
const LOGIN_RETRY_WINDOW_MS = 60 * 1000

const STATUS_MAP = {
  confirmed: { label: '已確認', color: 'green' },
  arrived: { label: '用餐中', color: 'yellow' },
  completed: { label: '已完成', color: 'brown' },
  cancelled: { label: '已取消', color: 'brown' },
  noshow: { label: '未到', color: 'brown' },
}

export default function LineMyBookingsPage() {
  const { settings } = useBooking()
  const [view, setView] = useState('loading') // loading | list | empty | fallback | error
  const [message, setMessage] = useState('正在連接 LINE...')
  const [items, setItems] = useState([])
  const [store, setStore] = useState({})
  const [displayName, setDisplayName] = useState('')
  const runRef = useRef(false)

  useEffect(() => {
    // StrictMode 下 effect 會「mount → cleanup → 再 mount」連跑兩次：ref 守門讓整段流程
    // （含打端點）只執行一次、不燒 rate limit。注意不能再用 cancelled 旗標擋 setState——
    // run #1 必定先被 cleanup，若它拒絕寫入結果、run #2 又被 ref 擋住，畫面會永遠卡 loading
    //（LineBindPage 踩過同坑）。StrictMode 兩次 effect 屬同一元件實例，直接 setState 是安全的。
    if (runRef.current) return
    runRef.current = true

    async function run() {
      try {
        const liffId = lineLiffId(settings)
        const endpoint = lineMyBookingsEndpoint(settings)
        if (!liffId || !endpoint) return setView('fallback')

        const liff = await loadLiffSdk()
        await liff.init({ liffId })
        if (!liff.isLoggedIn()) {
          // 登入迴圈防護：60 秒內已嘗試過 login 還是未登入 → 放棄走 fallback
          if (hasRecentLoginAttempt()) return setView('fallback')
          rememberLoginAttempt()
          setMessage('正在開啟 LINE 登入...')
          liff.login({ redirectUri: window.location.href })
          return
        }
        const idToken = typeof liff.getIDToken === 'function' ? liff.getIDToken() : null
        if (!idToken) return setView('fallback') // LIFF 未開 openid scope

        setMessage('正在查詢您的訂位...')
        const result = await fetchLineMyBookings(settings, idToken)
        if (result.error === 'expired-id-token' && !hasRecentLoginAttempt()) {
          // token 過期（頁面掛在 LINE 內太久）：一次性重新登入換新 token
          rememberLoginAttempt()
          liff.login({ redirectUri: window.location.href })
          return
        }
        if (!result.ok) {
          if (['not-configured', 'invalid-id-token', 'expired-id-token'].includes(result.error)) return setView('fallback')
          setView('error')
          setMessage(result.error?.includes('頻繁') ? result.error : '查詢失敗，請稍後再試，或改用電話查詢。')
          return
        }
        setItems(result.items)
        setStore(result.store || {})
        setDisplayName(result.line?.displayName || '')
        clearLoginAttempt()
        setView(result.items.length ? 'list' : 'empty')
      } catch (err) {
        console.warn('LINE my-bookings init failed:', err)
        setView('fallback')
      }
    }

    run()
  }, [settings])

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#06C755]/10 via-chicken-cream to-white pb-12">
      <header className="sticky top-0 z-30 border-b border-chicken-brown/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex h-10 w-10 items-center justify-center rounded-full bg-chicken-brown/5 text-chicken-brown">
            <ChevronLeft size={22} />
          </Link>
          <div>
            <div className="text-base font-black text-chicken-brown">我的訂位</div>
            <div className="text-xs font-bold text-chicken-brown/55">查詢以 LINE 綁定的訂位</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden !p-0">
            <div className="bg-[#06C755] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
                  <CalendarDays size={24} />
                </div>
                <div>
                  <div className="text-xs font-bold opacity-85">雞王涮涮鍋</div>
                  <h1 className="text-xl font-black">{displayName ? `嗨，${displayName}` : '我的訂位'}</h1>
                </div>
              </div>
            </div>

            <div className="p-5">
              {view === 'loading' && (
                <div className="py-6 text-center">
                  <Loader2 className="mx-auto animate-spin text-[#06C755]" size={42} />
                  <p className="mt-3 text-sm font-bold text-chicken-brown/60">{message}</p>
                </div>
              )}

              {view === 'list' && (
                <div className="grid gap-3">
                  {items.map(item => <BookingItem key={item.id} item={item} />)}
                </div>
              )}

              {view === 'empty' && (
                <div className="py-4 text-center">
                  <Search className="mx-auto text-chicken-brown/30" size={42} />
                  <h2 className="mt-3 text-lg font-black text-chicken-brown">目前沒有綁定的訂位</h2>
                  <p className="mt-2 text-sm leading-6 text-chicken-brown/60">
                    訂位完成後在成功頁綁定 LINE 通知，之後就能在這裡直接查詢。
                  </p>
                  <FallbackActions />
                </div>
              )}

              {view === 'fallback' && (
                <div className="py-4 text-center">
                  <MessageCircle className="mx-auto text-[#06C755]" size={42} />
                  <h2 className="mt-3 text-lg font-black text-chicken-brown">LINE 查詢暫時無法使用</h2>
                  <p className="mt-2 text-sm leading-6 text-chicken-brown/60">
                    別擔心，用訂位時留的電話一樣查得到。
                  </p>
                  <FallbackActions />
                </div>
              )}

              {view === 'error' && (
                <div className="py-4 text-center">
                  <TriangleAlert className="mx-auto text-chicken-red" size={42} />
                  <h2 className="mt-3 text-lg font-black text-chicken-brown">查詢失敗</h2>
                  <p className="mt-2 text-sm leading-6 text-chicken-brown/60">{message}</p>
                  <FallbackActions />
                </div>
              )}
            </div>
          </Card>

          {/* 到店快捷（資料來自端點回傳 store，不依賴本機設定） */}
          {view === 'list' && (store.storeMapUrl || store.storePhone) && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {store.storeMapUrl && (
                <a href={store.storeMapUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center shadow-sm transition hover:border-chicken-red/30">
                  <MapPin className="mx-auto text-chicken-red" size={20} />
                  <div className="mt-1 text-xs font-black text-chicken-brown">導航到店</div>
                </a>
              )}
              {store.storePhone && (
                <a href={`tel:${store.storePhone}`} className="rounded-2xl border border-chicken-brown/10 bg-white px-3 py-3 text-center shadow-sm transition hover:border-chicken-red/30">
                  <Phone className="mx-auto text-chicken-red" size={20} />
                  <div className="mt-1 text-xs font-black text-chicken-brown">撥電話</div>
                </a>
              )}
            </div>
          )}

          {view === 'list' && (
            <div className="mt-4 rounded-2xl border border-chicken-brown/10 bg-white/75 p-4 text-xs font-bold leading-5 text-chicken-brown/55">
              找不到想查的訂位？可能尚未綁定 LINE——改用 <Link to="/lookup" className="text-chicken-red underline">電話查詢</Link>。
            </div>
          )}
        </motion.div>
      </main>
    </div>
  )
}

function BookingItem({ item }) {
  const status = STATUS_MAP[item.status] || { label: item.status, color: 'brown' }
  const dimmed = item.past || ['cancelled', 'completed', 'noshow'].includes(item.status)
  return (
    <div className={`rounded-2xl border p-4 ${dimmed ? 'border-chicken-brown/10 bg-chicken-brown/5 opacity-75' : 'border-[#06C755]/25 bg-white shadow-sm'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-chicken-brown">
            {item.dateLabel} <span className="text-chicken-red">{item.timeSlot}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-chicken-brown/60">{item.guests} 位 · #{item.id}</div>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
      </div>
      {item.status === 'confirmed' && !item.past && item.manageToken && (
        <Link
          to={`/manage/${item.id}?token=${encodeURIComponent(item.manageToken)}`}
          className="btn-yellow mt-3 block w-full text-center"
        >
          管理 / 修改訂位
        </Link>
      )}
    </div>
  )
}

function FallbackActions() {
  return (
    <div className="mt-5 grid gap-2">
      <Link to="/lookup" className="btn-primary text-center">用電話查詢訂位</Link>
      <Link to="/book" className="btn-secondary text-center">立即訂位</Link>
    </div>
  )
}

function hasRecentLoginAttempt() {
  try {
    const at = Number(sessionStorage.getItem(LINE_MYBOOKINGS_LOGIN_KEY) || 0)
    return at > 0 && Date.now() - at < LOGIN_RETRY_WINDOW_MS
  } catch {
    return false
  }
}

function rememberLoginAttempt() {
  try { sessionStorage.setItem(LINE_MYBOOKINGS_LOGIN_KEY, String(Date.now())) } catch {}
}

function clearLoginAttempt() {
  try { sessionStorage.removeItem(LINE_MYBOOKINGS_LOGIN_KEY) } catch {}
}
