// 管理員帳號管理純邏輯（不碰 Firestore / auth），抽出供根目錄 Vitest 直接測試。
// 設計：環境變數 ADMIN_EMAILS = 固定管理員（店長，永遠有效，防 admins 集合誤刪鎖死）；
// admins 集合 = 後台動態新增的管理員（毋須重新部署即可增減）。

// 與前端 AuthContext 的 PERMISSIONS 角色集合成對（manager 店長 / floor 外場 / host 訂位專員 / kitchen 廚房）。
export const STAFF_ROLES = ['manager', 'floor', 'host', 'kitchen']

// email 正規化：小寫、去空白；格式不合法回空字串。
export function normalizeStaffEmail(value) {
  const s = String(value || '').trim().toLowerCase()
  // 寬鬆但足夠的 email 格式（Google 帳號一定過得了；擋掉手滑輸入）
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : ''
}

// 角色正規化：非法角色一律降為 floor（與前端「沒指定預設 floor」同口徑）。
export function resolveStaffRole(value) {
  return STAFF_ROLES.includes(value) ? value : 'floor'
}

// 新增/更新管理員的輸入驗證 + 清洗。
export function validateStaffUpsert({ email, role, name } = {}) {
  const cleanEmail = normalizeStaffEmail(email)
  if (!cleanEmail) return { ok: false, error: 'email 格式不正確' }
  if (role !== undefined && role !== null && role !== '' && !STAFF_ROLES.includes(role)) {
    return { ok: false, error: `角色必須是 ${STAFF_ROLES.join(' / ')} 其中之一` }
  }
  return {
    ok: true,
    value: {
      email: cleanEmail,
      role: resolveStaffRole(role),
      name: String(name || '').trim().slice(0, 40),
    },
  }
}
