// 團單編輯器的欄位工具（純函式，零 React／零 DOM，供 Vitest 直接測）。
//
// 為什麼遊覽車「三格 ⇄ 一個字串」要走合成／拆解，而不是直接新增三個欄位：
//   後端 functions 對 groupReservations 沒有欄位白名單（groupReserveTables 是整包 merge），
//   但**前端** groupReservationService.create() 是逐欄位列舉組物件的，新欄位在「新增團單」
//   這條路徑上會被靜默丟掉（編輯既有團單走 update() 的 spread 才留得住）。
//   該檔在本次範圍外、且「新增時存得進去、編輯時又存得住」這種半殘狀態最難查，
//   所以三格一律合成回既有的 busInfo 單一欄位；當日總表／回傳單／CSV 匯出都已經在讀它。
export const BUS_SEPARATOR = '｜'

// 總人數快速鍵：店主口語的車型（中巴 20 / 大巴 43 / 兩台大巴 86）
export const TOTAL_PRESETS = [
  { key: 'mid', label: '中巴', total: 20 },
  { key: 'big', label: '大巴', total: 43 },
  { key: 'double', label: '兩台大巴', total: 86 },
]

// 特殊需求四項（欄位名與 counts schema 一致，不可改）
export const SPECIAL_FIELDS = [
  { key: 'vegetarian', label: '素食', icon: 'leaf' },
  { key: 'child', label: '兒童', icon: 'child' },
  { key: 'mobility', label: '行動不便', icon: 'walk' },
  { key: 'wheelchair', label: '輪椅', icon: 'wheelchair' },
]

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/
// 沒有 ｜ 的舊資料才用這組分隔符切段。
// ⚠️ 刻意不含全形逗號「，」：手寫備註常用它（「2 台，阿明的車中午前到」），拿它切段等於腰斬值。
const SEG_FALLBACK = /[|／/、;；]/

function pad2(hhmm) {
  const [h, m] = String(hhmm).split(':')
  return `${String(Number(h)).padStart(2, '0')}:${m}`
}

// 三格 → busInfo 字串（空項省略；三格全空 → 空字串，不留分隔符）
// 值裡若有人打了 ｜ 會被換成 ／：｜ 是欄位分隔符，留在值裡下次就拆錯位。
export function composeBusInfo({ plate = '', phone = '', eta = '' } = {}) {
  const parts = []
  const clean = (v) => String(v ?? '').split(BUS_SEPARATOR).join('／').trim()
  const p = clean(plate)
  const t = clean(phone)
  const e = clean(eta)
  if (p) parts.push(`車號 ${p}`)
  if (t) parts.push(`司機 ${t}`)
  if (e) parts.push(`抵達 ${e}`)
  return parts.join(BUS_SEPARATOR)
}

// busInfo 字串 → 三格。
// 🔴 先切段再比關鍵字，不是用「一個 regex 抓到下一個標點為止」：值本身就常含全形逗號
//    （「2 台，阿明的車中午前到」），用標點當終止符會把值攔腰截斷，再存一次就真的掉資料。
//    有本模組寫出的 ｜ 就照 ｜ 切；沒有才退回舊資料常見的分隔符。
//    任何一段拆不乾淨（有認不得的殘段、或抵達時間不是 HH:MM）→ 整段原字串放進車號格，絕不丟資料。
export function parseBusInfo(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { plate: '', phone: '', eta: '' }
  const whole = { plate: s, phone: '', eta: '' }

  const parts = (s.includes(BUS_SEPARATOR) ? s.split(BUS_SEPARATOR) : s.split(SEG_FALLBACK))
    .map(x => x.trim()).filter(Boolean)

  const out = { plate: '', phone: '', eta: '' }
  let matched = 0
  for (const part of parts) {
    let m
    if ((m = part.match(/^車號\s*[:：]?\s*(.*)$/))) out.plate = m[1].trim()
    else if ((m = part.match(/^司機(?:電話)?\s*[:：]?\s*(.*)$/))) out.phone = m[1].trim()
    else if ((m = part.match(/^(?:預計)?抵達(?:時間)?\s*[:：]?\s*(.*)$/))) out.eta = m[1].trim()
    else continue                      // 認不得的殘段
    matched += 1
  }
  if (!matched || matched !== parts.length) return whole
  // 抵達格會餵給 <input type="time">，格式不合就別硬塞
  if (out.eta && !TIME_RE.test(out.eta)) return whole
  return { ...out, eta: out.eta ? pad2(out.eta) : '' }
}

// 特殊需求超過總人數的項目（四項可重疊——素食兒童同一人很常見——所以只擋單項超過、不擋合計）
export function overSpecialCounts(counts = {}) {
  const total = Number(counts?.total) || 0
  return SPECIAL_FIELDS
    .filter(f => (Number(counts?.[f.key]) || 0) > total)
    .map(f => ({ key: f.key, label: f.label, value: Number(counts[f.key]) || 0, total }))
}

// 給 UI 的單行紅字；沒問題回傳 null
export function specialOverMessage(counts = {}) {
  const [first] = overSpecialCounts(counts)
  if (!first) return null
  return `${first.label} ${first.value} 人超過總人數 ${first.total}，先改總人數或減少這項`
}

// 圈桌側欄的「夠不夠坐」三態文案（純函式，UI 只負責套色）。
// 店員腦中的判準是「這一梯圈到的席位，夠不夠這一梯的人坐」，不是百分比；
// 所以直接給完整句子（夠坐 X 人多 Y 席／還差 Y 席再圈一桌），不必自己心算、
// 也不必捲回整單摘要卡（那張算的是整團，這裡算的是「目前這一梯」）。
//   tone: 'idle'（還沒圈桌／還沒填人數）｜'ok'（夠坐）｜'short'（不夠）
export function seatCompareText({ circled = 0, needed = 0, tableCount = 0 } = {}) {
  const c = Math.max(0, Number(circled) || 0)
  const n = Math.max(0, Number(needed) || 0)
  const t = Math.max(0, Number(tableCount) || 0)
  if (t <= 0 && c <= 0) return { tone: 'idle', text: '還沒圈桌' }
  // 已圈桌但沒人數：不能說「夠坐 0 人」，那是假的綠燈
  if (n <= 0) return { tone: 'idle', text: '還沒填本梯人數' }
  if (c >= n) {
    const over = c - n
    return { tone: 'ok', text: over === 0 ? `剛好夠坐 ${n} 人` : `夠坐 ${n} 人，多 ${over} 席` }
  }
  return { tone: 'short', text: `還差 ${n - c} 席，再圈一桌` }
}
