import { useState, useMemo, useEffect } from 'react'
import { Card, Input, Modal, Textarea, Select, EmptyState } from '../../ui'
import { useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import { getNoshowCount, noshowRisk } from '../../../services/bookingService'

const VIP_LABEL = { none: '一般', bronze: '銅卡', silver: '銀卡', gold: '金卡' }
const VIP_COLOR = {
  none: 'bg-chicken-brown/10 text-chicken-brown/60',
  bronze: 'bg-amber-200/40 text-amber-700',
  silver: 'bg-slate-200 text-slate-700',
  gold: 'bg-chicken-yellow/30 text-chicken-yellow',
}

// VIP 各等級條件說明（短名顯示於選單，說明放選單下方小字）
const VIP_HELP = {
  none: '一般顧客，無消費門檻。',
  bronze: '銅卡：菇神 / 雞王 / 鹿芝谷累計消費 ≥ NT$10,000。',
  silver: '銀卡：累計消費 ≥ NT$30,000。',
  gold: '金卡：累計消費 ≥ NT$60,000。',
}

const NOTE_MAX = 100 // 過敏 / 備註字數上限

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function CustomersView({ initialQuery }) {
  const { customers, bookings, updateCustomer, setCustomerBlacklist, setCustomerVip } = useBooking()
  const [query, setQuery] = useState(initialQuery || '')

  // 從他頁（如設定→No-show 查詢）帶入電話時，seed 搜尋框以聚焦該顧客。
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery)
  }, [initialQuery])
  const [filter, setFilter] = useState('all')      // all | repeat | vip | blacklist | archived
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ notes: '', allergies: '', vipTier: 'none' })
  const [blacklisting, setBlacklisting] = useState(null) // { phone, name } 加黑名單對象
  const [blacklistReason, setBlacklistReason] = useState('') // 必填，不預填避免不假思索標記
  const confirm = useConfirm()

  const list = useMemo(() => {
    let out = customers
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      out = out.filter(c =>
        (c.phone || '').includes(q) || (c.name || '').toLowerCase().includes(q)
      )
    }
    // 預設隱藏已歸檔；僅在「已歸檔」分頁顯示
    out = filter === 'archived' ? out.filter(c => c.archived) : out.filter(c => !c.archived)
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

  const stats = useMemo(() => {
    const active = customers.filter(c => !c.archived)
    return {
      total: active.length,
      repeat: active.filter(c => c.visits > 1).length,
      vip: active.filter(c => c.vipTier && c.vipTier !== 'none').length,
      blacklist: active.filter(c => c.blacklisted).length,
      archived: customers.filter(c => c.archived).length,
    }
  }, [customers])

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
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="search"
            placeholder="🔍 搜尋姓名 / 電話"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input w-full pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清除搜尋"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-chicken-brown/50 hover:bg-chicken-brown/10 hover:text-chicken-brown"
            >✕</button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { v: 'all', label: '全部' },
            { v: 'repeat', label: '回頭客' },
            { v: 'vip', label: 'VIP' },
            { v: 'blacklist', label: '黑名單' },
            { v: 'archived', label: `已歸檔${stats.archived ? ` (${stats.archived})` : ''}` },
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

      {/* 搜尋結果計數 */}
      {query.trim() && (
        <div className="flex items-center gap-2 text-xs text-chicken-brown/70">
          <span>搜尋結果：<span className="font-bold text-chicken-brown">{list.length}</span> 筆</span>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="underline hover:text-chicken-red"
          >清除搜尋</button>
        </div>
      )}

      {/* 列表 */}
      {list.length === 0 ? (
        <EmptyState icon="👥" title="尚無顧客資料" hint="客人訂位後會自動建立顧客檔" />
      ) : (
        <div className="space-y-2">
          {list.map(c => {
            const noshow = getNoshowCount(c.phone)
            const risk = noshowRisk(c.phone)
            // B6：No-show 風險分級徽章樣式（≥3 高風險紅底紅字粗體 / 2 中 / 1 低調）
            const riskBadge =
              risk >= 3 ? 'bg-chicken-red/20 text-chicken-red font-bold'
              : risk === 2 ? 'bg-chicken-red/10 text-chicken-red font-bold'
              : 'text-chicken-red/80'
            return (
              <Card key={c.phone} className={`${c.blacklisted ? 'border-chicken-red/40 !border-2' : ''} ${c.archived ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-base font-bold">{c.name || '未填姓名'}</span>
                      <span className="text-sm text-chicken-brown/60">📱 {c.phone}</span>
                      {c.archived && (
                        <span className="text-[10px] font-bold bg-chicken-brown/10 text-chicken-brown/60 px-2 py-0.5 rounded-full">已歸檔</span>
                      )}
                    </div>
                    <div className="text-xs text-chicken-brown/60 mt-1 flex items-center gap-2 flex-wrap">
                      <span>用餐 {c.visits} 次</span>
                      <span>·</span>
                      <span>累計 {c.totalGuests} 位</span>
                      <span>·</span>
                      <span>最後 {fmtDate(c.lastVisit)}</span>
                      {noshow > 0 && (
                        <span className={`px-2 py-0.5 rounded-full ${riskBadge}`}>
                          ⚠️ no-show ×{noshow}{risk >= 3 ? '（高風險）' : ''}
                        </span>
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
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button onClick={() => openEdit(c)} className="text-xs px-3 min-h-[44px] bg-chicken-cream rounded-lg font-bold text-chicken-brown">編輯</button>
                    <button
                      onClick={async () => {
                        if (c.blacklisted) {
                          const ok = await confirm(`解除 ${c.name} 黑名單？`, { title: '解除黑名單', confirmLabel: '解除' })
                          if (ok) setCustomerBlacklist(c.phone, false)
                        } else {
                          setBlacklistReason('')
                          setBlacklisting({ phone: c.phone, name: c.name })
                        }
                      }}
                      className={`text-xs px-3 min-h-[44px] rounded-lg font-bold ${
                        c.blacklisted
                          ? 'bg-chicken-brown/10 text-chicken-brown hover:bg-chicken-brown/15'
                          : 'bg-white border border-chicken-red/40 text-chicken-red hover:bg-chicken-red/5'
                      }`}
                    >{c.blacklisted ? '✅ 解除黑名單' : '🚫 加黑名單'}</button>
                    <button
                      onClick={() => updateCustomer(c.phone, { archived: !c.archived })}
                      className="text-xs px-3 min-h-[44px] rounded-lg font-bold bg-white border border-chicken-brown/15 text-chicken-brown/70 hover:bg-chicken-brown/5"
                    >{c.archived ? '↩ 取消歸檔' : '🗄 歸檔'}</button>
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
          <div>
            <Select
              label="VIP 等級"
              value={editForm.vipTier}
              onChange={e => setEditForm(f => ({ ...f, vipTier: e.target.value }))}
              options={[
                { value: 'none', label: '一般' },
                { value: 'bronze', label: '銅卡' },
                { value: 'silver', label: '銀卡' },
                { value: 'gold', label: '金卡' },
              ]}
            />
            <p className="text-xs text-chicken-brown/60 mt-1 leading-relaxed">
              {VIP_HELP[editForm.vipTier] || VIP_HELP.none}
            </p>
          </div>
          <div>
            <Input
              label="過敏 / 飲食限制"
              value={editForm.allergies}
              maxLength={NOTE_MAX}
              onChange={e => setEditForm(f => ({ ...f, allergies: e.target.value }))}
              placeholder="例：海鮮、花生、麩質"
            />
            <p className="text-[11px] text-chicken-brown/50 mt-1 text-right">{editForm.allergies.length} / {NOTE_MAX}</p>
          </div>
          <div>
            <Textarea
              label="備註（剪雞肉、銀髮需求、慶生紀念日…）"
              value={editForm.notes}
              maxLength={NOTE_MAX}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
            />
            <p className="text-[11px] text-chicken-brown/50 mt-1 text-right">{editForm.notes.length} / {NOTE_MAX}</p>
          </div>
        </div>
      </Modal>

      {/* 加黑名單 Modal（取代原生 prompt） */}
      <Modal open={!!blacklisting} onClose={() => setBlacklisting(null)}
             title={blacklisting ? `⚠️ 將 ${blacklisting.name} 加入黑名單` : ''}
             footer={
               <>
                 <button onClick={() => setBlacklisting(null)} className="btn-secondary px-4 py-2">取消</button>
                 <button
                   disabled={!blacklistReason.trim()}
                   onClick={() => {
                     if (!blacklistReason.trim()) return
                     if (blacklisting) setCustomerBlacklist(blacklisting.phone, true, blacklistReason.trim())
                     setBlacklisting(null)
                   }}
                   className={`px-4 py-2 rounded-2xl font-bold text-white shadow-md
                     ${blacklistReason.trim() ? 'bg-chicken-red' : 'bg-chicken-red/40 cursor-not-allowed'}`}
                 >🚫 確認加入黑名單</button>
               </>
             }
      >
        <p className="text-xs text-chicken-brown/60 mb-2 leading-relaxed">
          黑名單會影響此顧客後續訂位，請務必填寫原因以利日後查核。
        </p>
        <Input
          label="黑名單原因（必填）"
          value={blacklistReason}
          onChange={e => setBlacklistReason(e.target.value)}
          placeholder="例：多次 no-show、惡意騷擾、損壞設備"
        />
      </Modal>
    </div>
  )
}
