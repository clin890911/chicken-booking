import { useState } from 'react'
import { Card, Input, Button, Select } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { searchNoshow, exportCSV } from '../../services/bookingService'

export default function SettingsView() {
  const { settings, updateSettings } = useBooking()
  const { user, signOut } = useAuth()
  const [form, setForm] = useState(settings)
  const [savedMsg, setSavedMsg] = useState('')
  const [searchPhone, setSearchPhone] = useState('')
  const [searchResult, setSearchResult] = useState(null)

  const handleSave = () => {
    updateSettings(form)
    setSavedMsg('✅ 已儲存')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  const handleSearch = () => {
    setSearchResult(searchNoshow(searchPhone.trim()))
  }

  const handleExport = () => {
    const csv = exportCSV()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chicken-booking-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">🕐 營業時段設定</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="開始時間"
              type="time"
              value={form.openTime}
              onChange={e => setForm(f => ({ ...f, openTime: e.target.value }))}
            />
            <Input
              label="結束時間"
              type="time"
              value={form.closeTime}
              onChange={e => setForm(f => ({ ...f, closeTime: e.target.value }))}
            />
          </div>
          <Select
            label="時段間隔"
            value={form.slotInterval}
            onChange={e => setForm(f => ({ ...f, slotInterval: Number(e.target.value) }))}
            options={[
              { value: 15, label: '15 分鐘' },
              { value: 30, label: '30 分鐘' },
              { value: 60, label: '60 分鐘' }
            ]}
          />
          <Select
            label="可預訂天數"
            value={form.maxDaysAhead}
            onChange={e => setForm(f => ({ ...f, maxDaysAhead: Number(e.target.value) }))}
            options={[
              { value: 7, label: '7 天' },
              { value: 14, label: '14 天' },
              { value: 30, label: '30 天' },
              { value: 60, label: '60 天' }
            ]}
          />
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1">💾 儲存設定</Button>
            {savedMsg && <span className="text-sm text-chicken-green font-bold">{savedMsg}</span>}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">⚠️ No-show 查詢</h2>
        <div className="flex gap-2">
          <Input
            placeholder="輸入電話號碼"
            value={searchPhone}
            onChange={e => setSearchPhone(e.target.value)}
            inputMode="numeric"
          />
          <Button onClick={handleSearch} variant="secondary" className="whitespace-nowrap">查詢</Button>
        </div>
        {searchResult !== null && (
          <div className="mt-3">
            {searchResult.length === 0 ? (
              <p className="text-sm text-chicken-brown/60">查無 no-show 記錄</p>
            ) : (
              <div className="space-y-2">
                {searchResult.map(r => (
                  <div key={r.phone} className="bg-chicken-red/5 border border-chicken-red/20 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-chicken-brown">{r.phone}</span>
                      <span className="badge bg-chicken-red text-white">⚠️ {r.count} 次</span>
                    </div>
                    <div className="text-xs text-chicken-brown/60 mt-1">
                      {r.dates.map(d => d.date).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">📊 資料匯出</h2>
        <Button onClick={handleExport} variant="secondary" className="w-full">⬇️ 匯出全部訂位 CSV</Button>
      </Card>

      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">👤 帳號</h2>
        <div className="text-sm text-chicken-brown/70 mb-3">
          已登入：<span className="font-mono font-bold text-chicken-brown">{user?.email}</span>
        </div>
        <Button onClick={() => { if (confirm('確定登出？')) signOut() }} variant="secondary" className="w-full">🚪 登出</Button>
      </Card>

      <p className="text-center text-xs text-chicken-brown/40 pt-4">
        雞王刷刷鍋訂位系統 v0.1 · localStorage 模式
      </p>
    </div>
  )
}
