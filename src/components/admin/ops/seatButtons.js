// 入座相關按鈕的「1 主 1 次」（C 包，2026-11-27 docs/ux-review-seating-20261127 code-map §5）。
// 收斂前：帶位面板紅底 60px、報到列雞王綠膠囊、今日卡綠 rounded-md、選桌橫幅白底跟模式色、抽屜 btn-primary 紅、
// 候選名單綠 11px——六種長相。收斂後只剩兩種：
//   SEAT_PRIMARY   主動作（確認入座／到了／帶位確認／指派這類「把客人放上桌」的那一下）：實心綠底白字
//   SEAT_SECONDARY 次動作（取消、改桌、詳情、移除、選別桌…）：白底、2px 髮絲框、深棕字
// 色票沿用既有：綠＝emerald-700（現場「確認即入座」原本就用這一階，白字 5.5:1 過 AA），不新創品牌色。
// 危險動作（取消訂位、No-show、強制釋出）不走這裡，維持各自的紅色語意。
// SEAT_RISK：主鈕的「警示態」——確認後會解除別組排位或佔團體桌（玫瑰紅），只在勾了 RiskAck 之後才按得到。
// 尺寸由呼叫端再加（min-h-[56px] text-lg 等）；這裡只管顏色、字重、圓角、狀態，所以 min-h-[44px] 是下限。
// 停用態一律灰底灰字（不是半透明的主色）：淡粉紅／淡綠的停用鈕看起來像錯誤或像還能按（walkthrough #16）。
const BASE = 'tap inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-xl font-bold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chicken-brown disabled:cursor-not-allowed'

export const SEAT_PRIMARY = `${BASE} bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 disabled:bg-chicken-brown/10 disabled:text-chicken-brown/45 disabled:shadow-none`

export const SEAT_SECONDARY = `${BASE} bg-white border-2 border-chicken-brown/20 text-chicken-brown hover:bg-chicken-brown/[0.04] disabled:opacity-40`

// 疊在 SEAT_PRIMARY 後面用（important：蓋過主色；停用時仍回灰）
export const SEAT_RISK = '!bg-rose-600 hover:!bg-rose-700 disabled:!bg-chicken-brown/10'
