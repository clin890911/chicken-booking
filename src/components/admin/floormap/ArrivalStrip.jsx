// 報到列（2026-08 三版）。
// 一版：疊在桌況圖上的「✓ 到了」浮動鈕——相鄰兩桌同時進窗時鈕會互相完全遮擋，點下去會
//   誤觸把不相干的訂位標記入座（獨立驗收抓到）。
// 二版：搬到地圖下方的 in-flow 橫向列，物理上不再疊到桌況圖或彼此，但驗收又抓到新問題：
//   chip 一多（6 筆時 scrollWidth 遠大於 clientWidth）超過一半內容捲出畫面外，
//   卻沒有任何「還有更多」的視覺信號（無漸層、無陰影、無總數），店員忙起來會漏接。
// 三版：加總筆數標籤（「等報到 N」，不管看不看得到都是真實總數）+ 左右緣捲動遮罩
//   （只在真的有內容被捲出去時出現、捲到底就消失）。這兩者都只是視覺提示，
//   不影響 isArriveEligible 判定或排序邏輯——判定/排序邏輯完全沒有改動。
//
// 涵蓋所有樓層（不受目前 1F/2F 切換影響）——客人到店不會管店員正在看哪一頁地圖；
// 點 chip 本體會自動切到該桌所在樓層並開抽屜（沿用 OpsRail 既有的跨樓層 focus 慣例）。
// 三版加碼：跨樓層的 chip 會在桌號前標樓層（例如「2F 201」），讓「點下去會切樓層、
// 打斷正在填的表單」變成可預期；同樓層的桌不標，避免視覺噪音。
import { useState, useEffect, useRef } from 'react'
import { overdueMinOf } from '../../../utils/bookingPulse'
import { isArriveEligible } from './FloorMap'

// 遲到判定沿用 UpcomingPanel/BookingCard 既有口徑（graceMin=15，見 utils/bookingPulse.js）。
const LATE_GRACE_MIN = 15

// ★ 判定與排序邏輯（buildTargets）本版未動——只有下方渲染層加了總數標籤與捲動遮罩。
function buildTargets(tables, bookings, now) {
  const bookingMap = {}
  bookings.forEach(b => { if (b.id) bookingMap[b.id] = b })
  const list = []
  tables.forEach(t => {
    const booking = t.currentBookingId ? bookingMap[t.currentBookingId] : null
    if (isArriveEligible(t, booking, now)) list.push({ table: t, booking })
  })
  // 排序：遲到（已過訂位時間 >15 分）優先，且越晚到的排越前面；其餘依訂位時段由早到晚。
  return list.sort((a, b) => {
    const oa = overdueMinOf(a.booking.timeSlot, now)
    const ob = overdueMinOf(b.booking.timeSlot, now)
    const lateA = oa > LATE_GRACE_MIN
    const lateB = ob > LATE_GRACE_MIN
    if (lateA !== lateB) return lateA ? -1 : 1
    if (lateA && lateB) return ob - oa
    return String(a.booking.timeSlot || '').localeCompare(String(b.booking.timeSlot || ''))
  })
}

export default function ArrivalStrip({ tables, bookings, onSelectTable, onArrive, currentFloor = null, now = null }) {
  const scrollRef = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const [, setTick] = useState(0)
  // 每 30 秒重繪，讓訂位隨時間推移自然進出視窗、遲到標記即時更新（與 UpcomingPanel 同節奏）。
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])
  const effectiveNow = now ?? Date.now()

  const targets = buildTargets(tables || [], bookings || [], effectiveNow)

  // 純視覺：量測捲動容器，決定左右緣遮罩是否顯示。捲到底/捲到頂就自動消失（不是靠計時器關掉）。
  const updateEdge = () => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setEdge({
      left: scrollLeft > 2,
      right: scrollLeft + clientWidth < scrollWidth - 2,
    })
  }
  // chip 數量變動（訂位進出視窗）時內容寬度會變，重新量一次。
  useEffect(() => {
    updateEdge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.length])
  // 視窗尺寸變動（例如 iPad 轉向）容器寬度會變，重新量一次。
  useEffect(() => {
    window.addEventListener('resize', updateEdge)
    return () => window.removeEventListener('resize', updateEdge)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!targets.length) return null

  return (
    <div className="flex-shrink-0 mt-2 pt-2 border-t border-chicken-brown/10">
      <div className="flex items-center px-0.5 mb-1">
        {/* 總筆數：永遠是真實總數，不管畫面上看得到幾顆——店員看到「等報到 6」但只數到
            3 顆，就知道要往右滑，不會被「看起來已經滿版」的錯覺騙走。 */}
        <span className="text-[11px] font-black text-chicken-brown/60">等報到 {targets.length}</span>
      </div>
      <div className="relative">
        {edge.left && (
          <div
            data-edge="left"
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-white via-white/80 to-transparent"
          />
        )}
        <div
          ref={scrollRef}
          role="list"
          aria-label="可入座名單"
          onScroll={updateEdge}
          className="flex items-center gap-2.5 overflow-x-auto overflow-y-hidden pb-1"
        >
          {targets.map(({ table, booking }) => {
            const overdueMin = overdueMinOf(booking.timeSlot, effectiveNow)
            const late = overdueMin > LATE_GRACE_MIN
            // 跨樓層標記：只有桌所在樓層跟目前顯示的樓層不同才標，避免同樓層 chip 多一截視覺噪音。
            const crossFloor = currentFloor != null && table.floor !== currentFloor
            return (
              <div
                key={table.number}
                role="listitem"
                onClick={() => onSelectTable(table.number)}
                className={`flex items-center gap-2 shrink-0 cursor-pointer rounded-full border-2 pl-3 pr-1.5 py-1 transition-colors
                  ${late ? 'bg-chicken-red/5 border-chicken-red/40' : 'bg-white border-chicken-brown/15 hover:border-chicken-brown/30'}`}
              >
                <span className={`tabular-nums text-xs font-black ${late ? 'text-chicken-red' : 'text-chicken-brown'}`}>
                  {booking.timeSlot}
                </span>
                <span className="text-sm font-bold text-chicken-brown truncate max-w-[7rem]">{booking.name}</span>
                <span
                  className={`text-[11px] font-bold ${crossFloor ? 'text-chicken-brown/70' : 'text-chicken-brown/50'}`}
                  title={crossFloor ? `此桌在 ${table.floor}，點選會自動切換樓層` : undefined}
                >
                  {crossFloor ? `${table.floor} ${table.number}` : table.number}
                </span>
                {late && (
                  <span className="text-[10px] font-black text-white bg-chicken-red px-1.5 py-0.5 rounded-full shrink-0">
                    遲到
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onArrive(table, booking) }}
                  aria-label={`${booking.name} 到了，入座 ${table.number}`}
                  className="rounded-full bg-chicken-green text-white text-xs font-black shrink-0
                             hover:opacity-90 focus-visible:outline focus-visible:outline-2
                             focus-visible:outline-offset-2 focus-visible:outline-chicken-red
                             motion-safe:transition-transform motion-safe:active:scale-95"
                  style={{ height: 44, minWidth: 44, paddingLeft: 12, paddingRight: 12 }}
                >
                  ✓ 到了
                </button>
              </div>
            )
          })}
        </div>
        {edge.right && (
          <div
            data-edge="right"
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-white via-white/80 to-transparent"
          />
        )}
      </div>
    </div>
  )
}
