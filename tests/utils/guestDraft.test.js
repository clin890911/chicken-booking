import { beforeEach, describe, it, expect, vi } from 'vitest'
import { canonicalGuestPayload, prepareGuestDraft, loadGuestDraft, saveGuestDraft, clearGuestDraft } from '../../src/utils/guestDraft'
const data = { name: ' 訪客 ', phone: '0912-345-678', guests: '2', date: '2026-10-06', timeSlot: '11:00', notes: { pet: true, text: ' 靠窗 ' } }
beforeEach(() => sessionStorage.clear())
describe('guest submission recovery capability', () => {
  it('persists canonical intent and crypto key across reload without LINE identity', () => {
    const draft = saveGuestDraft(prepareGuestDraft({ ...data, line: { idToken: 'FAKE_PRIVATE' } }, null, 'pending'))
    expect(draft.submissionKey).toMatch(/^[a-f0-9]{64}$/)
    expect(loadGuestDraft()).toEqual(draft)
    expect(JSON.stringify(draft)).not.toContain('FAKE_PRIVATE')
    expect(draft.payload.phone).toBe('0912345678')
    expect(draft.payload.notes.text).toBe('靠窗')
  })
  it('retries the same canonical payload with the same key but locks changed unknown intent', () => {
    const draft = prepareGuestDraft(data, null, 'unknown')
    expect(prepareGuestDraft({ ...data, phone: '0912345678' }, draft, 'pending').submissionKey).toBe(draft.submissionKey)
    expect(() => prepareGuestDraft({ ...data, guests: 4 }, draft)).toThrow('上一筆訂位結果尚未確認')
  })
  it('known pre-write rejection permits a distinct changed intent with a new key', () => {
    const draft = prepareGuestDraft(data, null, 'editing')
    expect(prepareGuestDraft({ ...data, guests: 4 }, draft).submissionKey).not.toBe(draft.submissionKey)
  })
  it('success clears the draft and another booking gets a fresh key', () => {
    const first = saveGuestDraft(prepareGuestDraft(data, null, 'pending'))
    clearGuestDraft(); expect(loadGuestDraft()).toBeNull()
    expect(prepareGuestDraft(data, loadGuestDraft()).submissionKey).not.toBe(first.submissionKey)
  })
  it('storage failure is visible before a caller can send the key', () => {
    vi.spyOn(Object.getPrototypeOf(window.sessionStorage), 'setItem').mockImplementation(() => { throw new Error('storage-denied') })
    expect(() => saveGuestDraft(prepareGuestDraft(data, null))).toThrow('storage-denied')
    vi.restoreAllMocks()
  })
  it('corrupted stored payload cannot crash the booking form', () => {
    const draft = prepareGuestDraft(data, null, 'pending')
    sessionStorage.setItem('chicken_guest_submission_v1', JSON.stringify({ ...draft, payload: 'corrupted' }))
    expect(loadGuestDraft()).toBeNull()
  })
  it('canonical equality covers all meaningful notes and excludes short-lived identity', () => {
    expect(canonicalGuestPayload({ ...data, notes: { ...data.notes, text: '靠窗' } })).toEqual(canonicalGuestPayload(data))
    expect(canonicalGuestPayload({ ...data, notes: { text: '靠窗', pet: false } })).not.toEqual(canonicalGuestPayload(data))
  })
})
