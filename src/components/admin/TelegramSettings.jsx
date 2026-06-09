import { useState, useEffect } from 'react'
import { Card, Input, Button } from '../ui'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import * as tg from '../../services/telegramService'

// Telegram 通知 + 備份設定
export default function TelegramSettings({ embedded = false }) {
  const toast = useToast()
  const { bookings, waitlist } = useBooking()
  const [chatId, setChatIdLocal] = useState(tg.getChatId())
  const [enabled, setEnabledLocal] = useState(tg.isEnabled())
  const [busy, setBusy] = useState(false)
  const [, force] = useState(0)

  const reload = () => force(n => n + 1)
  const hasToken = tg.hasToken()
  const configured = tg.isConfigured()

  // 最後通知時間（若有資料才顯示）；由通知送出時寫入的 localStorage 取出
  const lastSentLabel = (() => {
    const raw = localStorage.getItem('chicken_telegram_last_sent')
    if (!raw) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toLocaleString('zh-TW')
  })()

  const handleSaveChatId = () => {
    const id = chatId.trim()
    if (!id) return toast.error('請輸入 chat_id 或按自動偵測')
    tg.setChatId(id)
    toast.success('已儲存 chat_id')
    reload()
  }

  const handleDetect = async () => {
    setBusy(true)
    try {
      const r = await tg.detectChatId()
      if (r.ok) {
        setChatIdLocal(String(r.chatId))
        toast.success(`已偵測到 chat_id：${r.chatId}（${r.name}）`)
        reload()
      } else if (r.reason === 'no-messages') {
        toast.error('Bot 還沒收到任何訊息。請先到 t.me/materofchichenbooking_bot 按 Start，再試一次')
      } else if (r.reason === 'no-token') {
        toast.error('未設定 VITE_TELEGRAM_BOT_TOKEN（請看 .env.example）')
      } else {
        toast.error('偵測失敗：' + (r.error || r.reason))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      const r = await tg.sendTest()
      if (r.ok) toast.success('✅ 測試訊息已送達 Telegram')
      else toast.error('送出失敗：' + (r.description || r.reason || r.error || '未知'))
    } finally {
      setBusy(false)
    }
  }

  const applyEnabled = (on) => {
    tg.setEnabled(on)
    setEnabledLocal(on)
    reload()
  }

  const handleToggle = (on) => {
    const prev = !on
    applyEnabled(on)
    // 可復原：尤其關閉時，避免誤關後新事件靜默不推送
    toast.action(
      on ? '✅ 通知已開啟' : '🔕 通知已關閉，新事件不會推送',
      { label: '↩ 復原', onClick: () => applyEnabled(prev) },
      { type: on ? 'success' : 'warning' },
    )
  }

  const handleClear = () => {
    tg.setChatId('')
    setChatIdLocal('')
    toast.info('已清除 chat_id')
    reload()
  }

  // 每日彙總（手動觸發）
  const handleSendDigest = async () => {
    setBusy(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const todayBookings = bookings.filter(b => b.date === today)
      const stats = {
        total: todayBookings.filter(b => b.status !== 'cancelled').length,
        totalGuests: todayBookings.filter(b => b.status !== 'cancelled').reduce((s, b) => s + (b.guests || 0), 0),
        arrived: todayBookings.filter(b => b.status === 'arrived').length,
        completed: todayBookings.filter(b => b.status === 'completed').length,
        noshow: todayBookings.filter(b => b.status === 'noshow').length,
        cancelled: todayBookings.filter(b => b.status === 'cancelled').length,
        waitlist: waitlist.filter(w => w.status === 'seated' || w.status === 'left').length,
      }
      const r = await tg.notifyDailySummary(stats)
      if (r.ok) toast.success('每日彙總已送出')
      else toast.error('送出失敗：' + (r.description || r.reason))
    } finally {
      setBusy(false)
    }
  }

  const content = (
    <>
      {!embedded && (
        <>
          <h2 className="font-bold text-chicken-brown mb-1">Telegram 通知 + 備份</h2>
          <p className="text-xs text-chicken-brown/60 mb-3">
            所有訂位/候位事件即時推送到 Telegram chat，含完整 JSON 作為備份。
            資料丟失時可從 chat 還原。
          </p>
        </>
      )}

      {!hasToken && (
        <div className="mb-3 px-3 py-2 bg-chicken-red/10 border border-chicken-red/20 rounded-lg text-xs text-chicken-red">
          ⚠️ 未設定 <code>VITE_TELEGRAM_BOT_TOKEN</code> 環境變數。<br />
          請在 <code>.env.local</code> 加入 token，重啟 dev server。
        </div>
      )}

      {hasToken && (
        <>
          <div className="space-y-3">
            {/* Chat ID */}
            <div>
              <label className="text-xs font-bold text-chicken-brown/70 block mb-1.5">Chat ID</label>
              <div className="flex gap-2">
                <Input
                  value={chatId}
                  onChange={e => setChatIdLocal(e.target.value)}
                  placeholder="例：123456789（個人 chat 或 -100xxxx 群組）"
                  className="flex-1"
                />
                <Button onClick={handleSaveChatId} variant="secondary" className="whitespace-nowrap">儲存</Button>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleDetect}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 bg-chicken-yellow text-white rounded-lg font-bold disabled:opacity-50"
                >🔍 自動偵測</button>
                {tg.getChatId() && (
                  <button
                    onClick={handleClear}
                    className="text-xs px-3 py-1.5 bg-white border border-chicken-brown/15 rounded-lg text-chicken-brown/60"
                  >清除</button>
                )}
              </div>
              <p className="text-[11px] text-chicken-brown/50 mt-2 leading-snug">
                💡 自動偵測前請先到 <a href="https://t.me/materofchichenbooking_bot" target="_blank" rel="noopener" className="underline text-chicken-red">t.me/materofchichenbooking_bot</a> 按 <b>Start</b>。
                若想推到群組，把 bot 加進群再讓 bot 收到一條訊息。
              </p>
            </div>

            {/* 啟用開關 */}
            <label className="flex items-center justify-between p-3 bg-chicken-cream rounded-xl cursor-pointer">
              <div>
                <div className="text-sm font-bold text-chicken-brown">啟用通知</div>
                <div className="text-[11px] text-chicken-brown/60 mt-0.5">關閉後新事件不會推送（已存的歷史不影響）</div>
              </div>
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => handleToggle(e.target.checked)}
                disabled={!configured}
                className="w-5 h-5"
              />
            </label>

            {/* 測試 + 彙總 */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={handleTest}
                disabled={!configured || busy}
                variant="secondary"
                className="min-h-[44px]"
              >
                📤 送出測試訊息
              </Button>
              <Button
                onClick={handleSendDigest}
                disabled={!configured || busy}
                variant="secondary"
                className="min-h-[44px]"
              >
                📊 立即送每日彙總
              </Button>
            </div>

            {/* 狀態 */}
            <div className="px-3 py-2 bg-chicken-brown/5 rounded-lg text-xs text-chicken-brown/70 leading-relaxed">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${configured && enabled ? 'bg-chicken-green' : 'bg-chicken-brown/30'}`}></span>
                <b>{configured && enabled ? '已連接、通知已啟用' : configured ? '已連接、通知已停用' : '未連接'}</b>
              </div>
              <div className="text-[11px] text-chicken-brown/50 mt-1">
                Token：{hasToken ? '✓ 已設' : '✗ 未設'} · ChatID：{tg.getChatId() || '✗ 未設'}
              </div>
              {lastSentLabel && (
                <div className="text-[11px] text-chicken-brown/50 mt-0.5">
                  最後通知時間：{lastSentLabel}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )

  return embedded ? content : <Card>{content}</Card>
}
