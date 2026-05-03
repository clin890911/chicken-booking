import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'chicken_auth_v1'
const ALLOWED_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || 'berrylin0911@gmail.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

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

  // 模擬 Google 登入：輸入 email，限定白名單
  const signIn = async (email) => {
    const e = (email || '').trim().toLowerCase()
    if (!e) throw new Error('請輸入 email')
    if (!ALLOWED_EMAILS.includes(e)) throw new Error('此帳號未授權，請聯絡管理員')
    const u = { email: e, displayName: e.split('@')[0], loggedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
    return u
  }

  const signOut = () => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, allowedEmails: ALLOWED_EMAILS }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
