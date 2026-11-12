import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseAttribution, captureAttribution, readAttribution, clearAttribution, cleanAttribution, formatAttribution,
  ATTRIBUTION_LANDING_PATHS,
} from '../../src/utils/adAttribution'
import { sanitizeAttribution } from '../../functions/lib/attribution'

beforeEach(() => { sessionStorage.clear() })

describe('adAttribution 前端追蹤碼', () => {
  it('讀 utm_source/campaign/content 與 fbclid，其他參數忽略', () => {
    expect(parseAttribution('?utm_source=fb&utm_campaign=shanyou&utm_content=B-shanxia&fbclid=IwAR1&utm_medium=paid&x=1'))
      .toEqual({ source: 'fb', campaign: 'shanyou', content: 'B-shanxia', fbclid: 'IwAR1' })
    expect(parseAttribution('?utm_campaign=%E5%B1%B1%E5%8F%8B')).toEqual({ campaign: '山友' })
    expect(parseAttribution('')).toBeNull()
    expect(parseAttribution('?utm_source=&utm_campaign=%20')).toBeNull()
  })
  it('落地記進 sessionStorage；之後沒帶參數的頁面（首頁→/book）不會洗掉', () => {
    captureAttribution('?utm_source=fb&utm_campaign=shanyou&utm_content=D-shanxia')
    expect(captureAttribution('')).toEqual({ source: 'fb', campaign: 'shanyou', content: 'D-shanxia' })
    expect(readAttribution()).toEqual({ source: 'fb', campaign: 'shanyou', content: 'D-shanxia' })
  })
  it('再點另一則廣告（新參數）以最後一次為準', () => {
    captureAttribution('?utm_source=fb&utm_campaign=shanyou&utm_content=B-shanxia&fbclid=A')
    captureAttribution('?utm_source=fb&utm_campaign=shanyou&utm_content=D-shanxia')
    expect(readAttribution()).toEqual({ source: 'fb', campaign: 'shanyou', content: 'D-shanxia' })
  })
  it('限長 100、去控制字元；壞掉的儲存內容回 null', () => {
    const long = 'a'.repeat(300)
    expect(parseAttribution(`?utm_content=${long}`).content).toHaveLength(100)
    expect(cleanAttribution({ campaign: 'x\u0000y\n', content: { evil: 1 }, other: 'z' })).toEqual({ campaign: 'xy' })
    sessionStorage.setItem('chicken_ad_attribution_v1', '{bad json')
    expect(readAttribution()).toBeNull()
    clearAttribution(); expect(readAttribution()).toBeNull()
  })
  it('只在首頁與 /book 記錄', () => {
    expect(ATTRIBUTION_LANDING_PATHS).toEqual(['/', '/book'])
  })
  it('前端清洗與後端 sanitizeAttribution 同規則', () => {
    const samples = [
      { source: 'fb', campaign: 'shanyou', content: 'B-shanxia', fbclid: 'IwAR1' },
      { campaign: ` ${'山'.repeat(150)} `, content: 123, fbclid: true },
      { source: null, campaign: ['a'], content: '\u0007' },
      'not-an-object', null, ['x'],
    ]
    for (const s of samples) expect(cleanAttribution(s)).toEqual(sanitizeAttribution(s))
  })
})

describe('formatAttribution（CSV 廣告來源）', () => {
  it('campaign/content；缺一個就只放有的；都沒有退回 source，再沒有但有 fbclid 標 fb', () => {
    expect(formatAttribution({ source: 'fb', campaign: 'shanyou', content: 'B-shanxia' })).toBe('shanyou/B-shanxia')
    expect(formatAttribution({ campaign: 'shanyou' })).toBe('shanyou')
    expect(formatAttribution({ source: 'ig' })).toBe('ig')
    expect(formatAttribution({ fbclid: 'IwAR1' })).toBe('fb')
    expect(formatAttribution(undefined)).toBe('')
  })
  it('試算表公式注入防護', () => {
    expect(formatAttribution({ campaign: '=HYPERLINK("x")' })).toBe('\'=HYPERLINK("x")')
    expect(formatAttribution({ content: '-1+1' })).toBe("'-1+1")
  })
})
