import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Header from '../components/layout/Header'
import SidebarNav from '../components/layout/SidebarNav'
import BottomNav from '../components/layout/BottomNav'
import OperationsView from '../components/admin/OperationsView'
import BookingsView from '../components/admin/BookingsView'
import WaitlistView from '../components/admin/WaitlistView'
import CustomersView from '../components/admin/CustomersView'
import SettingsView from '../components/admin/SettingsView'
import { useAuth } from '../contexts/AuthContext'
import { useBooking } from '../contexts/BookingContext'
import { useToast } from '../components/ui/Toast'
import { todayStr } from '../utils/timeSlots'

const TABS = [
  { key: 'ops',       label: '桌位',  icon: '🪑', subtitle: '桌位地圖 · 即將到達 · 候位', badgeKey: 'ops' },
  { key: 'bookings',  label: '訂位',  icon: '📋', subtitle: '今日 · 日曆 · 新增',          badgeKey: 'bookings' },
  { key: 'waitlist',  label: '候位',  icon: '🚦', subtitle: '取號 · 叫號 · 入座',          badgeKey: 'waitlist' },
  { key: 'customers', label: '顧客',  icon: '👥', subtitle: '顧客檔 · VIP · 黑名單' },
  { key: 'settings',  label: '設定',  icon: '⚙️', subtitle: '營業時段 · 桌位 · 帳號' },
]

export default function AdminPage() {
  const [tab, setTab] = useState('bookings')
  // pendingAssign：訂位列表「指派桌」按鈕觸發；OperationsView 接收後進入指派模式
  const [pendingAssign, setPendingAssign] = useState(null)
  // pendingSeatWait：候位列表「入座」按鈕觸發；OperationsView 進入候位入座模式
  const [pendingSeatWait, setPendingSeatWait] = useState(null)
  const { user } = useAuth()
  const { bookings, waitlist } = useBooking()
  const toast = useToast()

  // === 新訂位偵測（推 toast）===
  const prevIdsRef = useRef(null)
  useEffect(() => {
    // 偵測「任何日期」的新確認訂位（先前只看當天，會漏掉客人預訂未來日期的位）
    const today = todayStr()
    const confirmed = bookings.filter(b => b.status === 'confirmed')
    const ids = new Set(confirmed.map(b => b.id))
    if (prevIdsRef.current !== null) {
      const added = confirmed.filter(b => !prevIdsRef.current.has(b.id))
      added.forEach(b => {
        const dateHint = b.date === today ? '' : `${b.date} · `
        toast.info(`📋 新訂位：${b.name} ${b.guests} 位 · ${dateHint}${b.timeSlot}`, { duration: 6000 })
      })
    }
    prevIdsRef.current = ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings])

  // === 計算 badge ===
  const badges = useMemo(() => {
    const today = todayStr()
    const todayBookings = bookings.filter(b => b.date === today && b.status !== 'cancelled')
    // 未指派的 confirmed 訂位
    const unassigned = todayBookings.filter(b => b.status === 'confirmed' && !b.assignedTableId).length
    // 即將到達（30 分內）且未指派的
    const upcomingUnassigned = todayBookings.filter(b => {
      if (b.status !== 'confirmed' || b.assignedTableId) return false
      if (!b.timeSlot) return false
      const [hh, mm] = b.timeSlot.split(':').map(Number)
      const slot = new Date()
      slot.setHours(hh, mm, 0, 0)
      const diffMin = (slot - Date.now()) / 60000
      return diffMin >= -10 && diffMin <= 30
    }).length
    // 候位中
    const waiting = waitlist.filter(w => w.status === 'waiting' || w.status === 'called').length
    return {
      bookings: unassigned,
      ops: upcomingUnassigned,  // 緊急的（即將到達還沒排）
      waitlist: waiting,
    }
  }, [bookings, waitlist])

  const tabInfo = TABS.find(t => t.key === tab) || TABS[0]

  // 從 BookingsView 觸發「指派桌」→ 切換到現場頁 + 帶上待指派訂位
  const handleAssignTable = (booking) => {
    setPendingAssign(booking)
    setTab('ops')
  }
  const handleAssignDone = () => setPendingAssign(null)

  // 候位列表點「入座」→ 切到現場頁進入入座模式
  const handleSeatWaitlist = (wait) => {
    setPendingSeatWait(wait)
    setTab('ops')
  }
  const handleSeatWaitDone = () => setPendingSeatWait(null)

  return (
    <div className="min-h-screen bg-chicken-cream flex">
      {/* 桌面版側邊導航 */}
      <SidebarNav tabs={TABS} active={tab} onChange={setTab} badges={badges} />

      {/* 主區 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 手機版頂部 Header */}
        <div className="lg:hidden">
          <Header
            title="雞王管理後台"
            subtitle={tabInfo.label}
            right={
              <div className="text-right text-xs opacity-90">
                <div className="font-bold">{user?.displayName}</div>
                <div className="opacity-80">{user?.roleLabel}</div>
              </div>
            }
          />
        </div>

        {/* 桌面版頁面標題（不重複 Header bar） */}
        <div className="hidden lg:block bg-white border-b border-chicken-brown/10 px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-black text-chicken-brown">{tabInfo.label}</h1>
              <p className="text-xs text-chicken-brown/60 mt-0.5">{tabInfo.subtitle}</p>
            </div>
            <div className="text-right text-xs">
              <div className="font-bold text-chicken-brown">{user?.displayName}</div>
              <div className="text-chicken-brown/60">{user?.roleLabel}</div>
            </div>
          </div>
        </div>

        <main className="flex-1 px-3 sm:px-6 py-4 pb-32 lg:pb-6 overflow-x-hidden max-w-[1600px] w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {tab === 'ops' && (
                <OperationsView
                  pendingAssign={pendingAssign}
                  onAssignDone={handleAssignDone}
                  pendingSeatWait={pendingSeatWait}
                  onSeatWaitDone={handleSeatWaitDone}
                />
              )}
              {tab === 'bookings' && (
                <BookingsView onAssignTable={handleAssignTable} />
              )}
              {tab === 'waitlist' && (
                <WaitlistView onSeatWaitlist={handleSeatWaitlist} />
              )}
              {tab === 'customers' && <CustomersView />}
              {tab === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* 手機版底部導航 */}
        <BottomNav tabs={TABS} active={tab} onChange={setTab} badges={badges} />
      </div>
    </div>
  )
}
