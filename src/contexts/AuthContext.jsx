import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'chicken_auth_v1'

// === 角色權限體系 ===
// manager   店長：全部權限（含設定、員工管理、刪除訂位）
// floor     外場：操作桌位、訂位、候位（不能改設定）
// host      訂位專員：訂位 CRUD、候位管理（不能改桌位狀態）
// kitchen   廚房唯讀：只能看訂位列表（不能寫）
//
// 角色映射來源：VITE_ROLE_MAP（JSON 字串），格式：
//   {"berrylin0911@gmail.com": "manager", "floor1@example.com": "floor"}
// 沒指定的 email 預設為 floor
const DEFAULT_ROLE = 'floor'
const ROLE_LABELS = {
  manager: '店長',
  floor: '外場',
  host: '訂位專員',
  kitchen: '廚房',
}

function parseRoleMap() {
  try {
    const raw = import.meta.env.VITE_ROLE_MAP
    if (raw) return JSON.parse(raw)
  } catch {}
  // 預設只有 Barry 是 manager
  return { 'berrylin0911@gmail.com': 'manager' }
}

const ROLE_MAP = parseRoleMap()

const ALLOWED_EMAILS = (
  import.meta.env.VITE_ADMIN_EMAILS ||
  Object.keys(ROLE_MAP).join(',') ||
  'berrylin0911@gmail.com'
).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

// === 權限規則 ===
// can[action] 可由元件呼叫 useAuth().can('xxx') 來判斷
const PERMISSIONS = {
  manager: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.delete', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge', 'table.config',
    'waitlist.read', 'waitlist.create', 'waitlist.update', 'waitlist.delete',
    'customer.read', 'customer.update', 'customer.blacklist',
    'settings.read', 'settings.update',
    'staff.manage',
  ]),
  floor: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update',
  ]),
  host: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    'table.read',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update',
  ]),
  kitchen: new Set([
    'booking.read',
    'table.read',
    'waitlist.read',
  ]),
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  // 模擬 Google 登入：輸入 email，限定白名單，自動帶角色
  const signIn = async (email) => {
    const e = (email || '').trim().toLowerCase()
    if (!e) throw new Error('請輸入 email')
    if (!ALLOWED_EMAILS.includes(e)) throw new Error('此帳號未授權，請聯絡店長加入白名單')
    const role = ROLE_MAP[e] || DEFAULT_ROLE
    const u = {
      email: e,
      displayName: e.split('@')[0],
      role,
      roleLabel: ROLE_LABELS[role] || role,
      loggedAt: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
    return u
  }

  const signOut = () => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  // 權限判斷
  const can = (action) => {
    if (!user) return false
    const set = PERMISSIONS[user.role]
    return set ? set.has(action) : false
  }

  return (
    <AuthContext.Provider value={{
      user, loading, signIn, signOut, can,
      allowedEmails: ALLOWED_EMAILS,
      roleLabels: ROLE_LABELS,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
