// 訂位狀態／來源的顯示字典。BookingCard、BookingDetailSheet、CustomerDetailModal 共用。
// 狀態色採品牌語義：待確認=琥珀(需處理) / 待到=綠(已就緒) / 用餐中=橙(進行中)
// 文字皆採深色確保可讀（不用低對比的純品牌色當文字）
export const STATUS_MAP = {
  pending:   { label: '待確認', color: 'bg-amber-100 text-amber-800' },
  confirmed: { label: '待到',  color: 'bg-emerald-50 text-emerald-700' },
  arrived:   { label: '用餐中', color: 'bg-orange-100 text-orange-700' },
  completed: { label: '已離', color: 'bg-chicken-brown/10 text-chicken-brown/50' },
  noshow:    { label: 'No-show', color: 'bg-chicken-red text-white' },
  cancelled: { label: '已取消', color: 'bg-chicken-brown/5 text-chicken-brown/40' },
}

export const SOURCE_MAP = {
  online: '線上',
  phone:  '電話',
  walkin: '現場',
  group:  '團體',
  line:   'LINE',
}

export function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 「9/11 12:30」：詳情頁的時間軸用（含日期，跨日的建立/修改時間才讀得出來）
export function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(iso)}`
}
