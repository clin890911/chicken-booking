// 離席後 toast「一鍵釋出」：主桌＋併桌副桌都要釋出、toast 列出所有桌號（過去只清主桌）。
import { describe, it, expect, vi } from 'vitest'
import { releaseAfterCheckout } from '../../src/utils/bookingActions'

const booking = { id: 'B1', name: '王小明', assignedTableId: '108', extraTableIds: ['101'] }
const mkToast = () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })

describe('releaseAfterCheckout', () => {
  it('呼叫整組釋出、toast 列出所有實際釋出的桌號', () => {
    const toast = mkToast()
    const releaseCheckedOutTables = vi.fn(() => ({ ok: true, released: ['108', '101'], skipped: [] }))
    releaseAfterCheckout(booking, { releaseCheckedOutTables, toast })
    expect(releaseCheckedOutTables).toHaveBeenCalledWith('B1')
    expect(toast.success).toHaveBeenCalledWith('108、101 已釋出')
  })
  it('部分桌已被下一組接手 → 只報實際釋出的，並說明略過的', () => {
    const toast = mkToast()
    releaseAfterCheckout(booking, { releaseCheckedOutTables: () => ({ ok: true, released: ['108'], skipped: ['101'] }), toast })
    expect(toast.success).toHaveBeenCalledWith('108 已釋出（101 已清好或已有下一組，未動）')
  })
  it('全部已清好 → info，不報釋出', () => {
    const toast = mkToast()
    releaseAfterCheckout(booking, { releaseCheckedOutTables: () => ({ ok: true, released: [], skipped: ['108', '101'] }), toast })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
  })
  it('失敗 → error', () => {
    const toast = mkToast()
    releaseAfterCheckout(booking, { releaseCheckedOutTables: () => ({ ok: false, error: '訂位不存在' }), toast })
    expect(toast.error).toHaveBeenCalledWith('釋出失敗：訂位不存在')
  })
})
