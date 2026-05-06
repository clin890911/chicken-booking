import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TodayView from './TodayView'
import CalendarView from './CalendarView'
import AddBookingView from './AddBookingView'

const SUB_TABS = [
  { key: 'today', label: '今日', icon: '📋' },
  { key: 'calendar', label: '日曆', icon: '📅' },
  { key: 'add', label: '新增', icon: '➕' },
]

// 訂位總頁：合併 今日 / 日曆 / 新增 為 sub-tabs
// 「指派桌」按鈕呼叫 onAssignTable，由父元件負責切到 OperationsView
export default function BookingsView({ onAssignTable, onCreated }) {
  const [sub, setSub] = useState('today')

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 bg-white p-1 rounded-xl border border-chicken-brown/10 max-w-fit">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${
              sub === t.key
                ? 'bg-chicken-red text-white'
                : 'text-chicken-brown/60 hover:text-chicken-brown'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={sub}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {sub === 'today' && <TodayView onAssignTable={onAssignTable} />}
          {sub === 'calendar' && <CalendarView onAssignTable={onAssignTable} />}
          {sub === 'add' && <AddBookingView onCreated={(b) => { setSub('today'); onCreated?.(b) }} onAssignTable={onAssignTable} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
