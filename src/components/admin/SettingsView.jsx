import { useState, useEffect, useMemo } from 'react'
import { Input, Button, Select } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast, useConfirm } from '../ui/Toast'
import { searchNoshow } from '../../services/bookingService'
import { generateTimeSlots, todayStr, slotsInSeating, seatingForSlot } from '../../utils/timeSlots'
import TableGrid from './TableGrid'
import LayoutEditor from './LayoutEditor'
import TelegramSettings from './TelegramSettings'
import StaffAdminSection from './StaffAdminSection'
import ExportCenter from './ExportCenter'

// 預設值（與 settingsService 的 DEFAULT 對齊，僅供 UI 對比顯示用）
const SETTINGS_DEFAULTS = {
  openTime: '11:00',
  closeTime: '19:00',
  slotInterval: 30,
  maxDaysAhead: 30,
  diningDurationMin: 90,
  cleanupBufferMin: 10,
}
// 會影響容量／可訂時段的欄位，改動時需提醒既有訂位受影響
const CAPACITY_FIELDS = ['diningDurationMin', 'cleanupBufferMin', 'openTime', 'closeTime', 'slotInterval']
const FIELD_LABELS = {
  diningDurationMin: '用餐時間',
  cleanupBufferMin: '清桌緩衝',
  openTime: '開始時間',
  closeTime: '結束時間',
  slotInterval: '時段間隔',
}

export default function SettingsView() {
  const { settings, bookings, updateSettings, cloudStatus, migrateLocalToCloud, pullCloud } = useBooking()
  const { user, signOut, can } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState(settings)
  const [searchPhone, setSearchPhone] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)

  // B14：追蹤未儲存變更（比對目前表單 vs 已存 settings）
  const dirtyKeys = useMemo(() => {
    if (!settings) return []
    return Object.keys(form || {}).filter(k => {
      // heroBanners 有自己的儲存按鈕，這裡用 JSON 比對其餘設定欄位
      const a = form[k]
      const b = settings[k]
      if (typeof a === 'object') return JSON.stringify(a) !== JSON.stringify(b)
      return a !== b
    })
  }, [form, settings])
  const isDirty = dirtyKeys.length > 0
  // 是否動到會影響容量／時段的設定（B1）
  const capacityDirty = dirtyKeys.some(k => CAPACITY_FIELDS.includes(k))
  // 未來已確認訂位筆數（保守估計：date>=今天 && status==='confirmed'）
  const affectedBookingCount = useMemo(
    () => (bookings || []).filter(b => b.date >= todayStr() && b.status === 'confirmed').length,
    [bookings]
  )
  // 動態可訂時段數（依目前表單的營業時間 / 間隔）
  const slotCount = useMemo(() => {
    try {
      return generateTimeSlots(form.openTime, form.closeTime, Number(form.slotInterval) || 30).length
    } catch {
      return 0
    }
  }, [form.openTime, form.closeTime, form.slotInterval])

  // B14：離開前提醒尚有未儲存變更
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const persist = (patch) => {
    updateSettings(patch)
    toast.success('✅ 已儲存')
  }

  // B1：若改到容量／時段相關設定，儲存前用 confirm(danger) 提示受影響的未來訂位
  const handleSave = async () => {
    if (capacityDirty && affectedBookingCount > 0) {
      const changed = dirtyKeys.filter(k => CAPACITY_FIELDS.includes(k)).map(k => FIELD_LABELS[k] || k).join('、')
      const ok = await confirm(
        `你即將調整「${changed}」，這會改變可訂容量與時段。\n目前有 ${affectedBookingCount} 筆未來「已確認」訂位可能受影響（保守估計）。\n仍要儲存嗎？`,
        { title: '影響現有訂位', danger: true, confirmLabel: '仍要儲存' }
      )
      if (!ok) return
    }
    persist(form)
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
    toast.success('✅ 首頁廣告已儲存')
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
  const handleResetAll = async () => {
    const ok = await confirm(
      `將清除所有訂位、候位、桌位狀態與顧客資料，桌位佈局還原為預設。\n此動作無法復原。`,
      { title: '重設所有資料', danger: true, confirmLabel: '⚠️ 確認重設' }
    )
    if (!ok) return
    ;['chicken_bookings_v1', 'chicken_tables_v3', 'chicken_tables_v2', 'chicken_waitlist_v1', 'chicken_customers_v1', 'chicken_noshow_v1']
      .forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }
  // C11：驗證設定（stub）— 檢查啟用 LIFF 時必填欄位是否非空
  const handleValidateLine = () => {
    const missing = []
    if (!form.lineOfficialUrl?.trim()) missing.push('LINE 官方帳號加入連結')
    if (form.lineUseLiff) {
      if (!form.lineLiffUrl?.trim()) missing.push('LIFF 訂位綁定連結')
      if (!form.lineLiffId?.trim()) missing.push('LIFF ID')
    }
    if (missing.length === 0) {
      toast.success('LINE 設定檢查通過：必填欄位都有填寫')
    } else {
      toast.error(`尚有必填欄位未填：${missing.join('、')}`)
    }
  }
  const handleCloudSync = async (type) => {
    setCloudBusy(true)
    try {
      if (type === 'push') await migrateLocalToCloud()
      else await pullCloud()
      toast.success(type === 'push' ? '✅ 已上傳 Firestore' : '✅ 已從 Firestore 更新')
    } catch (err) {
      toast.error(`⚠️ ${err.message || '同步失敗'}`)
    } finally {
      setCloudBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* B14：未儲存變更 sticky 提示 + 統一儲存 CTA */}
      {isDirty && (
        <div className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 shadow-sm">
          <div className="text-sm font-bold text-amber-800">
            ⚠️ 有未儲存變更（{dirtyKeys.length} 項）
            {capacityDirty && affectedBookingCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-chicken-red px-2 py-0.5 text-xs font-bold text-white">
                ⚠️ 影響現有訂位
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setForm(settings)}
              className="min-h-[44px] rounded-xl border border-amber-400/60 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-50"
            >
              還原
            </button>
            <button
              onClick={handleSave}
              className="btn-primary min-h-[44px] px-5 py-2"
            >
              儲存全部變更
            </button>
          </div>
        </div>
      )}

      <SettingsSection title="營業時段" description="控制客人可選日期、時段與營業起訖時間。" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="開始時間" type="time" value={form.openTime} onChange={e => setForm(f => ({ ...f, openTime: e.target.value }))} />
            <Input label="結束時間" type="time" value={form.closeTime} onChange={e => setForm(f => ({ ...f, closeTime: e.target.value }))} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="label !mb-0">時段間隔</span>
              <DefaultBadge current={Number(form.slotInterval)} fallback={SETTINGS_DEFAULTS.slotInterval} unit="分" />
            </div>
            <Select
              className="mt-2"
              value={form.slotInterval}
              onChange={e => setForm(f => ({ ...f, slotInterval: Number(e.target.value) }))}
              options={[{ value: 15, label: '15 分鐘' }, { value: 30, label: '30 分鐘' }, { value: 60, label: '60 分鐘' }]}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="label !mb-0">可預訂天數</span>
              <DefaultBadge current={Number(form.maxDaysAhead)} fallback={SETTINGS_DEFAULTS.maxDaysAhead} unit="天" />
            </div>
            <Select
              className="mt-2"
              value={form.maxDaysAhead}
              onChange={e => setForm(f => ({ ...f, maxDaysAhead: Number(e.target.value) }))}
              options={[{ value: 7, label: '7 天' }, { value: 14, label: '14 天' }, { value: 30, label: '30 天' }, { value: 60, label: '60 天' }]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="label !mb-0">用餐時間（分鐘）</span>
                <DefaultBadge current={Number(form.diningDurationMin) || 90} fallback={SETTINGS_DEFAULTS.diningDurationMin} unit="分" />
              </div>
              <Input
                className="mt-2"
                type="number"
                min="30"
                max="240"
                value={form.diningDurationMin || 90}
                onChange={e => setForm(f => ({ ...f, diningDurationMin: Number(e.target.value) }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="label !mb-0">清桌緩衝（分鐘）</span>
                <DefaultBadge current={Number(form.cleanupBufferMin) || 10} fallback={SETTINGS_DEFAULTS.cleanupBufferMin} unit="分" />
              </div>
              <Input
                className="mt-2"
                type="number"
                min="0"
                max="60"
                value={form.cleanupBufferMin || 10}
                onChange={e => setForm(f => ({ ...f, cleanupBufferMin: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            可訂位容量會以「用餐時間 + 清桌緩衝」計算；目前每筆訂位佔用 {(Number(form.diningDurationMin) || 90) + (Number(form.cleanupBufferMin) || 10)} 分鐘。
            <span className="mt-1 block">
              依目前營業時間與間隔，每天可訂 <span className="font-black text-chicken-brown">{slotCount}</span> 個時段。
            </span>
          </div>
          {capacityDirty && (
            <div className="flex items-center gap-2 rounded-xl border border-chicken-red/20 bg-chicken-red/5 px-3 py-2">
              <span className="inline-flex items-center rounded-full bg-chicken-red px-2 py-0.5 text-xs font-bold text-white">⚠️ 影響現有訂位</span>
              <span className="text-xs leading-5 text-chicken-brown/70">
                此區設定會改變可訂容量／時段；儲存前會提示有 {affectedBookingCount} 筆未來已確認訂位可能受影響。
              </span>
            </div>
          )}
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存設定</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="場次設定" description="定義固定場次（午餐第一批、晚餐第一批…）。排位規劃地圖與「關閉整場次」皆依此。" defaultOpen>
        <SeatingsEditor form={form} setForm={setForm} />
        <div className="flex gap-2 items-center mt-3">
          <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存場次</Button>
        </div>
      </SettingsSection>

      <SettingsSection title="線上訂位防線" description="只限制線上客人端；店員後台、現場與團體預排完全不受影響。">
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">滿座門檻自動關閉</div>
              <div className="text-xs text-chicken-brown/55 mt-0.5">時段已訂人數達下方門檻時，線上自動顯示不可訂，剩餘座位保留給現場與電話客人。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.onlineAutoCloseEnabled === true}
              onChange={e => setForm(f => ({ ...f, onlineAutoCloseEnabled: e.target.checked }))} />
          </label>
          <div>
            <span className="label">關閉門檻（已訂佔總容量比例）</span>
            <Select
              className="mt-2"
              value={Number(form.onlineAutoClosePercent) || 80}
              onChange={e => setForm(f => ({ ...f, onlineAutoClosePercent: Number(e.target.value) }))}
              options={[
                { value: 70, label: '70%' },
                { value: 75, label: '75%' },
                { value: 80, label: '80%（建議）' },
                { value: 85, label: '85%' },
                { value: 90, label: '90%' },
                { value: 95, label: '95%' },
              ]}
            />
          </div>
          <div>
            <span className="label">場次開始前停止線上訂位</span>
            <Select
              className="mt-2"
              value={Number(form.onlineSessionCutoffMin) || 0}
              onChange={e => setForm(f => ({ ...f, onlineSessionCutoffMin: Number(e.target.value) }))}
              options={[
                { value: 0, label: '不啟用（時段到點才關）' },
                { value: 30, label: '30 分鐘前' },
                { value: 60, label: '1 小時前' },
                { value: 90, label: '1.5 小時前' },
                { value: 120, label: '2 小時前' },
                { value: 180, label: '3 小時前' },
                { value: 240, label: '4 小時前' },
              ]}
            />
            <div className="mt-2 rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
              到截止時間後，該場次（餐期）所有抵達時段都不再開放線上訂位與線上改期；電話與現場不受影響。
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存防線設定</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="現場自動化（自動清檯）" description="超時自動釋桌與換日掃除；系統自動動作會留紀錄（現場提示列可查）。">
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">超時自動釋桌</div>
              <div className="text-xs text-chicken-brown/55 mt-0.5">用餐超過下方時數高概率是忘記按清桌：散客桌自動釋出、團體桌自動「此梯離席」待清。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.autoReleaseEnabled !== false}
              onChange={e => setForm(f => ({ ...f, autoReleaseEnabled: e.target.checked }))} />
          </label>
          <div>
            <span className="label">視為忘記清桌的時數</span>
            <Select
              className="mt-2"
              value={Number(form.autoReleaseAfterMin) || 300}
              onChange={e => setForm(f => ({ ...f, autoReleaseAfterMin: Number(e.target.value) }))}
              options={[
                { value: 180, label: '3 小時' },
                { value: 240, label: '4 小時' },
                { value: 300, label: '5 小時（建議）' },
                { value: 360, label: '6 小時' },
                { value: 480, label: '8 小時' },
              ]}
            />
          </div>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">換日掃除</div>
              <div className="text-xs text-chicken-brown/55 mt-0.5">每天第一次打開系統時，自動清掉昨日殘留的用餐/待清桌況，昨日已到店團體自動結案。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.dayRolloverEnabled !== false}
              onChange={e => setForm(f => ({ ...f, dayRolloverEnabled: e.target.checked }))} />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-bold text-chicken-brown">換日自動標記未到（No-show）</div>
              <div className="text-xs text-chicken-red/80 mt-0.5">⚠️ 建議保持關閉：昨日未處理的訂位自動標 No-show 會影響報表口徑（不計入顧客罰則）。當天請改用現場「訂位脈動 → 過時未到」處理。</div>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-chicken-red"
              checked={form.autoNoshowOnRollover === true}
              onChange={e => setForm(f => ({ ...f, autoNoshowOnRollover: e.target.checked }))} />
          </label>
          <div className="flex gap-2 items-center">
            <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存自動化設定</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="休店 / 關閉時段管理" description="關閉整天（公休）、特定場次或特定時段的新訂位；既有訂位不受影響。">
        <ClosuresEditor form={form} setForm={setForm} bookings={bookings} />
        <div className="flex gap-2 items-center mt-3">
          <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存關閉設定</Button>
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
            <Button onClick={saveBanners} className="flex-1 min-h-[44px]">儲存首頁廣告</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="LINE 官方帳號" description="設定客人訂位成功後看到的 LINE 加好友入口與保存提醒。">
        <div className="space-y-4">
          {/* C11：基本 */}
          <FieldGroup title="基本" hint="客人訂位完成後看到的 LINE 加好友入口。">
            <Field hint="顯示在加好友按鈕旁的官方帳號名稱。">
              <Input
                label="顯示名稱"
                value={form.lineOfficialName || ''}
                onChange={e => setForm(f => ({ ...f, lineOfficialName: e.target.value }))}
                placeholder="雞王涮涮鍋 LINE 官方帳號"
                title="顯示在加好友按鈕旁的官方帳號名稱"
              />
            </Field>
            <Field hint="客人點「加入好友」會開啟的 lin.ee 連結，必填。">
              <Input
                label="LINE 官方帳號加入連結"
                type="url"
                value={form.lineOfficialUrl || ''}
                onChange={e => setForm(f => ({ ...f, lineOfficialUrl: e.target.value.trim() }))}
                placeholder="https://lin.ee/xxxxxxx"
                title="客人點加入好友會開啟的 lin.ee 連結"
              />
            </Field>
          </FieldGroup>

          {/* LINE Login 網頁授權綁定（建議的主要綁定方式，取代易卡載入的 LIFF） */}
          <FieldGroup title="LINE Login 綁定（建議）" hint="網頁授權綁定：客人點訂位頁 CTA → LINE 授權 → 自動完成綁定並接收訊息。比 LIFF 穩定，不會卡「一直載入」。">
            <Field hint="LINE Login channel 的 Channel ID（非 Messaging API channel）。位置：LINE Developers → LINE Login channel → Basic settings。LINE Login 綁定與「我的訂位」查詢共用；未填則兩者停用。">
              <Input
                label="LINE Login Channel ID"
                value={form.lineLoginChannelId || ''}
                onChange={e => setForm(f => ({ ...f, lineLoginChannelId: e.target.value.trim() }))}
                placeholder="1234567890"
                title="LINE Login channel 的 Channel ID（綁定 + 我的訂位查詢用）"
              />
            </Field>
            <Field hint="OAuth 回呼網址＝部署後的 lineLoginCallback 函式網址；需一字不差填入 LINE Login channel 的 Callback URL 白名單。另需把 Login channel 連動（Linked OA）到官方帳號，加好友才會生效。">
              <Input
                label="LINE Login 回呼網址"
                type="url"
                value={form.lineLoginCallbackUrl || ''}
                onChange={e => setForm(f => ({ ...f, lineLoginCallbackUrl: e.target.value.trim() }))}
                placeholder="https://us-central1-chicken-booking-tw.cloudfunctions.net/lineLoginCallback"
                title="OAuth 回呼網址（lineLoginCallback 函式 URL）"
              />
            </Field>
          </FieldGroup>

          {/* C11：LIFF（舊版，建議關閉，改用上方 LINE Login 綁定） */}
          <FieldGroup title="LIFF（舊版）" hint="舊版 LIFF 自動綁定；多段重導易卡「一直載入」，建議保持關閉、改用上方 LINE Login 綁定。">
            <label className="flex items-start gap-3 rounded-xl border border-chicken-brown/10 bg-white px-4 py-3 text-sm font-bold text-chicken-brown">
              <input
                type="checkbox"
                checked={!!form.lineUseLiff}
                onChange={e => setForm(f => ({ ...f, lineUseLiff: e.target.checked }))}
                className="mt-1"
              />
              <span>
                使用 LIFF 自動綁定（不建議）
                <span className="mt-1 block text-xs font-bold leading-5 text-chicken-brown/55">
                  建議關閉，改用上方 LINE Login 網頁授權綁定；LIFF 在 LINE 內外瀏覽器易重導卡死。
                </span>
              </span>
            </label>
            <Field hint="開啟 LIFF 時客人綁定頁的 liff.line.me 連結。">
              <Input
                label="LIFF 訂位綁定連結（選填）"
                type="url"
                value={form.lineLiffUrl || ''}
                onChange={e => setForm(f => ({ ...f, lineLiffUrl: e.target.value.trim() }))}
                placeholder="https://liff.line.me/xxxxxxxx"
                title="LIFF 訂位綁定頁連結"
              />
            </Field>
            <Field hint="LINE Developers 後台建立 LIFF App 後取得的 ID。">
              <Input
                label="LIFF ID（選填）"
                value={form.lineLiffId || ''}
                onChange={e => setForm(f => ({ ...f, lineLiffId: e.target.value.trim() }))}
                placeholder="xxxxxxxxxx-xxxxxxxx"
                title="LINE Developers 後台的 LIFF App ID"
              />
            </Field>
          </FieldGroup>

          {/* 店員端改動通知客人（feature flag，預設關）*/}
          <FieldGroup title="通知" hint="店員後台改動訂位時是否自動 LINE 通知客人。">
            <label className="flex items-start gap-3 rounded-xl border border-chicken-brown/10 bg-white px-4 py-3 text-sm font-bold text-chicken-brown">
              <input
                type="checkbox"
                checked={!!form.lineNotifyOnAdminChange}
                onChange={e => setForm(f => ({ ...f, lineNotifyOnAdminChange: e.target.checked }))}
                className="mt-1"
              />
              <span>
                後台改期 / 取消時自動 LINE 通知客人
                <span className="mt-1 block text-xs font-bold leading-5 text-chicken-brown/55">
                  只通知客人在意的變更（取消、改日期/時段/人數）；指派桌位、入座、結帳等內務操作不通知。
                  通知約在 2 分鐘內送達已綁定 LINE 的客人。建議店內先驗證一輪再開啟。
                </span>
              </span>
            </label>
          </FieldGroup>

          {/* C11：後端端點 */}
          <FieldGroup title="後端端點" hint="Cloud Functions / 後端服務網址；API Token 一律放後端，不可放前端。">
            <Field hint="處理 LINE 綁定的後端網址。">
              <Input
                label="LINE 綁定後端端點（選填）"
                type="url"
                value={form.lineBindEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, lineBindEndpoint: e.target.value.trim() }))}
                placeholder="https://.../lineBind"
                title="處理 LINE 綁定的後端網址"
              />
            </Field>
            <Field hint="推播訂位通知給客人的後端網址。">
              <Input
                label="LINE 推播後端端點（選填）"
                type="url"
                value={form.linePushEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, linePushEndpoint: e.target.value.trim() }))}
                placeholder="https://.../linePushBooking"
                title="推播訂位通知的後端網址"
              />
            </Field>
            <Field hint="供客人在 LINE 內查詢訂位的後端網址。">
              <Input
                label="LINE 訂位讀取端點（選填）"
                type="url"
                value={form.lineManageEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, lineManageEndpoint: e.target.value.trim() }))}
                placeholder="https://.../lineGetBooking"
                title="客人在 LINE 內查詢訂位的後端網址"
              />
            </Field>
            <Field hint="「LINE 我的訂位」清單查詢的後端網址。">
              <Input
                label="LINE 我的訂位端點（選填）"
                type="url"
                value={form.lineMyBookingsEndpoint || ''}
                onChange={e => setForm(f => ({ ...f, lineMyBookingsEndpoint: e.target.value.trim() }))}
                placeholder="https://.../lineMyBookings"
                title="LINE 我的訂位清單查詢端點"
              />
            </Field>
            <Field hint="訂位網站的正式網址。LINE 通知卡片的「管理 / 修改訂位」按鈕連結以此組成；未填則卡片不顯示該按鈕。">
              <Input
                label="訂位網站網址（選填）"
                type="url"
                value={form.publicSiteUrl || ''}
                onChange={e => setForm(f => ({ ...f, publicSiteUrl: e.target.value.trim() }))}
                placeholder="https://booking.example.com"
                title="訂位網站正式網址（LINE 通知管理按鈕用）"
              />
            </Field>
          </FieldGroup>

          <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-xs leading-5 text-chicken-brown/60">
            目前預設會先開啟網站中轉頁，避免未公開或設定錯誤的 LIFF 造成 404。若已確認 LIFF Channel、Endpoint URL、Scope 與官方帳號連動都正常，再勾選「使用 LIFF 自動綁定」。
            LINE API Token 仍必須放在後端或 Cloud Functions，不能放前端。
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存 LINE 設定</Button>
            <button onClick={handleValidateLine} className="btn-secondary min-h-[44px] whitespace-nowrap">
              驗證設定
            </button>
            {form.lineOfficialUrl && (
              <a href={form.lineOfficialUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-[44px] flex items-center whitespace-nowrap">
                測試開啟
              </a>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="客人聯絡入口" description="設定確認頁與訂位管理中心的一鍵撥電話、導航資訊。">
        <div className="space-y-3">
          <Input
            label="店名"
            value={form.storeName || ''}
            onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))}
            placeholder="雞王涮涮鍋"
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
            <Button onClick={handleSave} className="flex-1 min-h-[44px]">儲存聯絡入口</Button>
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
            <Button disabled={cloudBusy} onClick={() => handleCloudSync('push')} className="w-full min-h-[44px]">
              {cloudBusy ? '同步中...' : '上傳本機資料到 Firestore'}
            </Button>
            <button disabled={cloudBusy} onClick={() => handleCloudSync('pull')} className="btn-secondary min-h-[44px]">
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
        <SettingsSection title="桌位佈局" description="拖拉桌位、調整容量與樓層。">
          <p className="text-xs text-chicken-brown/60 mb-3">
            打開全螢幕編輯器：拖拉移動桌位、調整容量與樓層、新增或刪除桌位。
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

      <SettingsSection title="資料匯出" description="自選日期區間、散客/團體、來源、場次、狀態、旅行社/導遊後下載 CSV。">
        <ExportCenter />
      </SettingsSection>

      {can('staff.manage') && (
        <SettingsSection title="管理員帳號" description="新增同仁的 Google 帳號即可登入後台；毋須重新部署。">
          <StaffAdminSection />
        </SettingsSection>
      )}

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
          <button
            onClick={handleResetAll}
            className="btn-destructive w-full"
          >
            🚫 重設所有資料
          </button>
        </SettingsSection>
      )}

      <p className="text-center text-xs text-chicken-brown/40 pt-4">
        雞王涮涮鍋訂位系統 v0.4 · Firestore 同步模式
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
      subtitle: '雞王涮涮鍋',
      image: reader.result,
    })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 場次（seating）編輯器：增刪場次、改名稱/起訖時間。寫回 form.seatings。
function SeatingsEditor({ form, setForm }) {
  const seatings = Array.isArray(form.seatings) ? form.seatings : []
  const patch = (id, p) => setForm(f => ({ ...f, seatings: (f.seatings || []).map(s => s.id === id ? { ...s, ...p } : s) }))
  const add = () => setForm(f => {
    const list = f.seatings || []
    const id = `s${Date.now().toString(36)}${list.length}`
    return { ...f, seatings: [...list, { id, name: `場次${list.length + 1}`, start: f.openTime || '11:00', end: f.closeTime || '19:00' }] }
  })
  const remove = (id) => setForm(f => ({ ...f, seatings: (f.seatings || []).filter(s => s.id !== id) }))

  return (
    <div className="space-y-2">
      {seatings.length === 0 && (
        <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">
          尚未設定場次。新增後，排位規劃地圖即可依場次（如「午餐第一批」）切換檢視。
        </div>
      )}
      {seatings.map(s => (
        <div key={s.id} className="flex items-end gap-2 flex-wrap rounded-xl border border-chicken-brown/10 bg-white p-2">
          <Input label="名稱" value={s.name} onChange={e => patch(s.id, { name: e.target.value })} className="flex-1 min-w-[120px]" />
          <Input label="開始" type="time" value={s.start} onChange={e => patch(s.id, { start: e.target.value })} className="w-40" />
          <Input label="結束" type="time" value={s.end} onChange={e => patch(s.id, { end: e.target.value })} className="w-40" />
          <button onClick={() => remove(s.id)} className="min-h-[44px] px-3 text-sm font-bold text-chicken-red border-2 border-chicken-red/30 rounded-xl">刪除</button>
        </div>
      ))}
      <button onClick={add} className="text-sm font-bold text-chicken-red">＋ 新增場次</button>
    </div>
  )
}

// 關閉時段編輯器：選日期 → 整天公休 / 關閉整場次 / 關閉個別時段。寫回 form.closures。
function ClosuresEditor({ form, setForm, bookings }) {
  const [date, setDate] = useState(todayStr())
  const closures = form.closures || { closedDates: [], closedSlots: {}, closedSeatings: {} }
  const seatings = Array.isArray(form.seatings) ? form.seatings : []
  const dayClosed = (closures.closedDates || []).includes(date)
  const closedSeatingIds = closures.closedSeatings?.[date] || []
  const closedSlotList = closures.closedSlots?.[date] || []

  // 受影響的未來已確認訂位（僅此日期），供關閉前提醒。
  const affected = (bookings || []).filter(b => b.date === date && b.status === 'confirmed')

  const setClosures = (next) => setForm(f => ({ ...f, closures: next }))
  const toggleArr = (arr = [], v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
  const setDateMap = (mapKey, key, arr) => {
    const m = { ...(closures[mapKey] || {}) }
    if (arr.length) m[key] = arr; else delete m[key]
    setClosures({ ...closures, [mapKey]: m })
  }
  const toggleDay = () => setClosures({ ...closures, closedDates: toggleArr(closures.closedDates, date) })
  const toggleSeating = (id) => setDateMap('closedSeatings', date, toggleArr(closedSeatingIds, id))
  const toggleSlot = (t) => setDateMap('closedSlots', date, toggleArr(closedSlotList, t))

  // 不屬於任何場次的時段（午晚餐之間等），歸到「其他時段」
  const orphanSlots = generateTimeSlots(form.openTime, form.closeTime, form.slotInterval)
    .filter(t => !seatingForSlot(form, t))

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <span className="label !mb-1 block">選擇日期</span>
          <input type="date" value={date} min={todayStr()} onChange={e => setDate(e.target.value)}
            className="rounded-xl border-2 border-chicken-brown/15 px-3 py-2 text-sm font-bold text-chicken-brown" />
        </div>
        <label className="flex items-center gap-2 min-h-[44px] rounded-xl border-2 px-3 font-bold text-sm cursor-pointer"
          style={{ borderColor: dayClosed ? '#e11d48' : 'rgba(58,46,38,0.15)', color: dayClosed ? '#be123c' : '#3a2e26', background: dayClosed ? '#fff1f2' : '#fff' }}>
          <input type="checkbox" checked={dayClosed} onChange={toggleDay} />
          🚫 整天公休
        </label>
      </div>

      {affected.length > 0 && (
        <div className="rounded-xl border border-chicken-red/20 bg-chicken-red/5 px-3 py-2 text-xs leading-5 text-chicken-brown/70">
          ⚠️ 此日期已有 <span className="font-black text-chicken-red">{affected.length}</span> 筆已確認訂位。關閉只會停止「新訂位」，<b>不會自動取消既有訂位</b>，必要時請另行通知客人。
        </div>
      )}

      {dayClosed ? (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-500">本日已設為整天公休，所有場次與時段皆停止新訂位。</div>
      ) : (
        <>
          {seatings.map(s => {
            const seatingClosed = closedSeatingIds.includes(s.id)
            const slots = slotsInSeating(form, s)
            return (
              <div key={s.id} className="rounded-xl border border-chicken-brown/10 bg-white p-3">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="font-bold text-chicken-brown text-sm">{s.name} <span className="text-xs font-normal text-chicken-brown/50">{s.start}–{s.end}</span></span>
                  <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: seatingClosed ? '#be123c' : '#3a2e26' }}>
                    <input type="checkbox" checked={seatingClosed} onChange={() => toggleSeating(s.id)} />
                    關閉整場次
                  </span>
                </label>
                {!seatingClosed && slots.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {slots.map(t => {
                      const on = closedSlotList.includes(t)
                      return (
                        <button key={t} onClick={() => toggleSlot(t)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border-2 ${on ? 'border-rose-400 bg-rose-50 text-rose-600 line-through' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                          {t}{on ? ' 🚫' : ''}
                        </button>
                      )
                    })}
                  </div>
                )}
                {seatingClosed && <div className="mt-1 text-xs text-rose-500">整場次已關閉，涵蓋 {slots.join('、') || '—'}</div>}
              </div>
            )
          })}
          {orphanSlots.length > 0 && (
            <div className="rounded-xl border border-chicken-brown/10 bg-white p-3">
              <div className="font-bold text-chicken-brown text-sm mb-2">其他時段（不屬任何場次）</div>
              <div className="flex flex-wrap gap-1.5">
                {orphanSlots.map(t => {
                  const on = closedSlotList.includes(t)
                  return (
                    <button key={t} onClick={() => toggleSlot(t)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border-2 ${on ? 'border-rose-400 bg-rose-50 text-rose-600 line-through' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                      {t}{on ? ' 🚫' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// C11：LINE 端點分組區塊（基本 / LIFF / 後端端點）
function FieldGroup({ title, hint, children }) {
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-white p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-black text-chicken-brown">{title}</h3>
        {hint && <span className="text-xs leading-5 text-chicken-brown/50">{hint}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// 單一欄位 + 小字說明
function Field({ hint, children }) {
  return (
    <div>
      {children}
      {hint && <p className="mt-1 text-xs leading-5 text-chicken-brown/50">{hint}</p>}
    </div>
  )
}

// C14：數值設定旁的「預設值對比」灰 badge（僅在目前值不同於預設時顯示）
function DefaultBadge({ current, fallback, unit = '' }) {
  if (current === fallback || fallback == null) return null
  return (
    <span
      className="badge bg-chicken-brown/10 text-chicken-brown/60"
      title={`系統預設為 ${fallback}${unit}，目前已自訂為 ${current}${unit}`}
    >
      預設 {fallback}{unit}
    </span>
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
