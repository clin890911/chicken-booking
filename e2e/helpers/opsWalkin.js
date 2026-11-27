import { expect } from '@playwright/test'

// 現場帶位面板的人數載入時是「未選」（C 包驗收 F7，與入座後歸零一致；確認鈕寫「先選人數」）。
// 這些既有測試寫在「預選 2 位」的年代、測的也不是人數：進現場頁後補點 2 位，還原當時的前提。
// 要測「未選」本身的測試（seat-ux-c1／seat-ux-cfix）不要呼叫這支。
export async function pickDefaultWalkinGuests(page, n = 2) {
  await expect(page.getByTestId('walkin-seat')).toBeVisible()
  await page.getByRole('button', { name: `${n} 位`, exact: true }).click()
  await expect(page.getByRole('button', { name: `${n} 位`, exact: true })).toHaveAttribute('aria-pressed', 'true')
}
