import { useState, useEffect, useCallback } from 'react'
import { Input, Button, Select } from '../ui'
import { useAuth } from '../../contexts/AuthContext'
import { useToast, useConfirm } from '../ui/Toast'
import { adminManageStaff } from '../../services/cloudDataService'

// 管理員帳號管理（僅店長可見；後端 adminManageStaff 端點再做角色硬檢查）。
// 新增的管理員用自己的 Google 帳號登入即可，毋須改環境變數或重新部署。
const ROLE_OPTIONS = [
  { value: 'manager', label: '店長（全部權限）' },
  { value: 'floor', label: '外場（桌位/訂位/候位）' },
  { value: 'host', label: '訂位專員（訂位/團體）' },
  { value: 'kitchen', label: '廚房（唯讀）' },
]

export default function StaffAdminSection() {
  const { user, usingFirebase, roleLabels } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [envAdmins, setEnvAdmins] = useState([])
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ email: '', name: '', role: 'floor' })

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await adminManageStaff({ action: 'list' })
      setEnvAdmins(res.envAdmins || [])
      setAdmins(res.admins || [])
    } catch (err) {
      setLoadError(err.message || '載入管理員清單失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (usingFirebase) reload()
  }, [usingFirebase, reload])

  if (!usingFirebase) {
    return (
      <div className="rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">
        本機開發模式（未設定 Firebase）無法管理雲端管理員清單；正式環境登入後即可在此新增。
      </div>
    )
  }

  const handleAdd = async () => {
    const email = form.email.trim().toLowerCase()
    if (!email) { toast.error('請輸入 Google 帳號 email'); return }
    setBusy(true)
    try {
      await adminManageStaff({ action: 'upsert', email, role: form.role, name: form.name })
      toast.success(`已新增管理員 ${email}`)
      setForm({ email: '', name: '', role: 'floor' })
      await reload()
    } catch (err) {
      toast.error(err.message || '新增失敗')
    } finally {
      setBusy(false)
    }
  }

  const handleRoleChange = async (admin, role) => {
    setBusy(true)
    try {
      await adminManageStaff({ action: 'upsert', email: admin.email, role, name: admin.name })
      toast.success(`${admin.email} 角色已改為 ${roleLabels?.[role] || role}`)
      await reload()
    } catch (err) {
      toast.error(err.message || '更新失敗')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (admin) => {
    const ok = await confirm(
      `確定移除管理員 ${admin.email}？\n移除後此帳號立即無法登入後台。`,
      { title: '移除管理員', danger: true, confirmLabel: '移除' }
    )
    if (!ok) return
    setBusy(true)
    try {
      await adminManageStaff({ action: 'remove', email: admin.email })
      toast.success(`已移除 ${admin.email}`)
      await reload()
    } catch (err) {
      toast.error(err.message || '移除失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 固定管理員（部署白名單） */}
      <div>
        <span className="label">固定管理員（部署白名單，無法在此移除）</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {envAdmins.map(email => (
            <span key={email} className="inline-flex items-center gap-1 rounded-full bg-chicken-brown/10 px-3 py-1 text-xs font-bold text-chicken-brown">
              🔒 {email}{email === user?.email ? '（我）' : ''}
            </span>
          ))}
          {!envAdmins.length && !loading && <span className="text-xs text-chicken-brown/50">（讀取中或未設定）</span>}
        </div>
      </div>

      {/* 動態管理員清單 */}
      <div>
        <div className="flex items-center justify-between">
          <span className="label !mb-0">後台新增的管理員</span>
          <button onClick={reload} disabled={loading || busy} className="text-xs font-bold text-chicken-red disabled:opacity-40">重新整理</button>
        </div>
        {loadError && (
          <div className="mt-2 rounded-xl border border-chicken-red/20 bg-chicken-red/5 px-3 py-2 text-xs text-chicken-red">{loadError}</div>
        )}
        {loading ? (
          <div className="mt-2 text-sm text-chicken-brown/50">載入中…</div>
        ) : admins.length === 0 ? (
          <div className="mt-2 rounded-xl bg-chicken-brown/5 px-4 py-3 text-sm text-chicken-brown/60">
            尚未新增。用下方表單加入同仁的 Google 帳號，對方即可直接用 Google 登入後台。
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {admins.map(admin => (
              <div key={admin.email} className="flex flex-wrap items-center gap-2 rounded-xl border border-chicken-brown/10 bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm font-bold text-chicken-brown">{admin.email}</div>
                  {admin.name && <div className="text-xs text-chicken-brown/55">{admin.name}</div>}
                </div>
                <Select
                  className="!w-auto"
                  value={admin.role || 'floor'}
                  onChange={e => handleRoleChange(admin, e.target.value)}
                  options={ROLE_OPTIONS}
                  disabled={busy}
                />
                <button onClick={() => handleRemove(admin)} disabled={busy} className="btn-danger !px-3 !py-2 text-xs">移除</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新增表單 */}
      <div className="rounded-xl border border-chicken-brown/10 bg-chicken-cream/40 p-3 space-y-3">
        <div className="text-sm font-bold text-chicken-brown">新增管理員</div>
        <Input
          label="Google 帳號 Email"
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          placeholder="staff@gmail.com"
        />
        <Input
          label="稱呼（選填）"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="例：小美"
        />
        <div>
          <span className="label">角色權限</span>
          <Select
            className="mt-2"
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            options={ROLE_OPTIONS}
          />
        </div>
        <Button onClick={handleAdd} disabled={busy} className="w-full min-h-[44px]">新增管理員</Button>
        <p className="text-xs leading-5 text-chicken-brown/55">
          新增後對方在登入頁點「使用 Google 登入」即可進入後台，權限依角色而定；移除後立即失效。
        </p>
      </div>
    </div>
  )
}
