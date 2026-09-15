import Icon from '../../ui/Icon'

// GroupEditorSummary：編輯器右側「這張團單現在長怎樣」摘要卡 + 檢查清單。
// 純呈現：所有判斷都在 GroupEditorStage 算好傳進來（檢查清單逐條對應
// groupReservationService.validateGroupForSave 的規則，才不會出現「清單全綠但存檔被擋」）。
//
// check 三態：ok（綠勾）／bad（紅點＋原因，填了但不合法）／todo（灰點，還沒填）。
export function CheckList({ checks = [], className = '' }) {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {checks.map(c => {
        const tone = c.bad ? 'bad' : c.ok ? 'ok' : 'todo'
        const dot = tone === 'bad'
          ? 'bg-chicken-red text-white'
          : tone === 'ok' ? 'bg-[#5b8c1f] text-white' : 'bg-chicken-brown/15 text-transparent'
        const text = tone === 'bad' ? 'text-chicken-red' : tone === 'ok' ? 'text-chicken-brown' : 'text-chicken-brown/50'
        return (
          <li key={c.key} className={`flex items-start gap-2 text-xs font-semibold ${text}`}>
            <span className={`mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${dot}`}>
              {tone === 'bad' ? '!' : tone === 'ok' ? <Icon name="check" size={10} strokeWidth={3.2} /> : '·'}
            </span>
            <span className="min-w-0">
              {c.label}
              {tone !== 'ok' && c.reason && <span className="block font-medium text-chicken-brown/55">{c.reason}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default function GroupEditorSummary({
  agencyName, guideName, guidePhone,
  dateLabel, seatingLabel, batchCount,
  total, specialsText, tableNumbers = [], escortTables = [],
  heldSeats, checks = [], children,
}) {
  const overSeats = total > 0 && heldSeats < total
  const pct = total > 0 ? Math.min(100, Math.round((heldSeats / total) * 100)) : (heldSeats > 0 ? 100 : 0)

  const Row = ({ label, children: v }) => (
    <div className="flex items-start justify-between gap-2 py-1">
      <dt className="shrink-0 text-xs font-semibold text-chicken-brown/50">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-bold text-chicken-brown">{v}</dd>
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-chicken-brown/10 bg-white p-3.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-chicken-brown/40">這張團單</div>
        <div className="mt-0.5 text-base font-bold text-chicken-brown">{agencyName || '尚未選旅行社'}</div>
        <div className="text-xs font-semibold text-chicken-brown/55">
          {guideName || guidePhone ? [guideName, guidePhone].filter(Boolean).join(' · ') : '導遊未填'}
        </div>

        <dl className="mt-2.5 divide-y divide-chicken-brown/[0.08] border-t border-chicken-brown/[0.08] pt-1">
          <Row label="日期">{dateLabel}</Row>
          <Row label="場次">{seatingLabel || '—'}{batchCount > 1 ? ` · ${batchCount} 梯` : ''}</Row>
          <Row label="人數">{total > 0 ? `${total} 人` : '—'}</Row>
          <Row label="特殊需求">{specialsText || '無'}</Row>
          <Row label="桌號">
            {tableNumbers.length ? tableNumbers.join('、') : '—'}
            {escortTables.length > 0 && <span className="block font-medium text-chicken-brown/55">司領桌 {escortTables.join('、')}</span>}
          </Row>
        </dl>

        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span className="text-chicken-brown/50">席位（總人數 / 已圈席位）</span>
            <span className={`tabular-nums ${overSeats ? 'text-chicken-red' : 'text-chicken-brown'}`}>{total} / {heldSeats}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-chicken-brown/10">
            <div className={`h-2 rounded-full transition-all ${overSeats ? 'bg-chicken-red' : 'bg-[#5b8c1f]'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-chicken-brown/10 bg-white p-3.5">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-chicken-brown/40">存檔前檢查</div>
        <CheckList checks={checks} />
      </div>

      {children}
    </div>
  )
}
