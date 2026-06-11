// LIFF Endpoint=站根後的 liff.state 路由（純函式，src/main.jsx 在 React 掛載前呼叫）。
// LINE 平台開啟 path-style deep link（liff.line.me/{id}/book）時，會把 path+query
// 編進 ?liff.state= 丟給 Endpoint（站根）；這裡解出目標路徑讓 SPA 直接落地。
//
// 安全鐵則：只接受 '/' 開頭的站內相對路徑——liff.state 是攻擊者可控輸入，
// 接受絕對 URL 或 '//host' 形式會變成 open redirect。

// 回傳站內目標路徑（含 query），無法處理時回空字串（呼叫端不動作）。
export function resolveLiffStatePath(search = '', pathname = '/') {
  let params
  try {
    params = new URLSearchParams(search || '')
  } catch {
    return ''
  }

  const rawState = params.get('liff.state') || ''
  if (rawState) {
    const decoded = safeDecode(rawState)
    // 只收站內相對路徑；'//' 開頭是 protocol-relative URL（外域），一律拒絕
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded
    return ''
  }

  // Legacy catch：Endpoint 切站根的過渡窗——舊版 query-style 綁定連結
  // （liff.line.me/{id}?bookingId=...&token=...）會把 query 直接帶到站根。
  // 落在首頁且帶綁定參數 → 導回綁定頁，原 query 原樣保留。
  if ((pathname === '/' || pathname === '') && params.get('bookingId') && (params.get('token') || params.get('payload'))) {
    return `/line/bind${search.startsWith('?') ? search : `?${search}`}`
  }

  return ''
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
