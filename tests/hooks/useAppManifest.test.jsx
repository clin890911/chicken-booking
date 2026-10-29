import { describe, it, expect, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useAdminAppManifest, isStandaloneApp } from '../../src/hooks/useAppManifest'

// 「加入主畫面」：後台／登入頁換成後台 manifest（開啟＝/admin、名稱「雞王後台」），離開換回客人版
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Probe() { useAdminAppManifest(); return null }

describe('useAdminAppManifest', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title" content="雞王訂位">'
  })

  it('掛載時換成後台 manifest 與名稱，卸載時換回', () => {
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() => root.render(<Probe />))
    expect(document.querySelector('link[rel="manifest"]').getAttribute('href')).toBe('/manifest-admin.webmanifest')
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content')).toBe('雞王後台')
    act(() => root.unmount())
    expect(document.querySelector('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest')
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content')).toBe('雞王訂位')
  })

  it('isStandaloneApp：一般瀏覽器分頁回 false', () => {
    expect(isStandaloneApp()).toBe(false)
  })
})
