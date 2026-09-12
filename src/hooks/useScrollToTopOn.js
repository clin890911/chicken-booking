import { useLayoutEffect, useRef } from 'react'

// 找最近的「會捲動」祖先（overflow-y auto/scroll 且內容超出）並捲回頂端。
// 後台的捲動容器是 AdminPage 的分頁內容區（不是 window），故不能只 window.scrollTo。
export function scrollParentToTop(el) {
  let node = el?.parentElement
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    const oy = style.overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0
      return node
    }
    node = node.parentElement
  }
  try { window.scrollTo(0, 0) } catch { /* jsdom 等環境沒有實作，忽略 */ }
  return null
}

// 畫面「換頁」（規劃頁 當日總覽⇄排位地圖⇄團單詳情⇄編輯器、訂位頁子分頁）時捲回頂端。
// 背景：這些切換都是同一個捲動容器內的條件渲染，捲到很下面再切頁，新畫面會停在同樣的
// scrollTop——看起來像「切過去沒反應、還要自己往上捲」，是店主回報「介面不順」的來源之一。
// 用法：const ref = useScrollToTopOn(key)；把 ref 掛在該畫面的根元素。key 一變就捲頂（首次掛載不捲）。
export function useScrollToTopOn(key) {
  const ref = useRef(null)
  const lastKey = useRef(key)
  useLayoutEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    if (ref.current) scrollParentToTop(ref.current)
  }, [key])
  return ref
}
