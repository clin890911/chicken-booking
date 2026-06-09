// 全域測試 setup
// 1) 用 Map-backed 的 localStorage mock 取代環境提供的版本（行為可預測、跨環境一致、完全隔離）
// 2) 每個測試前後清空 localStorage（services 都以 localStorage 為後端）
// 3) 補上 crypto.getRandomValues（bookingService.createManageToken 需要）
import { afterEach, beforeEach } from 'vitest'
import { webcrypto } from 'node:crypto'

class LocalStorageMock {
  constructor() { this.store = new Map() }
  get length() { return this.store.size }
  clear() { this.store.clear() }
  getItem(key) { const k = String(key); return this.store.has(k) ? this.store.get(k) : null }
  setItem(key, value) { this.store.set(String(key), String(value)) }
  removeItem(key) { this.store.delete(String(key)) }
  key(i) { return [...this.store.keys()][i] ?? null }
}

const localStorageMock = new LocalStorageMock()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true, writable: true })
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true, writable: true })
}

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto
}
if (typeof window !== 'undefined' && (!window.crypto || typeof window.crypto.getRandomValues !== 'function')) {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true })
}

beforeEach(() => { localStorageMock.clear() })
afterEach(() => { localStorageMock.clear() })
