import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// analytics 在模組載入時讀 VITE_GA4_MEASUREMENT_ID，每個案例重新載入模組。
async function load(id) {
  vi.resetModules()
  vi.stubEnv('VITE_GA4_MEASUREMENT_ID', id)
  return import('../../src/services/analytics')
}

const gtagScripts = () => [...document.head.querySelectorAll('script[src*="googletagmanager"]')]

describe('analytics', () => {
  beforeEach(() => {
    delete window.dataLayer
    delete window.gtag
    gtagScripts().forEach(s => s.remove())
  })
  afterEach(() => vi.unstubAllEnvs())

  it('沒設 Measurement ID → 完全不載入、不送', async () => {
    const a = await load('')
    a.trackPageView({ pathname: '/book', search: '' })
    a.trackEvent('booking_complete', {})
    expect(window.dataLayer).toBeUndefined()
    expect(gtagScripts()).toHaveLength(0)
  })

  it('後台頁不載入 gtag', async () => {
    const a = await load('G-TEST123')
    a.trackPageView({ pathname: '/admin', search: '' })
    a.trackEvent('x', {})
    expect(window.dataLayer).toBeUndefined()
    expect(gtagScripts()).toHaveLength(0)
  })

  it('客人頁載入 gtag，關自動 page_view，網址不含 token', async () => {
    const a = await load('G-TEST123')
    a.trackPageView({ pathname: '/confirm/B999', search: '?token=SECRET&utm_source=line' })
    expect(gtagScripts()).toHaveLength(1)
    const calls = window.dataLayer.map(args => [...args])
    const config = calls.find(c => c[0] === 'config')
    expect(config[2].send_page_view).toBe(false)
    expect(config[2].allow_google_signals).toBe(false)
    const pv = calls.find(c => c[0] === 'event' && c[1] === 'page_view')
    expect(pv[2].page_path).toBe('/confirm/:id')
    expect(pv[2].page_location).toContain('utm_source=line')
    expect(JSON.stringify(calls)).not.toContain('SECRET')
    expect(JSON.stringify(calls)).not.toContain('B999')
  })

  it('同一頁重複呼叫只送一次 page_view；換頁帶站內 referrer', async () => {
    const a = await load('G-TEST123')
    a.trackPageView({ pathname: '/book', search: '' })
    a.trackPageView({ pathname: '/book', search: '' })
    a.trackPageView({ pathname: '/confirm/B1', search: '?token=T' })
    const pvs = window.dataLayer.map(args => [...args]).filter(c => c[0] === 'event' && c[1] === 'page_view')
    expect(pvs).toHaveLength(2)
    expect(pvs[1][2].page_referrer).toMatch(/\/book$/)
  })

  it('初始化後自訂事件照送', async () => {
    const a = await load('G-TEST123')
    a.trackPageView({ pathname: '/book', search: '' })
    a.trackEvent('booking_complete', { party_size: 4 })
    const ev = window.dataLayer.map(args => [...args]).find(c => c[1] === 'booking_complete')
    expect(ev[2]).toEqual({ party_size: 4 })
  })
})
