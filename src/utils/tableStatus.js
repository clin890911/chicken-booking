// 桌位狀態中文對照：錯誤訊息與 UI 顯示共用，避免英文狀態（dining…）直接噴給店員。
export const STATUS_ZH = {
  vacant: '空桌',
  reserved: '已預訂',
  dining: '用餐中',
  cleaning: '清桌中',
  blocked: '不可用',
}

export function statusZh(status) {
  return STATUS_ZH[status] || status
}
