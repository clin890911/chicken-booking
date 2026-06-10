// 訂位頁的唯讀團體梯次摘要卡：讓店員在散客清單中同框看到團體佔位（判斷時段用餐狀況）。
// 冷色 indigo 與散客暖色卡區分（對齊排位地圖「團客=冷色 #4f46e5」的視覺語言）。
// 點擊跳轉規劃分頁該團單詳情；編輯/回傳單都在那裡。
const STATUS_LABEL = {
  planned: { label: '已預排', cls: 'bg-chicken-brown/10 text-chicken-brown' },
  confirmed: { label: '已確認', cls: 'bg-chicken-yellow/15 text-chicken-yellow' },
  arrived: { label: '已到店', cls: 'bg-chicken-green/15 text-chicken-green' },
  completed: { label: '已完成', cls: 'bg-chicken-brown text-white' },
  cancelled: { label: '已取消', cls: 'bg-chicken-red/10 text-chicken-red' },
}

export default function GroupBatchCard({ group, batch, onOpen }) {
  const st = STATUS_LABEL[group.status] || STATUS_LABEL.planned
  const nums = (batch?.tableNumbers || []).map(String)
  // 單梯人數 = 團單總人數（與編輯器口徑一致）；多梯用各梯拆批值
  const guests = (group.batches || []).length === 1
    ? (Number(group.counts?.total) || 0)
    : (Number(batch?.guests) || 0)
  return (
    <button
      onClick={() => onOpen?.(group)}
      className="w-full text-left rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-3.5 hover:border-indigo-400 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <span className="text-lg font-black text-indigo-700 tabular-nums">{batch?.timeSlot || '未排'}</span>
          <span className="text-base font-bold text-chicken-brown truncate">🚌 {group.agencyName || '團體'}</span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{batch?.label || '梯次'}</span>
        </div>
        <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
      </div>
      <div className="mt-1 text-xs text-chicken-brown/70 flex items-center gap-2 flex-wrap">
        <span className="font-bold tabular-nums">{guests} 位</span>
        <span className="tabular-nums">🪑 {nums.length > 0 ? `桌 ${nums.join('、')}` : '未圈桌'}</span>
        {group.guideName && <span className="text-chicken-brown/50">導遊 {group.guideName}</span>}
        <span className="text-indigo-600/70 font-bold ml-auto">點擊開團單 ›</span>
      </div>
    </button>
  )
}
