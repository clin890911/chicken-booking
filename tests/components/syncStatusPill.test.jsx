import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { SyncStatusPillView, describeSyncPill } from '../../src/components/layout/SyncStatusPill'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('describeSyncPill 四種＋問題狀態文字', () => {
  const T = '2026-11-27T10:15:30.000Z'
  it('✓ 已同步（帶最後成功時間）', () => {
    const d = describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'synced', lastSyncAt: T } })
    expect(d.text).toBe('✓ 已同步')
    expect(d.detail).toMatch(/最後成功同步/)
  })
  it('同步中…', () => {
    expect(describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'syncing', lastSyncAt: T } }).text).toBe('同步中…')
  })
  it('⚠ N 筆未上傳（rejected，算 writes＋deletes＋settings）', () => {
    const d = describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'rejected', rejected: { writes: [1, 2], deletes: [3], settings: true } } })
    expect(d.text).toBe('⚠ 4 筆未上傳')
    expect(d.problem).toBe(true)
  })
  it('rejected 即使 rejected 內容空也至少顯示 1 筆（黏住的警示不能消失）', () => {
    expect(describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'rejected', rejected: {} } }).text).toBe('⚠ 1 筆未上傳')
  })
  it('推送失敗（offline＋pushFailed）＝有變更未上傳；單純離線另一句', () => {
    expect(describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'offline', pushFailed: true } }).text).toBe('⚠ 有變更未上傳')
    expect(describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'offline' } }).text).toBe('⚠ 離線中')
  })
  it('本機模式（未設 Firebase）', () => {
    expect(describeSyncPill({ usingFirebase: false, cloudStatus: { state: 'idle' } }).text).toBe('本機模式')
  })
  it('尚未同步（idle）不假裝已同步', () => {
    expect(describeSyncPill({ usingFirebase: true, cloudStatus: { state: 'idle', lastSyncAt: null } }).text).toBe('連線中…')
  })
})

describe('SyncStatusPillView 互動', () => {
  let container, root
  const mount = (ui) => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(ui) })
  }
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('已同步：點開顯示最後成功時間；按鈕有 ≥44px 的高度 class', () => {
    mount(<SyncStatusPillView usingFirebase cloudStatus={{ state: 'synced', lastSyncAt: '2026-11-27T10:15:30.000Z' }} />)
    const btn = container.querySelector('[data-testid="sync-status-pill"]')
    expect(btn.textContent).toBe('✓ 已同步')
    expect(btn.className).toContain('min-h-[44px]')
    expect(container.querySelector('[data-testid="sync-status-detail"]')).toBeNull()
    act(() => { btn.click() })
    expect(container.querySelector('[data-testid="sync-status-detail"]').textContent).toMatch(/最後成功同步/)
  })

  it('有未上傳：點了呼叫 onView（導向同步說明），不展開', () => {
    let viewed = 0
    mount(<SyncStatusPillView usingFirebase cloudStatus={{ state: 'rejected', rejected: { writes: [1, 2] } }} onView={() => { viewed++ }} />)
    const btn = container.querySelector('[data-testid="sync-status-pill"]')
    expect(btn.textContent).toBe('⚠ 2 筆未上傳')
    act(() => { btn.click() })
    expect(viewed).toBe(1)
    expect(container.querySelector('[data-testid="sync-status-detail"]')).toBeNull()
  })
})
