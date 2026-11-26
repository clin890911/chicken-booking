// 入座／換桌／同步錯誤文案：把後端原文與內部術語翻成店員的語言，並附「下一步」。
//
// 為什麼存在：店員看到「此組已入座，請使用換桌」「尚未指派桌位（請先指派）」「未知錯誤」「雲端拒收」
// 這類句子，不知道系統是不是算錯、也不知道該按哪裡（現場頁走查 #9）。
// 純函式、只改「顯示的字」：錯誤的判斷、code 欄位、後端回傳都不動。
// 原文保留在結果的 rawError（友善化後 error 才是店員看的句子），需要比對原文的呼叫端請讀 rawError。

export const SEAT_ERROR_DEFAULT = '這次沒有成功，請看一下桌況圖後再試一次；還是不行請通知店長'
export const SYNC_ERROR_OFFLINE = '網路不穩，這筆先存在這台 iPad，連上後會自動上傳'
export const SYNC_ERROR_REJECTED = '這個帳號沒有權限把這筆上傳，只存在這台 iPad，請通知店長'

const HAS_CJK = /[㐀-鿿]/

// 每條規則：pattern → (match, raw) => 店員句。依序比對，先中先贏。
const RULES = [
  // ── 網路／同步 ──
  [/failed to fetch|networkerror|network request failed|load failed|cloud-push-failed|cloud-sync-failed|連線逾時|request-failed-5\d\d|offline/i,
    () => SYNC_ERROR_OFFLINE],
  [/雲端拒收|權限不足|permission|forbidden|request-failed-40[13]/i, () => SYNC_ERROR_REJECTED],
  // ── 搶桌（雲端 409）──
  [/table-occupied-elsewhere/i, () => '這張桌剛被另一台帶位了，請換一張桌（畫面會自動更新成最新桌況）'],
  [/(\S+) 已被另一台帶位/, (m) => `${m[1]} 剛被另一台坐走了，請換一張桌`],
  // ── 入座前置 ──
  [/此組已入座，請使用換桌/, () => '這組已經入座了，要換桌請點桌子後按「換桌」'],
  [/尚未指派桌位/, () => '這組還沒配桌，請先點一張空桌'],
  [/這筆訂位不是待到狀態，無法入座/, () => '這組不是「等待到店」的狀態，可能已入座或取消，請重新整理看最新狀態'],
  [/這筆訂位已有桌，請改用/, () => '這組已經有桌了，請按「客人到了」，或改桌'],
  [/請至少選一張桌/, () => '請先點選至少一張空桌'],
  // ── 桌況 ──
  [/(\S+) 目前不是空桌（(.+)）/, (m) => `${m[1]} 現在是「${m[2]}」，不是空桌，請換一張桌`],
  [/(\S+) 目前不是空桌/, (m) => `${m[1]} 現在不是空桌，請換一張桌`],
  [/(\S+) 目前由 (.+) 使用，請先改桌/, (m) => `${m[1]} 現在是 ${m[2]} 在用，請換一張桌`],
  [/(\S+) 待清桌（上一組已用畢）/, (m) => `${m[1]} 上一組剛用完還沒清桌，請先清桌或換一張`],
  [/(\S+) 目前(\S+)，請先改桌/, (m) => `${m[1]} 現在是「${m[2]}」，請換一張桌`],
  [/(\S+) 停用[\/／]維修中/, (m) => `${m[1]} 停用或維修中，請換一張桌`],
  [/(\S+) 已被佔用，無法復原/, (m) => `${m[1]} 已經有人坐了，沒辦法復原`],
  [/(\S+?) 已被別組使用，無法復原/, (m) => `${m[1]} 已經有別組坐了，沒辦法復原`],
  [/(\S+) 已被下一組使用（(.+?)），未復原/, (m) => `${m[1]} 已經換下一組了，沒辦法復原`],
  // ── 容量 ──
  [/(\S+) 容量不足（(\d+) 人桌最多擠 (\d+) 位，此組 (\d+) 位）/, (m) => `${m[1]} 坐不下：${m[2]} 人桌最多擠 ${m[3]} 位，這組有 ${m[4]} 位，請加桌或換大一點的桌`],
  [/(\S+) 容量不足（最多擠 (\d+) 位）/, (m) => `${m[1]} 坐不下，最多擠 ${m[2]} 位，請加桌或換大一點的桌`],
  [/所選桌合計 (\d+) 席（最多擠 (\d+) 位），不足 (\d+) 位/, (m) => `座位不夠：選的桌最多擠 ${m[2]} 位，這組有 ${m[3]} 位，請再加一張桌`],
  [/併桌必須在同一樓層/, () => '併桌的桌子要在同一層，請改選同一層的桌'],
  // ── 找不到 ──
  [/訂位不存在/, () => '找不到這筆訂位，可能已被取消或刪除，請重新整理'],
  [/候位記錄不存在/, () => '找不到這組候位，可能已被處理過，請看候位清單'],
  [/桌位( \S+)? 不存在|^桌位不存在$/, () => '找不到這張桌，請重新整理桌況圖'],
  // ── 復原 ──
  [/狀態已被更動|已被更動，無法復原|已被更動，未復原|已被更動，請重新開啟換桌/, () => '這筆訂位剛被別人改過，沒辦法復原，請看一下最新狀態'],
  // ── 其他系統句 ──
  [/裝置儲存異常/, () => '這台 iPad 存檔出問題，請重新整理確認桌況後再操作'],
  [/^(未知錯誤|unknown|undefined|null|error)$/i, () => SEAT_ERROR_DEFAULT],
]

// raw → 店員看得懂的句子。空值或英文代碼（沒有中文）一律走預設句，避免把系統代碼丟給店員。
export function seatErrorText(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return SEAT_ERROR_DEFAULT
  for (const [pattern, build] of RULES) {
    const m = text.match(pattern)
    if (m) return build(m, text)
  }
  // 已經是中文（多半是 service 層寫好的句子）原樣放行；純英文／代碼 → 預設句。
  return HAS_CJK.test(text) ? text : SEAT_ERROR_DEFAULT
}

// { ok:false, error } → 友善化。ok 結果與非物件原樣回傳（維持參考，不增加重繪）。
// 原文放 rawError；已有 rawError 不重複轉。
export function friendlyResult(r) {
  if (!r || typeof r !== 'object' || r.ok !== false || r.rawError !== undefined) return r
  return { ...r, rawError: r.error, error: seatErrorText(r.error) }
}

// 把一包動作函式（BookingContext 的入座／換桌／復原動作）包起來：同步回傳 { ok:false } 的才轉文案，
// Promise 或其他回傳值原樣放行。不改參數、不改副作用，只改回傳的 error 字串。
export function withFriendlyErrors(actions) {
  const out = {}
  for (const [name, fn] of Object.entries(actions)) {
    out[name] = typeof fn === 'function'
      ? (...args) => friendlyResult(fn(...args))
      : fn
  }
  return out
}
