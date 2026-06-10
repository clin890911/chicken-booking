import { useMemo, useState } from 'react'
import { frequentAgencies } from '../../../utils/groupDaySummary'
import { todayStr, addDays, formatDate } from '../../../utils/timeSlots'

// AgencyPicker：旅行社「打字即篩 + 常用快選 + 快速新增」，取代長下拉。
// 純受控：value=agencyId、agencyName=目前名稱快照；onPick(agency) 由父層落 draft；onQuickAdd 開新增表單。
export default function AgencyPicker({ agencies = [], groupReservations = [], value, agencyName = '', onPick, onQuickAdd }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selected = value ? (agencies || []).find(a => a.id === value) : null
  const selectedName = selected?.name || agencyName

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qd = q.replace(/\D/g, '')
    const active = (agencies || []).filter(a => !a.archived)
    if (!q) return active.slice(0, 8)
    return active.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (qd && (a.phone || '').replace(/\D/g, '').includes(qd)) ||
      (a.contactName || '').toLowerCase().includes(q),
    ).slice(0, 8)
  }, [query, agencies])

  const frequent = useMemo(() => {
    const since = formatDate(addDays(new Date(todayStr() + 'T00:00:00'), -90))
    return frequentAgencies(groupReservations, agencies, { sinceDate: since, limit: 5 })
      .filter(a => a.id !== value)
  }, [groupReservations, agencies, value])

  const pick = (a) => { onPick?.(a); setOpen(false); setQuery('') }

  return (
    <div className="relative">
      <label className="label">旅行社</label>

      {selectedName && !open ? (
        <div className="input flex items-center justify-between !py-2">
          <span className="font-bold text-chicken-brown truncate">{selectedName}</span>
          <button type="button" onClick={() => { setOpen(true); setQuery('') }} className="ml-2 shrink-0 text-xs font-bold text-chicken-red">更換</button>
        </div>
      ) : (
        <input
          className="input"
          placeholder="輸入名稱或電話搜尋…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
      )}

      {open && (!selectedName || query !== '' || true) && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-chicken-brown/15 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-chicken-brown/50">查無符合，請用下方「快速新增旅行社」</div>
          ) : results.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-chicken-cream/60 ${a.id === value ? 'bg-indigo-50' : ''}`}
            >
              <span className="font-bold text-chicken-brown truncate">{a.name}</span>
              {(a.phone || a.contactName) && (
                <span className="shrink-0 text-xs text-chicken-brown/50">{[a.contactName, a.phone].filter(Boolean).join(' · ')}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {frequent.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-bold text-chicken-brown/45">常用</span>
          {frequent.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a)}
              className="rounded-full border border-chicken-brown/15 bg-white px-2.5 py-1 text-[11px] font-bold text-chicken-brown hover:border-chicken-red/40 hover:text-chicken-red"
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      <button type="button" onClick={onQuickAdd} className="mt-1 text-xs font-bold text-chicken-red">＋ 快速新增旅行社</button>
    </div>
  )
}
