// 今日團體「現場帶位」純函式：拿 groupReservations 與桌況 (tables) 對照，
// 判斷梯次入座狀態、桌位的下一梯、今日 hold 桌對應。
// 只依賴傳入參數、不碰 service 狀態，方便單測與跨元件共用
// （OperationsView 地圖標記、OpsRail 今日團體籤、TableDrawer 團體操作區共用同一口徑）。
import { isTableUsableOnDate } from './tableAvailability'
import { todayStr } from './timeSlots'

// 依時段排序梯次（時段缺失排最後）；回傳新陣列不動原資料
export function sortedBatches(group) {
  return [...(group?.batches || [])].sort((a, b) =>
    String(a.timeSlot || '99:99').localeCompare(String(b.timeSlot || '99:99')))
}

const firstSlot = (g) => String(sortedBatches(g)[0]?.timeSlot || '99:99')
const byFirstSlot = (a, b) => firstSlot(a).localeCompare(firstSlot(b))

// 今日進行中團體（排除已取消「與已完成」），依最早梯次時段排序。
// 已完成的團不得再出現在可操作清單（曾因漏濾 completed 導致側欄可重複入座）。
export function todayActiveGroups(groupReservations, today) {
  return (groupReservations || [])
    .filter(g => g.date === today && !['cancelled', 'completed'].includes(g.status))
    .sort(byFirstSlot)
}

// 側欄渲染口徑：active 可操作；completed 仍要渲染「已完成」區塊（灰階、可印回傳單）。
export function todayGroupsByState(groupReservations, today) {
  const all = (groupReservations || [])
    .filter(g => g.date === today && g.status !== 'cancelled')
    .sort(byFirstSlot)
  return {
    active: all.filter(g => g.status !== 'completed'),
    completed: all.filter(g => g.status === 'completed'),
  }
}

// 某梯次是否已入座：其桌至少一張為 dining 且 currentRef 指向此梯次
export function batchSeated(group, batch, tableByNumber) {
  return (batch?.tableNumbers || []).some(n => {
    const t = tableByNumber[n]
    return !!t && t.status === 'dining'
      && t.currentRef?.groupId === group.id && t.currentRef?.batchId === batch.id
  })
}

// 某梯次是否「進行中」：任一桌（dining 或 cleaning）的 currentRef 指向此梯次。
// 與 batchSeated 不同：逐桌離席／逐桌清桌後，梯次可能只剩部分桌在用餐或待清——
// 只要還有一張桌指向它，這一梯就還沒跑完，它圈的「已清空」桌不可再被畫回團保（S2）。
// 掃全部桌而非只看 batch.tableNumbers：換桌／加桌後兩者應一致，但以桌況為準最穩。
export function batchInProgress(group, batch, tableByNumber) {
  if (!group || !batch) return false
  return Object.values(tableByNumber || {}).some(t =>
    !!t && ['dining', 'cleaning'].includes(t.status)
    && t.currentRef?.groupId === group.id && t.currentRef?.batchId === batch.id)
}

// 清桌中的團體桌「接下一梯」：同團依時段排序，從 afterBatchId 的下一個梯次開始，
// 找第一個「圈了此桌、且尚未入座」的梯次。afterBatchId 通常取 table.currentRef.batchId
// （離席後 currentRef 保留，正是剛用完的那一梯）；找不到該梯時退回從頭掃。
// ★ 下一梯「已在別桌入座」不跳過：逐桌離席後常見「第二梯已接上 102、101 第一梯才剛吃完」，
//   101 清完當然要能接第二梯（101 本來就在第二梯圈桌內）。只有「這張桌已經坐著這一梯」才跳過。
export function nextBatchForTable(group, tableNumber, tableByNumber, afterBatchId) {
  if (!group || ['cancelled', 'completed'].includes(group.status)) return null
  const batches = sortedBatches(group)
  const fromIdx = afterBatchId ? batches.findIndex(b => b.id === afterBatchId) + 1 : 0
  const t = tableByNumber?.[tableNumber]
  for (let i = Math.max(0, fromIdx); i < batches.length; i++) {
    const b = batches[i]
    if (b.releasedAt) continue // 已清桌釋出的梯不可再接（消化過的梯不得重跑）
    const alreadyHere = !!t && t.status === 'dining' && t.currentRef?.groupId === group.id && t.currentRef?.batchId === b.id
    if ((b.tableNumbers || []).includes(tableNumber) && !alreadyHere) return b
  }
  return null
}

// 改派桌位候選：被佔桌 fromTable 的替代桌清單。
// 條件：啟用中空桌、不在本梯已圈桌內、未被其他團體 hold（本團自己的 hold 可以選——
// 例如把第一梯的桌讓給第二梯屬正常調度）。排序：容量最接近原桌 → 同樓層優先 → 桌號。
export function reseatCandidateTables({ tables, holds, group, batch, fromTable }) {
  const batchNums = (batch?.tableNumbers || []).map(String)
  const fromCap = Number(fromTable?.capacity) || 0
  const fromFloor = fromTable?.floor
  return (tables || [])
    .filter(t =>
      isTableUsableOnDate(t, todayStr()) && t.status === 'vacant'
      && !batchNums.includes(String(t.number))
      && !((holds?.[t.number]?.holds) || []).some(h => h.group.id !== group?.id))
    .sort((a, b) =>
      (Math.abs(a.capacity - fromCap) - Math.abs(b.capacity - fromCap))
      || ((a.floor === fromFloor ? 0 : 1) - (b.floor === fromFloor ? 0 : 1))
      || String(a.number).localeCompare(String(b.number)))
}

// 今日團體 hold 對應：桌號 → { agencyName, holds: [{ group, batch }, ...] }
// 涵蓋「有效團體（非取消/完成）圈到、且目前非用餐中」的桌——與地圖 🚌 標記同口徑；
// holds 只列尚未開始的梯次（沒有任何桌指向它，見 batchInProgress；依時段先後），給桌位抽屜顯示與「梯次入座」按鈕用。
export function buildGroupHolds(groups, tables) {
  const tableByNumber = {}
  ;(tables || []).forEach(t => { tableByNumber[t.number] = t })
  const map = {}
  ;(groups || [])
    .filter(g => !['cancelled', 'completed'].includes(g.status))
    .forEach(g => {
      sortedBatches(g).forEach(b => {
        // 已清桌釋出的梯不再 hold 桌：桌位痕跡已清空，沒有這個檢查，
        // 釋出後的桌會被畫回「團保」、按鈕也會復活（梯次永遠看起來「尚未入座」）。
        if (b.releasedAt) return
        ;(b.tableNumbers || []).forEach(n => {
          const t = tableByNumber[n]
          if (!t || t.status === 'dining') return
          if (!map[n]) map[n] = { agencyName: g.agencyName, holds: [] }
          // 進行中（任一桌 dining/cleaning 指向此梯）就不算團保：逐桌清桌後清空的那張桌
          // 不可被畫回「團保」（S2）。下一梯若也圈這張桌，下一梯自己尚未開始 → 照常 hold。
          if (!batchInProgress(g, b, tableByNumber)) map[n].holds.push({ group: g, batch: b })
        })
      })
    })
  Object.values(map).forEach(v => {
    v.holds.sort((a, b) => String(a.batch.timeSlot || '99:99').localeCompare(String(b.batch.timeSlot || '99:99')))
    if (v.holds.length) v.agencyName = v.holds[0].group.agencyName
  })
  return map
}
