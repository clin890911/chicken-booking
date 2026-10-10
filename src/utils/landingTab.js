// 檔名刻意不以 admin 開頭：E2E 會用 page.route('**/admin*') 攔後端端點，同名的前端模組會被誤攔。
// 後台分頁落點：網址沒有（或給了無效的）?tab= 時落在哪一頁。
// 外場（floor）、領位（host）一上工就是帶位／報到 → 直接落在「現場」；
// 其他角色（店長、廚房…）維持過去的「訂位」。網址有明確且有效的 ?tab= 一律照網址。
const OPS_FIRST_ROLES = ['floor', 'host']

export function resolveAdminTab(rawTab, role, validTabs) {
  if (validTabs.includes(rawTab)) return rawTab
  return OPS_FIRST_ROLES.includes(role) ? 'ops' : 'bookings'
}
