// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { toAdminHtml, ADMIN_HTML_PAGES } from '../../vite.config.js'

// 後台「加入主畫面」：/admin、/login 由 build 輸出的靜態 HTML 直接帶後台 manifest，
// 不靠 React 掛載後換連結（Safari 可能在那之前就讀了客人 manifest）。
describe('toAdminHtml', () => {
  const src = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

  it('只換 manifest、App 名稱、標題，其餘不動', () => {
    const out = toAdminHtml(src)
    expect(out).toContain('<link rel="manifest" href="/manifest-admin.webmanifest" />')
    expect(out).toContain('<meta name="apple-mobile-web-app-title" content="雞王後台" />')
    expect(out).toContain('<title>雞王管理後台</title>')
    expect(out).not.toContain('href="/manifest.webmanifest"')
    const strip = (h) => h
      .replace(/<link rel="manifest"[^>]*>/, '')
      .replace(/<meta name="apple-mobile-web-app-title"[^>]*>/, '')
      .replace(/<title>[^<]*<\/title>/, '')
    expect(strip(out)).toBe(strip(src))
  })

  it('index.html 沒有 manifest 連結 → 直接報錯（不悄悄輸出壞的後台頁）', () => {
    expect(() => toAdminHtml('<html><head></head></html>')).toThrow(/manifest/)
  })

  it('輸出 admin、login 兩頁', () => {
    expect(ADMIN_HTML_PAGES).toEqual(['admin', 'login'])
  })
})
