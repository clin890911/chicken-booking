import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, CalendarDays, ChevronLeft, Clock, Hash, Phone, Search, UserRound, Users } from 'lucide-react'
import { Button, Input, Badge } from '../components/ui'
import { dayLabel } from '../utils/timeSlots'
import { normalizeBookingId } from '../utils/bookingId'
import { guestLookupBooking } from '../services/cloudDataService'

const STATUS_LABEL = {
  confirmed: '已確認',
  arrived: '已入座',
  completed: '已完成',
  cancelled: '已取消',
  noshow: '未到',
}

export default function LookupBookingPage() {
  const [mode, setMode] = useState('identity')
  const [surname, setSurname] = useState('')
  const [phone, setPhone] = useState('')
  const [bookingId, setBookingId] = useState('')
  const [phoneTail, setPhoneTail] = useState('')
  const [items, setItems] = useState([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    // 前端先擋（與後端同口徑）：code 模式需訂位編號 + 電話末 4 碼，避免無謂的往返與 400。
    if (mode === 'code' && (!bookingId.trim() || phoneTail.trim().length < 4)) {
      setError('請輸入訂位編號與電話末 4 碼')
      return
    }
    setBusy(true)
    setError('')
    setSearched(false)
    try {
      const payload = mode === 'identity'
        ? { mode, surname: surname.trim(), phone: phone.trim() }
        : { mode, bookingId: normalizeBookingId(bookingId), phoneTail: phoneTail.trim() }
      const result = await guestLookupBooking(payload)
      setItems(result.items || [])
      setSearched(true)
    } catch (err) {
      setItems([])
      setSearched(true)
      setError(err.message || '查詢失敗，請稍後再試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-red/5 via-chicken-cream to-white pb-12">
      <header className="sticky top-0 z-30 border-b border-chicken-brown/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex h-10 w-10 items-center justify-center rounded-full bg-chicken-brown/5 text-chicken-brown">
            <ChevronLeft size={22} />
          </Link>
          <div>
            <div className="text-base font-black text-chicken-brown">查詢 / 修改訂位</div>
            <div className="text-xs font-bold text-chicken-brown/55">輸入訂位資料，找回管理入口</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="surface overflow-hidden">
          <div className="bg-chicken-red px-5 py-5 text-white">
            <div className="text-xs font-bold opacity-85">雞王涮涮鍋</div>
            <h1 className="mt-1 text-2xl font-black">找回我的訂位</h1>
            <p className="mt-2 text-sm font-bold leading-6 opacity-85">
              可用訂位姓氏與電話，或訂位編號與電話末 4 碼查詢。查到後仍需電話驗證才能修改。
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-chicken-brown/5 p-1">
              <button
                type="button"
                onClick={() => { setMode('identity'); setItems([]); setError(''); setSearched(false) }}
                className={`rounded-xl px-3 py-2 text-sm font-black transition ${mode === 'identity' ? 'bg-white text-chicken-red shadow-sm' : 'text-chicken-brown/55'}`}
              >
                姓氏 + 電話
              </button>
              <button
                type="button"
                onClick={() => { setMode('code'); setItems([]); setError(''); setSearched(false) }}
                className={`rounded-xl px-3 py-2 text-sm font-black transition ${mode === 'code' ? 'bg-white text-chicken-red shadow-sm' : 'text-chicken-brown/55'}`}
              >
                訂位編號
              </button>
            </div>

            {mode === 'identity' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="訂位姓氏" value={surname} onChange={e => setSurname(e.target.value)} placeholder="例：林" />
                <Input label="完整電話" type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder="例：0912345678" />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="訂位編號" value={bookingId} onChange={e => setBookingId(e.target.value)} placeholder="例：Bmov..." />
                <Input label="電話末 4 碼" inputMode="numeric" maxLength={4} value={phoneTail} onChange={e => setPhoneTail(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="例：5678" />
              </div>
            )}

            {error && <ErrorText>{error}</ErrorText>}
            <Button type="submit" disabled={busy} className="w-full">
              <Search size={18} />
              {busy ? '查詢中...' : '查詢訂位'}
            </Button>
          </form>
        </motion.section>

        {searched && (
          <section className="mt-4 space-y-3">
            {items.length === 0 ? (
              <div className="surface p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 text-chicken-yellow" size={38} />
                <h2 className="text-xl font-black text-chicken-brown">查不到符合的訂位</h2>
                <p className="mt-2 text-sm leading-6 text-chicken-brown/60">請確認電話、姓氏或訂位編號是否正確；也可以直接來電請同仁協助。</p>
              </div>
            ) : (
              <>
                <div className="px-1 text-sm font-black text-chicken-brown">找到 {items.length} 筆訂位</div>
                {items.map(item => <LookupResultCard key={item.id} item={item} />)}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function LookupResultCard({ item }) {
  const manageUrl = `/manage/${item.id}?token=${encodeURIComponent(item.manageToken || '')}`
  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Hash size={16} className="text-chicken-red" />
            <span className="font-mono text-sm font-black text-chicken-brown">{item.id}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-chicken-brown/60">
            <span className="inline-flex items-center gap-1"><UserRound size={13} />{item.nameMasked}</span>
            <span className="inline-flex items-center gap-1"><Phone size={13} />{item.phoneMasked}</span>
          </div>
        </div>
        <Badge color={item.status === 'cancelled' ? 'gray' : 'yellow'}>{STATUS_LABEL[item.status] || item.status}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Info icon={CalendarDays} label="日期" value={dayLabel(item.date)} />
        <Info icon={Clock} label="時間" value={item.timeSlot} />
        <Info icon={Users} label="人數" value={`${item.guests} 位`} />
      </div>

      {!item.editable?.ok && (
        <div className="mt-3 rounded-xl bg-chicken-yellow/10 px-3 py-2 text-xs font-bold leading-5 text-chicken-brown/65">
          {item.editable?.reason || '此訂位目前不可線上修改'}
        </div>
      )}

      <Link to={manageUrl} className="btn-primary mt-4 block text-center">
        查看 / 管理訂位
      </Link>
    </div>
  )
}

function Info({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-chicken-brown/5 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] font-bold text-chicken-brown/55">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-1 text-sm font-black text-chicken-brown">{value}</div>
    </div>
  )
}

function ErrorText({ children }) {
  return <p className="rounded-xl bg-chicken-red/10 px-3 py-2 text-sm font-bold text-chicken-red">{children}</p>
}
