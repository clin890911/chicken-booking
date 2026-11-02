// 現場左欄「今日」籤（方案 A，2026-11）：原「今日訂位」「團體」兩籤併成一條時間清單。
// 籤的 accessible name＝「今日」＋徽章數字（例如「今日3」），用錨定的 regex 避免誤中「＋ 新增今日訂位」等按鈕。
export const todayTab = (page) => page.getByRole('button', { name: /^今日\s*(\d+|99\+)?$/ })

// 打開某團（某梯）的團體梯次列：切到「今日」→ 用搜尋框篩出該團（不論落在哪個區段、收合與否都會列出）
// → 列還沒展開才點（點已展開的列會收起）。nth：同一團多梯時第幾列（依清單順序）。
export async function openGroupRow(page, agencyName, { nth = 0 } = {}) {
  await todayTab(page).click()
  await page.getByLabel('搜尋今日訂位').fill(agencyName)
  const header = page.locator('[data-group-batch]').filter({ hasText: agencyName }).nth(nth).locator('> button[aria-expanded]')
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
  return page.locator('[data-group-batch]').filter({ hasText: agencyName }).nth(nth)
}
