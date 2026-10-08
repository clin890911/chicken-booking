import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { WalkinRow } from '../../src/components/admin/planning/GroupDayPanel.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container, root
function mount(el) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(el))
  return container
}
afterEach(() => { act(() => root.unmount()); container.remove() })

const row = (booking) => ({ booking, status: 'confirmed', assignedTableId: booking.assignedTableId, timeSlot: '18:00', guests: booking.guests })

describe('規劃頁散客列桌號', () => {
  it('併桌列出所有桌號「101 + 107」，不再寫「101 +1」', () => {
    const c = mount(<WalkinRow row={row({ id: 'b1', name: '王先生', guests: 8, assignedTableId: '101', extraTableIds: ['107'] })} onFocusTable={() => {}} />)
    const btn = [...c.querySelectorAll('button')].find(b => b.textContent === '101 + 107')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('title')).toContain('101、107')
    expect(c.textContent).not.toMatch(/101 \+1\b/)
  })

  it('單桌照舊只顯示桌號', () => {
    const c = mount(<WalkinRow row={row({ id: 'b2', name: '李小姐', guests: 4, assignedTableId: '105' })} />)
    expect([...c.querySelectorAll('span')].some(s => s.textContent === '105')).toBe(true)
  })

  it('未配桌不顯示桌號', () => {
    const c = mount(<WalkinRow row={row({ id: 'b3', name: '陳先生', guests: 2, assignedTableId: null, extraTableIds: ['107'] })} />)
    expect(c.textContent).not.toContain('107')
  })
})
