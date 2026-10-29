import { test, expect } from '@playwright/test'
test.use({ baseURL: 'http://localhost:5288', launchOptions: { executablePath: '/opt/pw-browsers/chromium' } })
async function install(page) {
  const cdp = await page.context().newCDPSession(page)
  const errs = await cdp.send('Page.getInstallabilityErrors')
  const man = await cdp.send('Page.getAppManifest')
  return { errs: errs.installabilityErrors.map(e => e.errorId), url: man.url, errors: man.errors }
}
test('pwa', async ({ page }) => {
  await page.route(/\/admin[A-Z]/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' }))
  await page.goto('/')
  await page.waitForTimeout(1500)
  console.log('HOME', JSON.stringify(await install(page)))
  await page.goto('/login')
  await page.waitForTimeout(1500)
  console.log('LOGIN', JSON.stringify(await install(page)))
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.waitForTimeout(1500)
  console.log('ADMIN', JSON.stringify(await install(page)))
  console.log('TITLE', await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'))
  for (const p of ['/manifest-admin.webmanifest', '/icons/icon-512.png']) {
    const r = await page.request.get(p); console.log('GET', p, r.status(), r.headers()['content-type'])
  }
})
