import { createContext, useContext, useEffect, useState } from 'react'
import {
  auth, googleProvider, isFirebaseConfigured,
  signInWithPopup, signOut as fbSignOut, onAuthStateChanged, getIdToken,
} from '../services/firebase'

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

function buildUser(email, displayName) {
  const e = (email || '').trim().toLowerCase()
  const role = ROLE_MAP[e] || DEFAULT_ROLE
  return {
    email: e,
    displayName: displayName || e.split('@')[0],
    role,
    roleLabel: ROLE_LABELS[role] || role,
    loggedAt: new Date().toISOString(),
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 正式模式：交由 Firebase Auth 維護登入狀態（onAuthStateChanged）。
    if (isFirebaseConfigured) {
      const unsub = onAuthStateChanged(auth, (fbUser) => {
        const email = (fbUser?.email || '').toLowerCase()
        // 前端白名單只負責 UI；真正的權限由後端 requireStaff 二次把關。
        if (fbUser && ALLOWED_EMAILS.includes(email)) {
          setUser(buildUser(email, fbUser.displayName))
        } else {
          if (fbUser) fbSignOut(auth).catch(() => {})
          setUser(null)
        }
        setLoading(false)
      })
      return unsub
    }
    // 本機開發 fallback：沒有 Firebase 設定時用 localStorage 模擬登入。
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  // 正式模式用 Google 彈窗登入；開發模式 fallback 用 email 模擬。
  const signIn = async (email) => {
    if (isFirebaseConfigured) {
      const result = await signInWithPopup(auth, googleProvider)
      const e = (result.user?.email || '').toLowerCase()
      if (!ALLOWED_EMAILS.includes(e)) {
        await fbSignOut(auth).catch(() => {})
        throw new Error('此 Google 帳號未授權，請聯絡店長加入白名單')
      }
      // onAuthStateChanged 會接手設定 user
      return buildUser(e, result.user?.displayName)
    }
    const e = (email || '').trim().toLowerCase()
    if (!e) throw new Error('請輸入 email')
    if (!ALLOWED_EMAILS.includes(e)) throw new Error('此帳號未授權，請聯絡店長加入白名單')
    const u = buildUser(e)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
    return u
  }

  const signOut = () => {
    if (isFirebaseConfigured) {
      fbSignOut(auth).catch(() => {})
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
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
      getToken: getIdToken,
      usingFirebase: isFirebaseConfigured,
      allowedEmails: ALLOWED_EMAILS,
      roleLabels: ROLE_LABELS,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
