// 「⋯ 更多」這類用 <details data-popover> 做的浮出選單，原生 details 點外面不會收（Barry 2026-10-17：iPad 上
// 展開後一直掛著、蓋住下面的卡片）。全域補上四種自動收合：
//   1. 點選單以外的地方（pointerdown，觸控與滑鼠同一條）
//   2. 打開另一個選單 → 其他已開的先收（同一時間只開一個）
//   3. 按下選單裡的動作（button／a）→ 動作送出後收起
//   4. Escape
//   5. 鍵盤 Tab 把焦點移出選單（focusout，#198 收尾）：焦點已經到下面的卡片，選單（z-30）不能還蓋在上面。
//      只在 relatedTarget（焦點要去的元素）明確在選單外時才收：
//        - 點選單內的勾選框／按鈕 → relatedTarget 在選單內（Chrome），或是 null（Safari 點按鈕／勾選框不給焦點、
//          點選單內非可聚焦的字或留白也是 null）→ 都不收，多選勾來勾去不會被誤收。
//        - 切到別的 App／視窗失焦 → relatedTarget 為 null → 不收（回來選單還在）。
//        - 用滑鼠／觸控點外面：照舊由 1. pointerdown 收。
// 另外：打開時若選單超出捲動區（清單最底的卡）→ 自動捲到看得到整個選單。
// 只認 data-popover，設定頁那類摺疊區塊（一般 <details> 手風琴）不受影響。
// 檔名刻意不以 admin 開頭（E2E 以 page.route('**/admin*') 攔後端端點）。
const SELECTOR = 'details[data-popover][open]'

export function closeOpenPopovers(except = null) {
  if (typeof document === 'undefined') return
  document.querySelectorAll(SELECTOR).forEach(d => { if (d !== except) d.open = false })
}

let installed = false
export function installPopoverDismiss() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('pointerdown', e => {
    const inside = e.target?.closest?.('details[data-popover]')
    closeOpenPopovers(inside || null)
  }, true)
  // toggle 不冒泡 → capture 階段收
  document.addEventListener('toggle', e => {
    const d = e.target
    if (d?.matches?.('details[data-popover]') && d.open) {
      closeOpenPopovers(d)
      // 清單最下面那張卡的選單會開到可視範圍外（iPad 實測下緣超出 ~170px）→ 捲到剛好看得到整個選單
      const menu = d.querySelector(':scope > :not(summary)')
      setTimeout(() => menu?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 0)
    }
  }, true)
  document.addEventListener('click', e => {
    const item = e.target?.closest?.('details[data-popover] :is(button, a)')
    if (!item || item.closest('summary')) return
    const d = item.closest('details[data-popover]')
    // 等動作的 onClick 先跑完（有的會讀 closest('details')）再收
    setTimeout(() => { if (d) d.open = false }, 0)
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpenPopovers() })
  document.addEventListener('focusout', e => {
    const d = e.target?.closest?.('details[data-popover]')
    if (!d || !d.open) return
    const next = e.relatedTarget
    if (!next || d.contains(next)) return
    d.open = false
  })
}
