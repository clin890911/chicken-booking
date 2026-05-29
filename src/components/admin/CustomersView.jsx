import { useState, useMemo } from 'react'
import { Card, Input, Modal, Textarea, Select, EmptyState } from '../ui'
import { useConfirm } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { getNoshowCount } from '../../services/bookingService'

const VIP_LABEL = { none: '一般', bronze: '銅卡', silver: '銀卡', gold: '金卡' }
const VIP_COLOR = {
  none: 'bg-chicken-brown/10 text-chicken-brown/60',
  bronze: 'bg-amber-200/40 text-amber-700',
  silver: 'bg-slate-200 text-slate-700',
  gold: 'bg-chicken-yellow/30 text-chicken-yellow',
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function CustomersView() {
  const { customers, bookings, updateCustomer, setCustomerBlacklist, setCustomerVip } = useBooking()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')      // all | repeat | vip | blacklist
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ notes: '', allergies: '', vipTier: 'none' })
  const [blacklisting, setBlacklisting] = useState(null) // { phone, name } 加黑名單對象
  const [blacklistReason, setBlacklistReason] = useState('多次 no-show')
  const confirm = useConfirm()

  const list = useMemo(() => {
    let out = customers
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      out = out.filter(c =>
        (c.phone || '').includes(q) || (c.name || '').toLowerCase().includes(q)
      )
    }
    if (filter === 'repeat') out = out.filter(c => c.visits > 1)
    if (filter === 'vip') out = out.filter(c => c.vipTier && c.vipTier !== 'none')
    if (filter === 'blacklist') out = out.filter(c => c.blacklisted)
    return out.sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''))
  }, [customers, query, filter])

  const openEdit = (c) => {
    setEditing(c)
    setEditForm({
      notes: c.notes || '',
      allergies: c.allergies || '',
      vipTier: c.vipTier || 'none',
    })
  }

  const saveEdit = () => {
    if (!editing) return
    updateCustomer(editing.phone, editForm)
    if (editForm.vipTier !== editing.vipTier) {
      setCustomerVip(editing.phone, editForm.vipTier)
    }
    setEditing(null)
  }

  const stats = useMemo(() => ({
    total: customers.length,
    repeat: customers.filter(c => c.visits > 1).length,
    vip: customers.filter(c => c.vipTier && c.vipTier !== 'none').length,
    blacklist: customers.filter(c => c.blacklisted).length,
  }), [customers])

  return (
    <div className="space-y-3">
      {/* 統計 */}
      <div className="grid grid-cols-4 gap-2">
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-brown">{stats.total}</div><div className="text-[11px] text-chicken-brown/60">總顧客</div></Card>
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-green">{stats.repeat}</div><div className="text-[11px] text-chicken-brown/60">回頭客</div></Card>
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-yellow">{stats.vip}</div><div className="text-[11px] text-chicken-brown/60">VIP</div></Card>
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-red">{stats.blacklist}</div><div className="text-[11px] text-chicken-brown/60">黑名單</div></Card>
      </div>

      {/* 搜尋 + 過濾 */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="search"
          placeholder="🔍 搜尋姓名 / 電話"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="input flex-1 min-w-[200px]"
        />
        <div className="flex gap-1.5">
          {[
            { v: 'all', label: '全部' },
            { v: 'repeat', label: '回頭客' },
            { v: 'vip', label: 'VIP' },
            { v: 'blacklist', label: '黑名單' },
          ].map(f => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                filter === f.v ? 'bg-chicken-red text-white' : 'bg-white border border-chicken-brown/15 text-chicken-brown'
              }`}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      {list.length === 0 ? (
        <EmptyState icon="👥" title="尚無顧客資料" hint="客人訂位後會自動建立顧客檔" />
      ) : (
        <div className="space-y-2">
          {list.map(c => {
            const noshow = getNoshowCount(c.phone)
            return (
              <Card key={c.phone} className={c.blacklisted ? 'border-chicken-red/40 !border-2' : ''}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-base font-bold">{c.name || '未填姓名'}</span>
                      <span className="text-sm text-chicken-brown/60">📱 {c.phone}</span>
                    </div>
                    <div className="text-xs text-chicken-brown/60 mt-1 flex items-center gap-2 flex-wrap">
                      <span>用餐 {c.visits} 次</span>
                      <span>·</span>
                      <span>累計 {c.totalGuests} 位</span>
                      <span>·</span>
                      <span>最後 {fmtDate(c.lastVisit)}</span>
                      {noshow > 0 && (
                        <span className="text-chicken-red font-bold">⚠️ no-show ×{noshow}</span>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${VIP_COLOR[c.vipTier || 'none']}`}>
                        {VIP_LABEL[c.vipTier || 'none']}
                      </span>
                      {c.allergies && (
                        <span className="text-[10px] font-bold bg-chicken-red/10 text-chicken-red px-2 py-0.5 rounded-full">
                          ⚠️ {c.allergies}
                        </span>
                      )}
                      {c.blacklisted && (
                        <span className="text-[10px] font-bold bg-chicken-red text-white px-2 py-0.5 rounded-full">黑名單</span>
                      )}
                    </div>
                    {c.notes && <p className="text-xs text-chicken-brown/70 italic mt-2">「{c.notes}」</p>}
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(c)} className="text-xs px-3 py-1 bg-chicken-cream rounded-lg font-bold text-chicken-brown">編輯</button>
                    <button
                      onClick={async () => {
                        if (c.blacklisted) {
                          const ok = await confirm(`解除 ${c.name} 黑名單？`, { title: '解除黑名單', confirmLabel: '解除' })
                          if (ok) setCustomerBlacklist(c.phone, false)
                        } else {
                          setBlacklistReason('多次 no-show')
                          setBlacklisting({ phone: c.phone, name: c.name })
                        }
                      }}
                      className={`text-xs px-3 py-1 rounded-lg font-bold ${
                        c.blacklisted
                          ? 'bg-chicken-brown/10 text-chicken-brown'
                          : 'bg-chicken-red/10 text-chicken-red'
                      }`}
                    >{c.blacklisted ? '解除黑名單' : '加黑名單'}</button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* 編輯 Modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)}
             title={editing ? `${editing.name} · 顧客檔` : ''}
             footer={
               <>
                 <button onClick={() => setEditing(null)} className="btn-secondary px-4 py-2">取消</button>
                 <button onClick={saveEdit} className="btn-primary px-4 py-2">儲存</button>
               </>
             }
      >
        <div className="space-y-3">
          <Select
            label="VIP 等級"
            value={editForm.vipTier}
            onChange={e => setEditForm(f => ({ ...f, vipTier: e.target.value }))}
            options={[
              { value: 'none', label: '一般' },
              { value: 'bronze', label: '銅卡（菇神 / 雞王 / 鹿芝谷消費 ≥ NT$10,000）' },
              { value: 'silver', label: '銀卡' },
              { value: 'gold', label: '金卡' },
            ]}
          />
          <Input
            label="過敏 / 飲食限制"
            value={editForm.allergies}
            onChange={e => setEditForm(f => ({ ...f, allergies: e.target.value }))}
            placeholder="例：海鮮、花生、麩質"
          />
          <Textarea
            label="備註（剪雞肉、銀髮需求、慶生紀念日…）"
            value={editForm.notes}
            onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </Modal>

      {/* 加黑名單 Modal（取代原生 prompt） */}
      <Modal open={!!blacklisting} onClose={() => setBlacklisting(null)}
             title={blacklisting ? `將 ${blacklisting.name} 加入黑名單` : ''}
             footer={
               <>
                 <button onClick={() => setBlacklisting(null)} className="btn-secondary px-4 py-2">取消</button>
                 <button
                   onClick={() => {
                     if (blacklisting) setCustomerBlacklist(blacklisting.phone, true, blacklistReason.trim())
                     setBlacklisting(null)
                   }}
                   className="btn-primary px-4 py-2"
                 >加入黑名單</button>
               </>
             }
      >
        <Input
          label="黑名單原因"
          value={blacklistReason}
          onChange={e => setBlacklistReason(e.target.value)}
          placeholder="例：多次 no-show"
        />
      </Modal>
    </div>
  )
}
