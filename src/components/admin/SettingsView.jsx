import { useState } from 'react'
import { Card, Input, Button, Select, Modal } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { searchNoshow, exportCSV } from '../../services/bookingService'
import TableGrid from './TableGrid'
import LayoutEditor from './LayoutEditor'
import TelegramSettings from './TelegramSettings'

export default function SettingsView() {
  const { settings, updateSettings } = useBooking()
  const { user, signOut, can } = useAuth()
  const [form, setForm] = useState(settings)
  const [savedMsg, setSavedMsg] = useState('')
  const [searchPhone, setSearchPhone] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [showDanger, setShowDanger] = useState(false)
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)

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
  const handleResetAll = () => {
    ['chicken_bookings_v1', 'chicken_tables_v2', 'chicken_waitlist_v1', 'chicken_customers_v1', 'chicken_noshow_v1']
      .forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }

  return (
    <div className="space-y-4">
      <SettingsSection title="營業時段" description="控制客人可選日期、時段與營業起訖時間。" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="開始時間" type="time" value={form.openTime} onChange={e => setForm(f => ({ ...f, openTime: e.target.value }))} />
            <Input label="結束時間" type="time" value={form.closeTime} onChange={e => setForm(f => ({ ...f, closeTime: e.target.value }))} />
          </div>
          <Select
            label="時段間隔"
            value={form.slotInterval}
            onChange={e => setForm(f => ({ ...f, slotInterval: Number(e.target.value) }))}
            options={[{ value: 15, label: '15 分鐘' }, { value: 30, label: '30 分鐘' }, { value: 60, label: '60 分鐘' }]}
          />
          <Select
            label="可預訂天數"
            value={form.maxDaysAhead}
            onChange={e => setForm(f => ({ ...f, maxDaysAhead: Number(e.target.value) }))}
            options={[{ value: 7, label: '7 天' }, { value: 14, label: '14 天' }, { value: 30, label: '30 天' }, { value: 60, label: '60 天' }]}
          />
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1">儲存設定</Button>
            {savedMsg && <span className="text-sm text-chicken-green font-bold">{savedMsg}</span>}
          </div>
        </div>
      </SettingsSection>

      {/* Telegram 通知 + 備份 */}
      <SettingsSection title="通知與備份" description="Telegram 事件推送與備份狀態。">
        <TelegramSettings embedded />
      </SettingsSection>

      {/* 桌位佈局編輯（拖拉位置、新增/刪除桌、改容量）*/}
      {can('table.config') && (
        <SettingsSection title="桌位佈局" description="拖拉桌位、調整容量與燃料型態。">
          <p className="text-xs text-chicken-brown/60 mb-3">
            打開全螢幕編輯器：拖拉移動桌位、調整容量與瓦斯型態、新增或刪除桌位。
            修改完按「儲存變更」才會生效。
          </p>
          <Button onClick={() => setShowLayoutEditor(true)} className="w-full">
            開啟桌位佈局編輯器
          </Button>
        </SettingsSection>
      )}

      {/* 桌位啟用/停用 — 簡單方格切換 */}
      {can('table.config') && (
        <SettingsSection title="桌位啟用" description="停用桌位不會出現在現場營運頁，也不計入可訂位人數。">
          <p className="text-xs text-chicken-brown/60 mb-3">點擊桌號可切換啟用 / 停用。停用的桌位不會出現在現場營運頁，也不計入可訂位人數。</p>
          <TableGrid />
        </SettingsSection>
      )}

      <SettingsSection title="No-show 查詢" description="用電話快速查詢過往未到紀錄。">
        <div className="flex gap-2">
          <Input placeholder="輸入電話號碼" value={searchPhone} onChange={e => setSearchPhone(e.target.value)} inputMode="numeric" />
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
                    <div className="text-xs text-chicken-brown/60 mt-1">{r.dates.map(d => d.date).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="資料匯出" description="下載目前瀏覽器 LocalStorage 內的訂位資料。">
        <Button onClick={handleExport} variant="secondary" className="w-full">匯出全部訂位 CSV</Button>
      </SettingsSection>

      <SettingsSection title="帳號" description="目前登入者與角色資訊。">
        <div className="text-sm text-chicken-brown/70 mb-3">
          <div>已登入：<span className="font-mono font-bold text-chicken-brown">{user?.email}</span></div>
          <div className="text-xs text-chicken-brown/60 mt-1">角色：<span className="font-bold">{user?.roleLabel || '—'}</span></div>
        </div>
        <Button onClick={() => { if (confirm('確定登出？')) signOut() }} variant="secondary" className="w-full">登出</Button>
      </SettingsSection>

      {can('settings.update') && (
        <SettingsSection title="危險操作" description="會清除資料，僅店長需要時使用。" danger>
          <p className="text-xs text-chicken-brown/60 mb-3">清除所有訂位、桌位狀態、候位、顧客資料（不可復原）</p>
          <button onClick={() => setShowDanger(true)} className="btn-danger w-full">重設所有資料</button>
          <Modal open={showDanger} onClose={() => setShowDanger(false)} title="確認重設？" footer={
            <>
              <button onClick={() => setShowDanger(false)} className="btn-secondary px-4 py-2">取消</button>
              <button onClick={handleResetAll} className="btn-primary px-4 py-2 !bg-chicken-red">確認重設</button>
            </>
          }>
            <p className="text-sm text-chicken-brown">所有訂位、候位、桌位狀態、顧客資料將被清除，桌位佈局還原為預設。<br/>此動作無法復原。</p>
          </Modal>
        </SettingsSection>
      )}

      <p className="text-center text-xs text-chicken-brown/40 pt-4">
        雞王刷刷鍋訂位系統 v0.3 · LocalStorage 模式
      </p>

      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />
    </div>
  )
}

function SettingsSection({ title, description, children, defaultOpen = false, danger = false }) {
  return (
    <details className={`card group ${danger ? 'border-red-200 !border-2 bg-red-50/30' : ''}`} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div>
          <h2 className={`font-black ${danger ? 'text-red-700' : 'text-chicken-brown'}`}>{title}</h2>
          {description && <p className="mt-0.5 text-xs text-chicken-brown/55">{description}</p>}
        </div>
        <span className="rounded-full bg-chicken-brown/5 px-2 py-1 text-xs font-black text-chicken-brown/45 group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-4">
        {children}
      </div>
    </details>
  )
}
