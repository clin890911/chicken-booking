import { useEffect, useState } from 'react'

// 手機版面條件（方向 A：手機上整頁捲，2026-11）。iPad 橫向 1180×820 不成立。
// 能用 CSS 就用 tailwind 的 phone: 變體（tailwind.config.js）與 index.css（同一條件）；
// 這裡只給「非 JS 不可」的行為用：開場預設籤、點桌後捲到抽屜、跳轉鈕。
export const PHONE_QUERY = '(max-width: 767px), (max-height: 500px)'

// jsdom 沒有 matchMedia → 視為非手機（既有單元測試不受影響）
export function isPhoneLayout() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}

// 轉向／視窗變大小時跟著變
export function usePhoneLayout() {
  const [phone, setPhone] = useState(isPhoneLayout)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(PHONE_QUERY)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return phone
}

// 把元素捲到 AdminPage 內容區（admin-content）的可視範圍。不用 scrollIntoView：它也會去捲 overflow:hidden 的外層，把一面式外殼捲歪。
// block：'start' 貼上緣、'end' 貼下緣；clear：貼下緣時多留的空間（浮動鈕）；offset：貼上緣時讓開黏頂列的高度。
export function scrollContentTo(el, { block = 'start', smooth = false, clear = 8, offset = 0 } = {}) {
  const box = el?.closest?.('[data-testid="admin-content"]')
  if (!box) return
  const r = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  const top = box.scrollTop + (block === 'end' ? r.bottom - b.bottom + clear : r.top - b.top - 8 - offset)
  box.scrollTo?.({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
}
