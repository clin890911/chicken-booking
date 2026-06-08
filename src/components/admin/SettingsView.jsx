import { useState } from 'react'
import { Card, Input, Button, Select, Modal } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast, useConfirm } from '../ui/Toast'
import { searchNoshow, exportCSV } from '../../services/bookingService'
import TableGrid from './TableGrid'
import LayoutEditor from './LayoutEditor'
import TelegramSettings from './TelegramSettings'

export default function SettingsView() {
  const { settings, updateSettings, cloudStatus, migrateLocalToCloud, pullCloud } = useBooking()
  const { user, signOut, can } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState(settings)
  const [savedMsg, setSavedMsg] = useState('')
  const [searchPhone, setSearchPhone] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [showDanger, setShowDanger] = useState(false)
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)

  const handleSave = () => {
    updateSettings(form)
    setSavedMsg('✅ 已儲存')
    setTimeout(() => setSavedMsg(''), 2000)
  }
  const handleBannerFiles = async (files) => {
    const list = Array.from(files || [])
    if (list.length === 0) return
    try {
      const images = await Promise.all(list.map(file => readBannerFile(file)))
      setForm(f => ({ ...f, heroBanners: [...(f.heroBanners || []), ...images] }))
    } catch (err) {
      toast.error(err.message || '圖片讀取失敗')
    }
  }
  const saveBanners = () => {
    updateSettings({ heroBanners: form.heroBanners || [] })
    setSavedMsg('✅ 首頁廣告已儲存')
    setTimeout(() => setSavedMsg(''), 2000)
  }
  const removeBanner = async (id) => {
    if (!(await confirm('確定刪除這張首頁廣告？', { title: '刪除廣告', confirmLabel: '刪除' }))) return
    setForm(f => ({ ...f, heroBanners: (f.heroBanners || []).filter(b => b.id !== id) }))
  }
  const moveBanner = (id, dir) => {
    setForm(f => {
      const next = [...(f.heroBanners || [])]
      const index = next.findIndex(b => b.id === id)
      const target = index + dir
      if (index < 0 || target < 0 || target >= next.length) return f
      const item = next[index]
      next[index] = next[target]
      next[target] = item
      return { ...f, heroBanners: next }
    })
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
    ['chicken_bookings_v1', 'chicken_tables_v3', 'chicken_tables_v2', 'chicken_waitlist_v1', 'chicken_customers_v1', 'chicken_noshow_v1']
      .forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }
  const handleCloudSync = async (type) => {
    setCloudBusy(true)
    try {
      if (type === 'push') await migrateLocalToCloud()
      else await pullCloud()
      setSavedMsg(type === 'push' ? '✅ 已上傳 Firestore' : '✅ 已從 Firestore 更新')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (err) {
      setSavedMsg(`⚠️ ${err.message || '同步失敗'}`)
    } finally {
      setCloudBusy(false)
    }
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
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="用餐時間（分鐘）"
              type="number"
              min="30"
              max="240"
              value={form.diningDurationMin || 90}
              onChange={e => setForm(f => ({ ...f, diningDurationMin: Number(e.target.value) }))}
            />
            <Input
              label="清桌緩衝（分鐘）"
              type="number"
              min="0"
              max="60"
              value={form.cleanupBufferMin || 10}
              onChange={e => setForm(f => ({ ...f, cleanupBufferMin: Number(e.target.value) }))}
            />
          </div>
          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            可訂位容量會以「用餐時間 + 清桌緩衝」計算；目前每筆訂位佔用 {(Number(form.diningDurationMin) || 90) + (Number(form.cleanupBufferMin) || 10)} 分鐘。
          </div>
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1">儲存設定</Button>
            {savedMsg && <span className="text-sm text-chicken-green font-bold">{savedMsg}</span>}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="首頁廣告輪播" description="新增橫式照片，會顯示在客人首頁第一屏。" defaultOpen>
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-chicken-brown/15 bg-white px-4 py-8 text-center transition hover:border-chicken-red/40">
            <span className="text-sm font-black text-chicken-brown">上傳橫式照片</span>
            <span className="mt-1 text-xs text-chicken-brown/55">建議 16:9 或 2:1，單張小於 2MB，支援多選</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => handleBannerFiles(e.target.files)}
            />
          </label>

          {(form.heroBanners || []).length === 0 ? (
            <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">
              尚未新增廣告圖。首頁會先顯示品牌 logo 與預設訂位宣傳。
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(form.heroBanners || []).map((banner, index) => (
                <div key={banner.id} className="overflow-hidden rounded-xl border border-chicken-brown/10 bg-white">
                  <div className="aspect-[16/9] bg-chicken-cream">
                    <img src={banner.image} alt={banner.title || `首頁廣告 ${index + 1}`} className="h-full w-full object-cover" />
                  </div>
                  <div className="space-y-2 p-3">
                    <Input
                      label="標題"
                      value={banner.title || ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        heroBanners: (f.heroBanners || []).map(b => b.id === banner.id ? { ...b, title: e.target.value } : b)
                      }))}
                      placeholder="例：母親節限定套餐"
                    />
                    <Input
                      label="副標"
                      value={banner.subtitle || ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        heroBanners: (f.heroBanners || []).map(b => b.id === banner.id ? { ...b, subtitle: e.target.value } : b)
                      }))}
                      placeholder="例：限量供應，建議提前訂位"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => moveBanner(banner.id, -1)} className="btn-secondary !px-2 !py-2 text-xs" disabled={index === 0}>上移</button>
                      <button onClick={() => moveBanner(banner.id, 1)} className="btn-secondary !px-2 !py-2 text-xs" disabled={index === (form.heroBanners || []).length - 1}>下移</button>
                      <button onClick={() => removeBanner(banner.id)} className="btn-danger !px-2 !py-2 text-xs">刪除</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={saveBanners} className="flex-1">儲存首頁廣告</Button>
            {savedMsg && <span className="text-sm font-bold text-chicken-green">{savedMsg}</span>}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="LINE 官方帳號" description="設定客人訂位成功後看到的 LINE 加好友入口與保存提醒。" defaultOpen>
        <div className="space-y-3">
          <Input
            label="顯示名稱"
            value={form.lineOfficialName || ''}
            onChange={e => setForm(f => ({ ...f, lineOfficialName: e.target.value }))}
            placeholder="雞王刷刷鍋 LINE 官方帳號"
          />
          <Input
            label="LINE 官方帳號加入連結"
            type="url"
            value={form.lineOfficialUrl || ''}
            onChange={e => setForm(f => ({ ...f, lineOfficialUrl: e.target.value.trim() }))}
            placeholder="https://lin.ee/xxxxxxx"
          />
          <label className="flex items-start gap-3 rounded-xl border border-chicken-brown/10 bg-white px-4 py-3 text-sm font-bold text-chicken-brown">
            <input
              type="checkbox"
              checked={!!form.lineUseLiff}
              onChange={e => setForm(f => ({ ...f, lineUseLiff: e.target.checked }))}
              className="mt-1"
            />
            <span>
              使用 LIFF 自動綁定
              <span className="mt-1 block text-xs font-bold leading-5 text-chicken-brown/55">
                未確認 LIFF 正式可用前請保持關閉；關閉時客人會先進網站中轉頁，不會遇到 LINE 404。
              </span>
            </span>
          </label>
          <Input
            label="LIFF 訂位綁定連結（選填）"
            type="url"
            value={form.lineLiffUrl || ''}
            onChange={e => setForm(f => ({ ...f, lineLiffUrl: e.target.value.trim() }))}
            placeholder="https://liff.line.me/xxxxxxxx"
          />
          <Input
            label="LIFF ID（選填）"
            value={form.lineLiffId || ''}
            onChange={e => setForm(f => ({ ...f, lineLiffId: e.target.value.trim() }))}
            placeholder="xxxxxxxxxx-xxxxxxxx"
          />
          <Input
            label="LINE 綁定後端端點（選填）"
            type="url"
            value={form.lineBindEndpoint || ''}
            onChange={e => setForm(f => ({ ...f, lineBindEndpoint: e.target.value.trim() }))}
            placeholder="https://.../lineBind"
          />
          <Input
            label="LINE 推播後端端點（選填）"
            type="url"
            value={form.linePushEndpoint || ''}
            onChange={e => setForm(f => ({ ...f, linePushEndpoint: e.target.value.trim() }))}
            placeholder="https://.../linePushBooking"
          />
          <Input
            label="LINE 訂位讀取端點（選填）"
            type="url"
            value={form.lineManageEndpoint || ''}
            onChange={e => setForm(f => ({ ...f, lineManageEndpoint: e.target.value.trim() }))}
            placeholder="https://.../lineGetBooking"
          />
          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            目前預設會先開啟網站中轉頁，避免未公開或設定錯誤的 LIFF 造成 404。若已確認 LIFF Channel、Endpoint URL、Scope 與官方帳號連動都正常，再勾選「使用 LIFF 自動綁定」。
            LINE API Token 仍必須放在後端或 Cloud Functions，不能放前端。
          </div>
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1">儲存 LINE 設定</Button>
            {form.lineOfficialUrl && (
              <a href={form.lineOfficialUrl} target="_blank" rel="noreferrer" className="btn-secondary whitespace-nowrap">
                測試開啟
              </a>
            )}
            {savedMsg && <span className="text-sm text-chicken-green font-bold">{savedMsg}</span>}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="客人聯絡入口" description="設定確認頁與訂位管理中心的一鍵撥電話、導航資訊。">
        <div className="space-y-3">
          <Input
            label="店名"
            value={form.storeName || ''}
            onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))}
            placeholder="雞王刷刷鍋"
          />
          <Input
            label="店家電話"
            value={form.storePhone || ''}
            onChange={e => setForm(f => ({ ...f, storePhone: e.target.value.trim() }))}
            placeholder="例：04-1234-5678"
          />
          <Input
            label="店家地址"
            value={form.storeAddress || ''}
            onChange={e => setForm(f => ({ ...f, storeAddress: e.target.value }))}
            placeholder="例：台中市..."
          />
          <Input
            label="Google Maps 導航連結"
            type="url"
            value={form.storeMapUrl || ''}
            onChange={e => setForm(f => ({ ...f, storeMapUrl: e.target.value.trim() }))}
            placeholder="https://maps.google.com/..."
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="緯度 latitude"
              value={form.storeLatitude || ''}
              onChange={e => setForm(f => ({ ...f, storeLatitude: e.target.value.trim() }))}
              placeholder="24.xxxxxx"
            />
            <Input
              label="經度 longitude"
              value={form.storeLongitude || ''}
              onChange={e => setForm(f => ({ ...f, storeLongitude: e.target.value.trim() }))}
              placeholder="120.xxxxxx"
            />
          </div>
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1">儲存聯絡入口</Button>
            {savedMsg && <span className="text-sm text-chicken-green font-bold">{savedMsg}</span>}
          </div>
        </div>
      </SettingsSection>

      {/* Telegram 通知 + 備份 */}
      <SettingsSection title="通知與備份" description="Telegram 事件推送與備份狀態。">
        <TelegramSettings embedded />
      </SettingsSection>

      <SettingsSection title="Firestore 資料同步" description="正式跨裝置資料來源；可手動上傳本機資料或重新拉取雲端資料。" defaultOpen>
        <div className="space-y-3">
          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            狀態：<span className="font-black text-chicken-brown">{cloudStatus?.state || 'idle'}</span>
            {cloudStatus?.lastSyncAt && <span> · 最近同步 {new Date(cloudStatus.lastSyncAt).toLocaleString('zh-TW')}</span>}
            {cloudStatus?.error && <div className="mt-1 font-bold text-chicken-red">錯誤：{cloudStatus.error}</div>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={cloudBusy} onClick={() => handleCloudSync('push')} className="w-full">
              {cloudBusy ? '同步中...' : '上傳本機資料到 Firestore'}
            </Button>
            <button disabled={cloudBusy} onClick={() => handleCloudSync('pull')} className="btn-secondary">
              從 Firestore 重新整理
            </button>
          </div>
          <p className="text-xs font-bold leading-5 text-chicken-brown/55">
            第一次正式上線前，請在主要後台裝置按一次「上傳本機資料到 Firestore」，之後客人查詢與其他裝置會讀取雲端資料。
          </p>
        </div>
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

      <SettingsSection title="資料匯出" description="下載目前快取內的訂位資料。">
        <Button onClick={handleExport} variant="secondary" className="w-full">匯出全部訂位 CSV</Button>
      </SettingsSection>

      <SettingsSection title="帳號" description="目前登入者與角色資訊。">
        <div className="text-sm text-chicken-brown/70 mb-3">
          <div>已登入：<span className="font-mono font-bold text-chicken-brown">{user?.email}</span></div>
          <div className="text-xs text-chicken-brown/60 mt-1">角色：<span className="font-bold">{user?.roleLabel || '—'}</span></div>
        </div>
        <Button onClick={async () => { if (await confirm('確定登出？', { title: '登出', confirmLabel: '登出' })) signOut() }} variant="secondary" className="w-full">登出</Button>
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
        雞王刷刷鍋訂位系統 v0.4 · Firestore 同步模式
      </p>

      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />
    </div>
  )
}

function readBannerFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error(`${file.name} 超過 2MB`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({
      id: crypto.randomUUID?.() || `${Date.now()}-${file.name}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      subtitle: '雞王刷刷鍋',
      image: reader.result,
    })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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
