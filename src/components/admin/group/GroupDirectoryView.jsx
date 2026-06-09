import { useMemo, useState } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../ui/Toast'
import { Modal, Input, Textarea, Button, EmptyState } from '../../ui'

// 旅行社 / 導遊名冊 + 即時彙算歷史 + 貢獻排名（依業績）
export default function GroupDirectoryView() {
  const { agencies, guides, groupReservations, addAgency, updateAgency, archiveAgency, addGuide, updateGuide, archiveGuide } = useBooking()
  const { can } = useAuth()
  const toast = useToast()
  const editable = can('agency.manage')

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [agencyModal, setAgencyModal] = useState(null) // { mode:'add'|'edit', data }
  const [guideModal, setGuideModal] = useState(null)    // { agencyId, data }

  // 即時彙算每家旅行社（排除取消團；一律用 agencyId 關聯）
  const statsByAgency = useMemo(() => {
    const m = {}
    groupReservations.filter(g => g.status !== 'cancelled' && g.agencyId).forEach(g => {
      const s = m[g.agencyId] || { visits: 0, totalGuests: 0, totalSpend: 0, lastVisit: '', history: [] }
      s.visits += 1
      s.totalGuests += Number(g.counts?.total) || 0
      s.totalSpend += Number(g.spend) || 0
      if ((g.date || '') > s.lastVisit) s.lastVisit = g.date
      s.history.push(g)
      m[g.agencyId] = s
    })
    Object.values(m).forEach(s => s.history.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
    return m
  }, [groupReservations])

  const visibleAgencies = useMemo(() => {
    const q = query.trim().toLowerCase()
    return agencies
      .filter(a => !a.archived)
      .filter(a => !q || (a.name || '').toLowerCase().includes(q) || (a.phone || '').includes(q))
      .sort((a, b) => (statsByAgency[b.id]?.totalSpend || 0) - (statsByAgency[a.id]?.totalSpend || 0))
  }, [agencies, query, statsByAgency])

  const guidesByAgency = (agencyId) => guides.filter(g => !g.archived && g.agencyId === agencyId)

  const saveAgency = () => {
    const d = agencyModal.data
    if (!d.name?.trim()) return toast.error('請填旅行社名稱')
    if (agencyModal.mode === 'add') { addAgency(d); toast.success('已新增旅行社') }
    else { updateAgency(d.id, d); toast.success('已更新') }
    setAgencyModal(null)
  }
  const saveGuide = () => {
    const d = guideModal.data
    if (!d.name?.trim()) return toast.error('請填導遊姓名')
    if (d.id) { updateGuide(d.id, d); toast.success('已更新導遊') }
    else { addGuide({ ...d, agencyId: guideModal.agencyId }); toast.success('已新增導遊') }
    setGuideModal(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="搜尋旅行社名稱 / 電話"
          className="input flex-1"
        />
        {editable && (
          <Button onClick={() => setAgencyModal({ mode: 'add', data: { name: '', phone: '', contactName: '', lineId: '', note: '' } })}>
            ➕ 新增旅行社
          </Button>
        )}
      </div>

      {visibleAgencies.length === 0 ? (
        <EmptyState icon="🏢" title="尚無旅行社" hint={editable ? '點右上「新增旅行社」建立名冊' : ''} />
      ) : (
        visibleAgencies.map((a, idx) => {
          const s = statsByAgency[a.id] || { visits: 0, totalGuests: 0, totalSpend: 0, lastVisit: '', history: [] }
          const isOpen = expanded === a.id
          return (
            <div key={a.id} className="bg-white rounded-xl border border-chicken-brown/10 p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-black text-chicken-brown">
                    {idx < 3 && <span className="mr-1">{['🥇', '🥈', '🥉'][idx]}</span>}
                    {a.name}
                  </div>
                  <div className="text-xs text-chicken-brown/60 mt-0.5">
                    {a.phone || '—'}{a.contactName ? ` · 窗口 ${a.contactName}` : ''}{a.lineId ? ` · LINE ${a.lineId}` : ''}
                  </div>
                </div>
                {editable && (
                  <div className="flex gap-1.5">
                    <button onClick={() => setAgencyModal({ mode: 'edit', data: { ...a } })} className="text-xs px-2.5 py-1 rounded-lg border-2 border-chicken-brown/15 text-chicken-brown font-bold">編輯</button>
                    <button onClick={() => { if (confirm(`封存旅行社「${a.name}」？歷史保留。`)) { archiveAgency(a.id); toast.success('已封存') } }} className="text-xs px-2.5 py-1 rounded-lg border-2 border-chicken-brown/15 text-chicken-brown/60 font-bold">封存</button>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                <span className="px-2 py-0.5 rounded-full bg-chicken-brown/10 text-chicken-brown">來訪 {s.visits} 團</span>
                <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">累計 {s.totalGuests} 人</span>
                <span className="px-2 py-0.5 rounded-full bg-chicken-green/15 text-chicken-green">業績 ${s.totalSpend.toLocaleString()}</span>
                {s.lastVisit && <span className="px-2 py-0.5 rounded-full bg-chicken-yellow/15 text-chicken-yellow">最近 {s.lastVisit}</span>}
              </div>

              {/* 導遊 */}
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-chicken-brown/60">導遊</div>
                  {editable && (
                    <button onClick={() => setGuideModal({ agencyId: a.id, data: { name: '', phone: '', lineId: '', note: '' } })} className="text-xs text-chicken-red font-bold">＋ 導遊</button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {guidesByAgency(a.id).length === 0 && <span className="text-xs text-chicken-brown/40">尚無導遊</span>}
                  {guidesByAgency(a.id).map(g => (
                    <button key={g.id} onClick={() => editable && setGuideModal({ agencyId: a.id, data: { ...g } })}
                      className="text-xs px-2.5 py-1 rounded-full bg-chicken-cream border border-chicken-brown/10 text-chicken-brown font-bold">
                      🧑‍✈️ {g.name}{g.phone ? `（${g.phone}）` : ''}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => setExpanded(isOpen ? null : a.id)} className="mt-3 text-xs text-chicken-brown/60 underline">
                {isOpen ? '收合歷史' : `查看來訪歷史（${s.history.length}）`}
              </button>
              {isOpen && (
                <div className="mt-2 space-y-1">
                  {s.history.map(h => (
                    <div key={h.id} className="text-xs text-chicken-brown/70 flex gap-2 flex-wrap">
                      <span className="font-bold tabular-nums">{h.date}</span>
                      <span>{(h.batches || []).map(b => b.timeSlot).join('/')}</span>
                      <span>{h.counts?.total || 0} 人</span>
                      <span>導遊 {h.guideName || '—'}</span>
                      {h.spend > 0 && <span className="text-chicken-green font-bold">${Number(h.spend).toLocaleString()}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      {/* 旅行社 新增/編輯 */}
      <Modal open={!!agencyModal} onClose={() => setAgencyModal(null)}
        title={agencyModal?.mode === 'edit' ? '編輯旅行社' : '新增旅行社'}
        footer={<><Button variant="secondary" onClick={() => setAgencyModal(null)}>取消</Button><Button onClick={saveAgency}>儲存</Button></>}>
        {agencyModal && (
          <div className="space-y-3">
            <Input label="旅行社名稱" value={agencyModal.data.name} onChange={e => setAgencyModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))} />
            <Input label="電話" value={agencyModal.data.phone} onChange={e => setAgencyModal(m => ({ ...m, data: { ...m.data, phone: e.target.value } }))} />
            <Input label="聯絡窗口" value={agencyModal.data.contactName} onChange={e => setAgencyModal(m => ({ ...m, data: { ...m.data, contactName: e.target.value } }))} />
            <Input label="LINE ID" value={agencyModal.data.lineId} onChange={e => setAgencyModal(m => ({ ...m, data: { ...m.data, lineId: e.target.value } }))} />
            <Textarea label="備註" value={agencyModal.data.note} onChange={e => setAgencyModal(m => ({ ...m, data: { ...m.data, note: e.target.value } }))} />
          </div>
        )}
      </Modal>

      {/* 導遊 新增/編輯 */}
      <Modal open={!!guideModal} onClose={() => setGuideModal(null)}
        title={guideModal?.data?.id ? '編輯導遊' : '新增導遊'}
        footer={<>
          {guideModal?.data?.id && (
            <Button variant="secondary" onClick={() => { if (confirm('封存此導遊？')) { archiveGuide(guideModal.data.id); setGuideModal(null) } }}>封存</Button>
          )}
          <Button variant="secondary" onClick={() => setGuideModal(null)}>取消</Button>
          <Button onClick={saveGuide}>儲存</Button>
        </>}>
        {guideModal && (
          <div className="space-y-3">
            <Input label="導遊姓名" value={guideModal.data.name} onChange={e => setGuideModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))} />
            <Input label="電話" value={guideModal.data.phone} onChange={e => setGuideModal(m => ({ ...m, data: { ...m.data, phone: e.target.value } }))} />
            <Input label="LINE ID" value={guideModal.data.lineId} onChange={e => setGuideModal(m => ({ ...m, data: { ...m.data, lineId: e.target.value } }))} />
            <Textarea label="備註" value={guideModal.data.note} onChange={e => setGuideModal(m => ({ ...m, data: { ...m.data, note: e.target.value } }))} />
          </div>
        )}
      </Modal>
    </div>
  )
}
