import { describe, it, expect } from 'vitest'
import { validateLineReadiness, isGuestLineReady } from '../../functions/lib/lineReadiness'

const complete = {
  lineLoginChannelId: '1234567890',
  lineLoginStartEndpoint: 'https://lineloginstart-reaor76eyq-uc.a.run.app',
  lineLoginCallbackUrl: 'https://linelogincallback-reaor76eyq-uc.a.run.app',
  publicSiteUrl: 'https://chicken-booking.zeabur.app',
  lineOfficialUrl: 'https://lin.ee/example',
  lineUseLiff: false,
}
describe('LINE readiness fails closed without claiming token or delivery verification', () => {
  it('accepts deployed service URLs and official aliases', () => {
    expect(validateLineReadiness(complete).ready).toBe(true)
    expect(validateLineReadiness({ ...complete,
      lineLoginStartEndpoint: 'https://us-central1-chicken-booking-tw.cloudfunctions.net/lineLoginStart',
      lineLoginCallbackUrl: 'https://us-central1-chicken-booking-tw.cloudfunctions.net/lineLoginCallback',
    }).ready).toBe(true)
  })
  it.each(['lineLoginChannelId', 'lineLoginCallbackUrl', 'lineLoginStartEndpoint', 'publicSiteUrl'])('rejects missing %s even with official friend link', field => {
    const result = validateLineReadiness({ ...complete, [field]: '' })
    expect(result.ready).toBe(false)
    expect(result.issues.some(i => i.field === field)).toBe(true)
  })
  it.each([
    ['lineLoginChannelId', '1234567890-FAKE'],
    ['lineLoginCallbackUrl', 'https://evil.example/lineLoginCallback'],
    ['lineLoginStartEndpoint', 'https://lineloginstart-reaor76eyq-uc.a.run.app.evil.example'],
    ['publicSiteUrl', 'https://chicken-booking.zeabur.app.evil.example'],
    ['publicSiteUrl', 'https://evil@chicken-booking.zeabur.app'],
    ['publicSiteUrl', 'http://chicken-booking.zeabur.app'],
    ['lineLoginCallbackUrl', 'https://linelogincallback-reaor76eyq-uc.a.run.app?redirect=https://evil.example'],
  ])('rejects unsafe or mismatched %s', (field, value) => {
    expect(validateLineReadiness({ ...complete, [field]: value }).ready).toBe(false)
  })
  it('checks enabled LIFF without deriving a Login channel ID from it', () => {
    const liff = { ...complete, lineUseLiff: true, lineLiffId: '1234567890-FAKE', lineLiffUrl: 'https://liff.line.me/1234567890-FAKE' }
    expect(validateLineReadiness(liff).ready).toBe(true)
    expect(validateLineReadiness({ ...liff, lineLiffUrl: 'https://liff.line.me/other' }).ready).toBe(false)
    expect(validateLineReadiness({ ...liff, lineLoginChannelId: '' }).ready).toBe(false)
  })
  it('guest eligibility requires the server readiness boolean, not locally complete fields', () => {
    expect(isGuestLineReady(complete)).toBe(false)
    expect(isGuestLineReady({ lineLoginReady: 'true' })).toBe(false)
    expect(isGuestLineReady({ lineLoginReady: false })).toBe(false)
    expect(isGuestLineReady({ lineLoginReady: true })).toBe(true)
  })
})
