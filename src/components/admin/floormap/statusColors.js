// 桌況狀態色彩單一來源（2026-08 收斂，PR：現場桌況圖辨識度＋一鍵到了）。
// 店主反饋：桌況圖上「有訂位」與「用餐中」的底色實測只差不到 1%，忙的時候分不出來；
// 且圖例／抽屜 pill／排程視圖各自寫了一套色碼，四處經常對不上（圖例甚至跟地圖實際填色不一致）。
// 這裡是唯一定義：TableShape（SVG 桌況圖）／OperationsView（圖例）／TableDrawer（狀態 pill）／
// TableScheduleView（排程視圖狀態點）全部從這裡 import，不再各寫一套。
//
// 每個狀態帶兩組色值，服務兩種不同的呈現需求：
//   fill / stroke / text / strokeWidth → SVG 桌況圖大面積淡底＋深字（掃一眼要能辨識，不能刺眼）
//   badge                              → 小面積白字徽章（TableDrawer pill、排程視圖狀態點）需要
//                                         solid、與白字有足夠對比的顏色；直接借用大面積的淡 fill
//                                         會讓白字看不清楚，因此 badge 另外給一個「同色相、加深」
//                                         的版本，仍然源自同一狀態、不是另外發明一套色盤。
//
// 本次只改 reserved / dining（normal・late）/ 團體保留 三個狀態的色值（店主已拍板）：
//   已預訂：灰藍 #eef2f7 → 清楚的淡藍 #d8eaff（邊框轉深藍，好與「用餐中」的暖灰區隔）
//   用餐中：中性灰 #eef0f2 → 暖灰褐 #ded7cc（與已預訂的藍形成冷暖對比，一眼可辨）
//   團體保留：淡靛 #e0e7ff → 淡紫 #e9e4fb（原本的靛藍跟新的訂位藍太像，改紫避免新的混淆）
// vacant／cleaning／blocked／dining 超時色系維持現況，不動。
// ★ 不加任何紋理／斜線——店主明確拍板拿掉（滿場用餐時整片斜線太吵）。

export const STATUS_COLOR = {
  vacant: {
    fill: '#86efac', stroke: '#15803d', strokeWidth: 2, text: '#14532d',
    badge: '#059669', // 可入座：實心綠、最醒目（不動）
  },
  reserved: {
    fill: '#d8eaff', stroke: '#1d4ed8', strokeWidth: 3, text: '#0f2f6b',
    badge: '#1d4ed8', // 已預訂：清楚的淡藍＋深藍邊，邊框加粗到 3px 進一步跟 dining 拉開
  },
  dining: {
    fill: '#ded7cc', stroke: '#8b7f6d', strokeWidth: 2, text: '#423a2d',
    badge: '#6b5f4d', // 用餐中：暖灰褐。badge 用比 stroke 更深的同色相版本，維持白字對比
  },
  cleaning: {
    fill: '#fde68a', stroke: '#d97706', strokeWidth: 2, text: '#92400e',
    badge: '#d97706', // 待清桌：琥珀（不動）
  },
  blocked: {
    fill: '#e5e7eb', stroke: '#9ca3af', strokeWidth: 2, text: '#6b7280',
    badge: '#64748b', // 停用：淡灰（不動；badge 沿用原本較深的 slate-500，避免白字對比不足）
  },
}

// 團體保留（vacant 但今日被團 hold）：改用淡紫，避免與新的訂位藍混淆。
export const GROUP_HOLD_COLOR = {
  fill: '#e9e4fb', stroke: '#7c3aed', strokeWidth: 2.5, text: '#4c2a91',
  badge: '#7c3aed',
}

// dining 用餐階段（僅 dining 狀態時覆蓋 STATUS_COLOR.dining 的 fill/text）：
// normal/late 沿用 dining 基本色（緊迫感改用光暈表達，見 TableShape）；overtime 才轉紅跳出。
export const DINING_STAGE_FILL = {
  normal: STATUS_COLOR.dining.fill,
  late: STATUS_COLOR.dining.fill,
  overtime: '#dc2626',
  'buffer-overtime': '#b91c1c',
}
