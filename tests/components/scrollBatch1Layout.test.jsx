import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 頁面捲動第 1 批（2026-10-30）的版面約定：名冊 lg 2 欄＋觸控 44px、顧客卡動作橫排＋「⋯ 更多」、備餐重點 0 的列不顯示。
// 實際省下的 px 由 Playwright 量測（PR 描述附前後表），這裡守住結構不被改回去。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => actual.PERMISSIONS.manager.has(p), user: { email: 'x@test' } }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }), useConfirm: () => vi.fn(async () => true) }))

const CustomersView = (await import('../../src/components/admin/roster/CustomersView')).default
const AgencyDirectoryView = (await import('../../src/components/admin/roster/AgencyDirectoryView')).default
const GroupPrepDigest = (await import('../../src/components/admin/planning/GroupPrepDigest')).default

let container, root
const mount = (el) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(el) })
}
afterEach(() => { act(() => root?.unmount()); container?.remove() })
const cardOf = (name) => [...container.querySelectorAll('.card')].find(c => c.textContent.includes(name) && c.querySelector('details'))
const inCard = (card, t) => [...card.querySelectorAll('button')].find(b => b.textContent.trim() === t)
const btn = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === t)

describe('名冊', () => {
  beforeEach(() => {
    Object.assign(ctx, {
      customers: [
        { phone: '0911000111', name: '王小明', visits: 3, totalGuests: 9, lastVisit: '2026-09-01', vipTier: 'none', blacklisted: false, archived: false },
        { phone: '0911000222', name: '陳小華', visits: 1, totalGuests: 2, lastVisit: '2026-09-02', vipTier: 'gold', blacklisted: true, archived: false },
      ],
      bookings: [], updateCustomer: vi.fn(), setCustomerBlacklist: vi.fn(), setCustomerVip: vi.fn(),
      agencies: [{ id: 'A1', name: '快樂旅行社', phone: '02-1234', contactName: '王', lineId: '', note: '' }, { id: 'A2', name: '山水旅行社', phone: '', contactName: '', lineId: '', note: '' }],
      guides: [], groupReservations: [],
      addAgency: vi.fn(), updateAgency: vi.fn(), archiveAgency: vi.fn(), addGuide: vi.fn(), updateGuide: vi.fn(), archiveGuide: vi.fn(),
    })
  })

  it('顧客：lg 以上 2 欄；動作橫排（第一層只有 編輯＋⋯ 更多），黑名單／歸檔收進更多選單；全部 ≥44px', () => {
    mount(<CustomersView onAddBooking={vi.fn()} />)
    const card = cardOf('王小明')
    expect(card.parentElement.className).toContain('lg:grid-cols-2')
    expect(card.parentElement.children).toHaveLength(2)
    const edit = inCard(card, '編輯')
    const actions = edit.parentElement
    expect(actions.className).not.toContain('flex-col')
    const more = actions.querySelector('details[data-popover] > summary')
    expect(more.textContent).toContain('更多')
    expect(more.getAttribute('aria-label')).toBe('王小明 更多操作')
    for (const t of ['加黑名單', '歸檔', '解除黑名單']) expect(btn(t).closest('details[data-popover]'), t).toBeTruthy()
    for (const el of [edit, more, inCard(card, '加黑名單'), inCard(card, '歸檔')]) expect(el.className).toContain('min-h-[44px]')
  })

  it('顧客：更多選單裡的「加黑名單」照舊開黑名單原因視窗、「歸檔」照舊寫入', () => {
    mount(<CustomersView onAddBooking={vi.fn()} />)
    const card = cardOf('王小明')
    act(() => { inCard(card, '歸檔').click() })
    expect(ctx.updateCustomer).toHaveBeenCalledWith('0911000111', { archived: true })
    act(() => { inCard(card, '加黑名單').click() })
    expect(document.body.textContent).toContain('王小明')
    expect(ctx.setCustomerBlacklist).not.toHaveBeenCalled() // 先填原因，不直接寫
  })

  it('旅行社：lg 以上 2 欄；編輯／封存 ≥44px', () => {
    mount(<AgencyDirectoryView onGoPlanning={vi.fn()} />)
    const edits = [...container.querySelectorAll('button')].filter(b => b.textContent.trim() === '編輯')
    expect(edits).toHaveLength(2)
    const grid = edits[0].closest('.grid')
    expect(grid.className).toContain('lg:grid-cols-2')
    expect(grid.children).toHaveLength(2)
    for (const b of [...container.querySelectorAll('button')].filter(b => ['編輯', '封存'].includes(b.textContent.trim()))) {
      expect(b.className).toContain('min-h-[44px]')
      expect(b.className).not.toContain('py-1')
    }
  })
})

describe('備餐重點：數量為 0 的列不顯示', () => {
  const prep = (over = {}) => ({
    groupCount: 2,
    counts: { total: 35, vegetarian: 3, child: 0, mobility: 0, wheelchair: 0 },
    allergies: [], tableSideNeeds: [], buses: [],
    byGroup: [{ id: 'G1', agencyName: '好運旅行社', firstTimeSlot: '11:30', tableNumbers: ['201'], counts: { vegetarian: 3 } }],
    ...over,
  })
  const labels = () => [...container.querySelectorAll('button[aria-expanded]')].map(b => b.textContent)

  it('只列出有數量的需求（素食 3），其餘 0 的列（兒童／行動不便／輪椅／過敏／桌邊／遊覽車）不出現', () => {
    mount(<GroupPrepDigest prep={prep()} />)
    const ls = labels()
    expect(ls).toHaveLength(1)
    expect(ls[0]).toContain('素食')
    for (const t of ['兒童', '行動不便', '輪椅', '過敏', '桌邊', '遊覽車']) expect(container.textContent, t).not.toContain(t)
    expect(container.querySelector('[data-testid="prep-none"]')).toBeNull()
    // 預設展開素食，看得到哪一團
    expect(container.textContent).toContain('好運旅行社')
  })

  it('過敏／遊覽車有內容就照常顯示、可展開', () => {
    mount(<GroupPrepDigest prep={prep({ allergies: [{ agencyName: '好運旅行社', text: '兩位海鮮過敏' }], buses: [{ agencyName: '好運旅行社', busInfo: '1 台' }] })} />)
    expect(labels().map(t => t.replace(/\s+/g, ''))).toEqual(['素食3份1團', '過敏/禁忌1團', '遊覽車/司機1團'])
    act(() => { [...container.querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('過敏')).click() })
    expect(container.textContent).toContain('兩位海鮮過敏')
  })

  it('整區都是 0 → 一行「今日無特殊備餐」', () => {
    mount(<GroupPrepDigest prep={prep({ counts: { total: 35, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 }, byGroup: [] })} />)
    expect(labels()).toHaveLength(0)
    expect(container.querySelector('[data-testid="prep-none"]').textContent).toBe('今日無特殊備餐')
    expect(container.textContent).toContain('備餐重點')
  })
})
