import { useState, useEffect, useCallback } from 'react'
import { Input, Button } from '../ui'
import { useAuth } from '../../contexts/AuthContext'
import { useToast, useConfirm } from '../ui/Toast'
import { adminSmsConfig } from '../../services/cloudDataService'
import { normalizeTwMobile } from '../../utils/waitlistSms'

// 叫號簡訊（EVERY8D）設定：直接讀寫後端 system/smsConfig（adminSmsConfig，店長限定）。
// 刻意不經設定頁的 settings 同步／儲存列：舊 iPad 整份 settings 推送會把開關蓋回去（LINE 設定被洗空三次同一類事故）。
const DEFAULT_TEMPLATE = '【{店名}】您的候位 #{號碼} 已可入座，請於 10 分鐘內至櫃台報到。'
const TEST_STATUS = {
  sent: '已送出，請看手機',
  'dry-run': '乾跑完成（未實際發送）',
  'skipped-disabled': '總開關關閉中，未發送',
  'skipped-unconfigured': 'EVERY8D 帳密尚未設定，未發送',
  limited: '已達今日上限，未發送',
  failed: '發送失敗',
  unknown: '狀態不明（可能已送出，請看手機）',
  superseded: '逾時，未發送',
  'invalid-mobile': '請輸入 09 開頭的 10 碼手機',
}

const render = (template, name, number) => String(template || DEFAULT_TEMPLATE).replaceAll('{店名}', name).replaceAll('{號碼}', number)

export default function SmsSettingsSection() {
  const { usingFirebase } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [view, setView] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState(null)

  const apply = res => {
    setView(res)
    const c = res.config || {}
    setForm({ enabled: !!c.enabled, dryRun: !!c.dryRun, dailyLimit: String(c.dailyLimit ?? 300), senderName: c.senderName || '', template: c.template || DEFAULT_TEMPLATE })
  }
  const reload = useCallback(async () => {
    setLoading(true); setLoadError('')
    try { apply(await adminSmsConfig({ action: 'get' })) }
    catch (err) { setLoadError(err.message || '讀取簡訊設定失敗') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (usingFirebase) reload() }, [usingFirebase, reload])

  if (!usingFirebase) {
    return <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">本機開發模式（未設定 Firebase）無法設定叫號簡訊。</div>
  }
  if (loadError) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-chicken-red/20 bg-chicken-red/5 px-3 py-2 text-xs text-chicken-red">{loadError}（後端尚未部署時屬正常；叫號不受影響）</div>
        <button onClick={reload} className="text-xs font-bold text-chicken-red">重試</button>
      </div>
    )
  }
  if (!view || !form) return <div className="text-sm text-chicken-brown/50">{loading ? '載入中…' : ''}</div>

  const name = form.senderName.trim() || view.storeName || '雞王涮涮鍋'
  const preview = render(form.template, name, '12')
  const worst = [...render(form.template, name, '9999')].length
  const base = { enabled: !!view.config.enabled, dryRun: !!view.config.dryRun, dailyLimit: String(view.config.dailyLimit), senderName: view.config.senderName || '', template: view.config.template || DEFAULT_TEMPLATE }
  const dirty = Object.keys(base).some(k => form[k] !== base[k])

  const save = async () => {
    const dailyLimit = Number(form.dailyLimit)
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 5000) return toast.error('每日上限需為 1～5000 的整數')
    if (form.enabled && !form.dryRun && !(view.config.enabled && !view.config.dryRun)) {
      const ok = await confirm('開啟後，店員按「叫號」會真的發簡訊給留手機的客人並扣點數。確定開啟？', { title: '開啟叫號簡訊', confirmLabel: '開啟' })
      if (!ok) return
    }
    setBusy(true)
    try {
      apply(await adminSmsConfig({ action: 'set', patch: { enabled: form.enabled, dryRun: form.dryRun, dailyLimit, senderName: form.senderName.trim(), template: form.template.trim() || DEFAULT_TEMPLATE } }))
      toast.success('叫號簡訊設定已儲存（立即生效）')
    } catch (err) { toast.error(err.message || '儲存失敗') }
    finally { setBusy(false) }
  }
  const sendTest = async () => {
    if (!normalizeTwMobile(testPhone)) return setTestResult({ status: 'invalid-mobile' })
    setBusy(true); setTestResult(null)
    try {
      const res = await adminSmsConfig({ action: 'test', phone: testPhone })
      setTestResult(res.result || {})
      await reload()
    } catch (err) { setTestResult({ status: 'failed', error: err.message }) }
    finally { setBusy(false) }
  }

  const mode = !view.config.enabled ? '關閉（不發簡訊）' : view.config.dryRun ? '乾跑（只記錄、不實送）' : '開啟（實際發送）'
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-chicken-brown/5 px-3 py-2 text-xs leading-5 text-chicken-brown/70">
        <div>目前：<b>{mode}</b></div>
        <div>EVERY8D 帳密：<b className={view.credentialsConfigured ? 'text-emerald-700' : 'text-amber-700'}>{view.credentialsConfigured ? '已設定' : '尚未設定（UNSET）'}</b></div>
        <div>今日（{view.counters?.day}）：實送 {view.counters?.live ?? '—'} 封 · 乾跑 {view.counters?.dry ?? '—'} 封 · 上限 {view.config.dailyLimit} 封／天、同一候位 {view.config.perWaitlistLimit} 封</div>
        <div className="mt-1 text-chicken-brown/55">簡訊只是補充：卡片顯示失敗、狀態不明或無手機時，請喊號或打電話。這裡的設定直接存雲端、立即生效，不需按頁面下方的儲存。</div>
      </div>

      <label className="flex items-center gap-2 text-sm font-bold text-chicken-brown min-h-[44px]">
        <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="h-5 w-5" />
        啟用叫號簡訊（總開關）
      </label>
      <label className="flex items-center gap-2 text-sm text-chicken-brown min-h-[44px]">
        <input type="checkbox" checked={form.dryRun} onChange={e => setForm(f => ({ ...f, dryRun: e.target.checked }))} className="h-5 w-5" />
        乾跑模式：不呼叫 EVERY8D，只記錄「本來會送出」的內容（沒有帳號也能測流程）
      </label>
      <Input label="每日上限（封）" type="number" inputMode="numeric" min={1} max={5000} value={form.dailyLimit} onChange={e => setForm(f => ({ ...f, dailyLimit: e.target.value }))} />
      <Input label="署名（選填，預設用店名）" value={form.senderName} maxLength={20} placeholder={view.storeName || '雞王涮涮鍋'} onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))} />
      <div>
        <label className="label" htmlFor="sms-template">簡訊範本（{'{店名}'}、{'{號碼}'} 會自動代入；不可放網址）</label>
        <textarea id="sms-template" className="input min-h-[80px]" maxLength={120} value={form.template} onChange={e => setForm(f => ({ ...f, template: e.target.value }))} />
        <p className="mt-1 text-xs text-chicken-brown/60">預覽：{preview}</p>
        <p className={`text-xs ${worst > 70 ? 'font-bold text-chicken-red' : 'text-chicken-brown/50'}`}>以 4 位數號碼試算 {worst} 字{worst > 70 ? '，超過單則 70 字，無法儲存' : '（單則 70 字內＝1 點）'}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy || !dirty || worst > 70} className="min-h-[44px]">儲存簡訊設定</Button>
        <button onClick={() => setForm(f => ({ ...f, template: DEFAULT_TEMPLATE }))} disabled={busy} className="btn-secondary min-h-[44px] px-3 text-sm">範本恢復預設</button>
      </div>

      <div className="rounded-xl border border-chicken-brown/10 bg-chicken-cream/40 p-3 space-y-2">
        <div className="text-sm font-bold text-chicken-brown">發測試簡訊</div>
        <p className="text-xs text-chicken-brown/55">同樣受總開關、乾跑模式與每日上限約束（開關關閉時不會發出）。</p>
        <Input label="測試手機" type="tel" inputMode="numeric" value={testPhone} placeholder="0912345678" onChange={e => setTestPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 14))} />
        <Button onClick={sendTest} disabled={busy} className="min-h-[44px]">發測試簡訊</Button>
        {testResult && (
          <div role="status" className="text-xs text-chicken-brown/80">
            結果：<b>{TEST_STATUS[testResult.status] || testResult.status}</b>
            {testResult.error && <span>（{testResult.error}）</span>}
            {testResult.dryRunMessage && <div className="mt-1">本來會送出：{testResult.dryRunMessage}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
