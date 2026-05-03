import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Header from '../components/layout/Header'
import BottomNav from '../components/layout/BottomNav'
import TodayView from '../components/admin/TodayView'
import CalendarView from '../components/admin/CalendarView'
import TableGrid from '../components/admin/TableGrid'
import AddBookingView from '../components/admin/AddBookingView'
import SettingsView from '../components/admin/SettingsView'
import { useAuth } from '../contexts/AuthContext'

const TAB_TITLES = {
  today: '今日訂位',
  calendar: '訂位日曆',
  tables: '座位管理',
  add: '新增訂位',
  settings: '系統設定'
}

export default function AdminPage() {
  const [tab, setTab] = useState('today')
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-chicken-cream pb-24">
      <Header
        title="雞王管理後台"
        subtitle={TAB_TITLES[tab]}
        right={
          <div className="text-right text-xs opacity-90">
            <div className="font-bold">{user?.displayName || user?.email}</div>
          </div>
        }
      />

      <main className="max-w-3xl mx-auto px-4 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            {tab === 'today' && <TodayView />}
            {tab === 'calendar' && <CalendarView />}
            {tab === 'tables' && <TableGrid />}
            {tab === 'add' && <AddBookingView onCreated={() => setTab('today')} />}
            {tab === 'settings' && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}
