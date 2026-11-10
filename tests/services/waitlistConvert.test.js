// 候位轉訂位：收尾 helper 與等待顯示
import { finishConvertedWaitlist, formatEstWait, convertNote, LEAVE_REASON_CONVERTED } from '../../src/services/waitlistService'

describe('finishConvertedWaitlist', () => {
  it('訂位建立成功 → 對候位呼叫離開 transition，原因 converted', async () => {
    const leave = vi.fn().mockResolvedValue({ ok: true })
    await finishConvertedWaitlist('W1', { ok: true, booking: { id: 'B1' } }, leave)
    expect(leave).toHaveBeenCalledTimes(1)
    expect(leave.mock.calls[0][0]).toBe('W1')
    expect(leave.mock.calls[0]).toContain(LEAVE_REASON_CONVERTED)
    expect(LEAVE_REASON_CONVERTED).toBe('converted')
  })
  it('訂位建立失敗 → 候位不動', async () => {
    const leave = vi.fn()
    await finishConvertedWaitlist('W1', { ok: false }, leave)
    await finishConvertedWaitlist('W1', undefined, leave)
    expect(leave).not.toHaveBeenCalled()
  })
  it('非候位轉入（沒有 waitlistId）不呼叫', async () => {
    const leave = vi.fn()
    await finishConvertedWaitlist(null, { ok: true }, leave)
    expect(leave).not.toHaveBeenCalled()
  })
})

describe('formatEstWait / convertNote', () => {
  it('超過 90 分顯示「等待較久」，否則精確分鐘', () => {
    expect(formatEstWait(108)).toBe('等待較久')
    expect(formatEstWait(91)).toBe('等待較久')
    expect(formatEstWait(90)).toBe('90 分')
    expect(formatEstWait(24, '約 ')).toBe('約 24 分')
  })
  it('備註帶候位號', () => { expect(convertNote({ queueNumber: 7 })).toBe('由候位 #7 轉入') })
})
