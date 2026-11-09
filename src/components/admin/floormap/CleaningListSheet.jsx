import { Brush } from 'lucide-react'
import { Modal } from '../../ui'

// 頂列「待清 N」展開的清單（D5）：每桌一顆「清桌完成」＋最下方「全部清桌（N）」。
// 尖峰一次散場 5 桌：點「待清」→「全部清桌」＝2 下（原本每桌開抽屜再按清桌＝10 下）。
// 清完的 toast 帶「復原清桌」（全部倒回待清；被下一組用掉的那張安全失敗），由呼叫端 clearTablesWithUndo 處理。
// 團體桌：角色不能寫團單時不給清（會寫 releasedAt／結團），寫明要點桌處理。
export default function CleaningListSheet({ open, onClose, tables = [], bookings = [], groupReservations = [], canGroup = true, onClear, onOpenTable }) {
  const whoOf = (t) => {
    if (t.currentRef?.type === 'group') {
      const g = groupReservations.find(x => x.id === t.currentRef.groupId)
      return `團體${g?.agencyName ? ` ${g.agencyName}` : ''}`
    }
    const b = t.currentBookingId ? bookings.find(x => String(x.id) === String(t.currentBookingId)) : null
    return b?.name ? `${b.name} 已離席` : '上一組已離席'
  }
  const clearable = tables.filter(t => canGroup || t.currentRef?.type !== 'group')
  return (
    <Modal open={open} onClose={onClose} title={`待清桌 ${tables.length} 桌`} size="sm">
      <ul aria-label="待清桌清單" className="flex flex-col gap-2">
        {tables.map(t => {
          const blocked = !canGroup && t.currentRef?.type === 'group'
          return (
            <li key={t.number} className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-3 py-2">
              <Brush size={18} aria-hidden className="flex-none text-amber-700" />
              <button
                type="button"
                onClick={() => onOpenTable?.(t.number)}
                className="flex-1 min-w-0 text-left min-h-[44px]"
                aria-label={`${t.number} 詳情`}
              >
                <span className="block text-lg font-bold tabular-nums text-chicken-brown leading-tight">{t.number}</span>
                <span className="block text-sm text-chicken-brown/70 truncate">{t.floor ? `${t.floor} · ` : ''}{whoOf(t)}</span>
              </button>
              {blocked ? (
                <span className="flex-none text-xs text-chicken-brown/60">團體桌請點桌處理</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onClear?.([t])}
                  aria-label={`清桌完成 ${t.number}`}
                  className="flex-none min-h-[44px] px-4 rounded-xl bg-chicken-brown text-white text-sm font-bold active:scale-95"
                >清桌完成</button>
              )}
            </li>
          )
        })}
      </ul>
      {clearable.length > 1 && (
        <button
          type="button"
          onClick={() => onClear?.(clearable)}
          className="btn-primary w-full mt-4 min-h-[48px]"
        >全部清桌（{clearable.length}）</button>
      )}
    </Modal>
  )
}
