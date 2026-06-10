import { useState, useEffect, useRef, useMemo } from 'react'
import Header from '../components/layout/Header'
import SidebarNav from '../components/layout/SidebarNav'
import BottomNav from '../components/layout/BottomNav'
import OperationsView from '../components/admin/OperationsView'
import PlanningView from '../components/admin/planning/PlanningView'
import BookingsView from '../components/admin/BookingsView'
import CustomersView from '../components/admin/CustomersView'
import GroupDirectoryView from '../components/admin/group/GroupDirectoryView'
import SettingsView from '../components/admin/SettingsView'
import { useAuth } from '../contexts/AuthContext'
import { useBooking } from '../contexts/BookingContext'
import { useToast } from '../components/ui/Toast'
import { todayStr } from '../utils/timeSlots'

const TABS = [
  { key: 'ops',       label: '現場',  icon: '🪑', subtitle: '即時桌況 · 候位 · 今日團體', badgeKey: 'ops' },
  { key: 'planning',  label: '規劃',  icon: '🗺️', subtitle: '月曆 · 當日總覽 · 排位地圖 · 團體預排' },
  { key: 'bookings',  label: '訂位',  icon: '📋', subtitle: '散客 · 今日 · 日曆 · 新增',   badgeKey: 'bookings' },
  { key: 'customers', label: '顧客',  icon: '👥', subtitle: '顧客檔 · VIP · 黑名單' },
  { key: 'group',     label: '團體',  icon: '🚌', subtitle: '旅行社名冊 · 歷史' },
  { key: 'settings',  label: '設定',  icon: '⚙️', subtitle: '營業時段 · 桌位 · 帳號' },
]

export default function AdminPage() {
  const [tab, setTab] = useState('bookings')
  // pendingAssign：訂位列表「指派桌」按鈕觸發；OperationsView 接收後進入指派模式
  // （候位入座已是現場頁內互動，無需跨頁機制）
  const [pendingAssign, setPendingAssign] = useState(null)
  const { user, usingFirebase } = useAuth()
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
        const isToday = b.date === today
        // 今日 = 顯眼且停留久；未來日 = 較不緊迫（標註「未來日」、縮短停留）
        if (isToday) {
          toast.info(`📋 新訂位：${b.name} ${b.guests} 位 · ${b.timeSlot}`, { duration: 6000 })
        } else {
          toast.info(`🗓 未來日新訂位：${b.name} ${b.guests} 位 · ${b.date} ${b.timeSlot}`, { duration: 3500 })
        }
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
      // 現場待辦 = 即將到達還沒排 + 候位中（明細由現場頁右側欄各籤 badge 拆解）
      ops: upcomingUnassigned + waiting,
    }
  }, [bookings, waitlist])

  const tabInfo = TABS.find(t => t.key === tab) || TABS[0]

  // 從 BookingsView 觸發「指派桌」→ 切換到現場頁 + 帶上待指派訂位
  const handleAssignTable = (booking) => {
    setPendingAssign(booking)
    setTab('ops')
  }
  const handleAssignDone = () => setPendingAssign(null)

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
          {!usingFirebase && (
            <div className="mb-4 rounded-xl border-2 border-chicken-red bg-red-50 px-4 py-3">
              <p className="text-sm font-black text-chicken-red">⚠️ 雲端同步未啟用</p>
              <p className="text-xs text-chicken-red/80 mt-1 leading-5">
                未偵測到 Firebase 設定（VITE_FIREBASE_*），系統以本機開發模式運行：資料只存在這台裝置、
                <b>不會上傳雲端、也不會與其他裝置同步</b>。若這是正式上線環境，請設定環境變數後重新部署。
              </p>
            </div>
          )}
          {/* 分頁切換不用 AnimatePresence mode="wait"（v11 exit 回呼遺失 bug，詳見 BookingPage） */}
          <div key={tab} className="animate-soft-enter">
              {tab === 'ops' && (
                <OperationsView
                  pendingAssign={pendingAssign}
                  onAssignDone={handleAssignDone}
                />
              )}
              {tab === 'planning' && <PlanningView onGoToday={() => setTab('ops')} />}
              {tab === 'bookings' && (
                <BookingsView onAssignTable={handleAssignTable} />
              )}
              {tab === 'customers' && <CustomersView />}
              {tab === 'group' && <GroupDirectoryView />}
              {tab === 'settings' && <SettingsView />}
          </div>
        </main>

        {/* 手機版底部導航 */}
        <BottomNav tabs={TABS} active={tab} onChange={setTab} badges={badges} />
      </div>
    </div>
  )
}
