import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  auth, googleProvider, isFirebaseConfigured,
  signInWithPopup, signOut as fbSignOut, onAuthStateChanged, getIdToken,
} from '../services/firebase'
import { staffWhoAmI } from '../services/cloudDataService'
import { createStaffGate, verifyStaffRole } from '../utils/staffGate'
import { STAFF_DENIED_CODE, STAFF_DENIED_MESSAGE, STAFF_UNVERIFIED_CODE, STAFF_UNVERIFIED_MESSAGE } from '../utils/authErrors'

const STORAGE_KEY = 'chicken_auth_v1'

// === 角色權限體系 ===
// manager   店長：全部權限（含設定、員工管理、刪除訂位）
// floor     外場：操作桌位、訂位、候位（不能改設定）
// host      訂位專員：訂位 CRUD、候位管理、帶位指派桌位（不能維修停用桌位、不能改佈局）
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
// 匯出供測試綁定真實角色矩陣（元件的權限門測試不該自己抄一份角色表，否則這裡改了測試不會紅）
export const PERMISSIONS = {
  manager: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.delete', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge', 'table.config',
    'waitlist.read', 'waitlist.create', 'waitlist.update', 'waitlist.delete',
    'customer.read', 'customer.update', 'customer.delete', 'customer.blacklist',
    'group.read', 'group.create', 'group.update', 'group.delete', 'agency.manage',
    'settings.read', 'settings.update', 'settings.closures',
    'staff.manage',
  ]),
  floor: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update', 'customer.blacklist',
    // 外場可看今日團體並帶位入座。⚠️ 入座**不是**只走 table.update——
    // seatGroupBatch 會把團 status 改成 'arrived'（寫 groupReservations），
    // 換日掃除的 complete-group 也會寫，且掃除開機自動跑。故必須有 group.update。
    // 與後端 functions/lib/staffAccess.js 成對。不給 create/delete：delete 後端真的擋，
    // create 後端擋不了（集合層 upsert 分不出新建/更新），靠 GroupEditorStage 的
    // can('group.create') 把關——那道前端門是這個不變量唯一的實作，不可拿掉。
    'group.read', 'group.update',
  ]),
  host: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    // 與後端 staffAccess.js 成對：帶位/指派/換桌/併桌/團體入座皆寫 tables。
    'table.read', 'table.update',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update', 'customer.blacklist',
    'group.read', 'group.create', 'group.update', 'group.delete', 'agency.manage',
    // 窄權限：設定頁只能儲存「休店／關閉時段」（settings 的 CLOSURE_SETTING_KEYS），其餘設定唯讀。
    // 與後端 staffAccess.js 成對；後端只套客戶端改過的關閉 key、其餘沿用雲端值。
    'settings.closures',
  ]),
  kitchen: new Set([
    'booking.read',
    'table.read',
    'waitlist.read',
    'group.read',
  ]),
}

const AuthContext = createContext(null)

function buildUser(email, displayName, roleOverride) {
  const e = (email || '').trim().toLowerCase()
  const role = roleOverride || ROLE_MAP[e] || DEFAULT_ROLE
  return {
    email: e,
    displayName: displayName || e.split('@')[0],
    role,
    roleLabel: ROLE_LABELS[role] || role,
    loggedAt: new Date().toISOString(),
  }
}

const staffGate = createStaffGate({
  verify: () => verifyStaffRole({ getToken: getIdToken, whoAmI: staffWhoAmI }),
})

function codedError(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // 登入頁要顯示的帳號狀態：{kind:'denied'|'unverified', message} 或 null。
  // unverified＝Firebase session 保留、但還沒能向後端確認權限，可按「重試」。
  const [authNotice, setAuthNotice] = useState(null)
  const inflightRef = useRef(new Map())

  // 驗證只在這一處做（onAuthStateChanged 與 signIn 共用，同一 uid 的 in-flight 去重）。
  // 回傳 {status:'allowed', user} / {status:'denied'} / {status:'unverified', message} / {status:'stale'}
  const processFbUser = useCallback((fbUser) => {
    const uid = fbUser.uid || fbUser.email
    const inflight = inflightRef.current
    if (inflight.has(uid)) return inflight.get(uid)
    const email = (fbUser.email || '').toLowerCase()
    const run = async () => {
      // 前端白名單只負責 UI；真正的權限由後端 requireStaff 二次把關。
      if (email && ALLOWED_EMAILS.includes(email)) {
        const u = buildUser(email, fbUser.displayName)
        setUser(u); setAuthNotice(null); setLoading(false)
        return { status: 'allowed', user: u }
      }
      if (!email) {
        await fbSignOut(auth).catch(() => {})
        setUser(null); setAuthNotice({ kind: 'denied', message: STAFF_DENIED_MESSAGE }); setLoading(false)
        return { status: 'denied' }
      }
      // 不在建置期白名單 → 可能是後台動態新增的管理員，由閘門問後端（有快取則樂觀放行）。
      const res = await staffGate.check(email)
      if ((auth.currentUser?.email || '').toLowerCase() !== email) return { status: 'stale' }
      if (res.status === 'allowed') {
        const u = buildUser(email, fbUser.displayName, res.role)
        setUser(u); setAuthNotice(null); setLoading(false)
        res.background?.then((bg) => {
          if (bg.status === 'ok' && bg.changed) {
            setUser(prev => (prev && prev.email === email ? buildUser(email, fbUser.displayName, bg.role) : prev))
          } else if (bg.status === 'denied') {
            // 背景驗證被後端明確拒絕（例如店長剛停用此帳號）→ 登出。
            fbSignOut(auth).catch(() => {})
            setUser(null)
            setAuthNotice({ kind: 'denied', message: STAFF_DENIED_MESSAGE })
          }
        })
        return { status: 'allowed', user: u }
      }
      if (res.status === 'denied') {
        await fbSignOut(auth).catch(() => {})
        setUser(null); setAuthNotice({ kind: 'denied', message: STAFF_DENIED_MESSAGE }); setLoading(false)
        return { status: 'denied' }
      }
      // 網路／逾時／5xx：不登出，保留 Firebase session，讓登入頁顯示可重試的錯誤。
      setUser(null); setAuthNotice({ kind: 'unverified', message: STAFF_UNVERIFIED_MESSAGE }); setLoading(false)
      return { status: 'unverified', message: res.message }
    }
    const p = run().finally(() => { inflight.delete(uid) })
    inflight.set(uid, p)
    return p
  }, [])

  useEffect(() => {
    // 正式模式：交由 Firebase Auth 維護登入狀態（onAuthStateChanged）。
    if (isFirebaseConfigured) {
      const unsub = onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) {
          staffGate.cancelBackground()
          setUser(null)
          setLoading(false)
          return
        }
        try {
          await processFbUser(fbUser)
        } catch {
          // 預期外的錯誤也不能把人靜默踢出：當成暫時無法確認。
          setUser(null); setAuthNotice({ kind: 'unverified', message: STAFF_UNVERIFIED_MESSAGE }); setLoading(false)
        }
      })
      return unsub
    }
    // 本機開發 fallback：沒有 Firebase 設定時用 localStorage 模擬登入。
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [processFbUser])

  const outcomeOrThrow = (outcome) => {
    if (outcome.status === 'allowed') return outcome.user
    if (outcome.status === 'denied') throw codedError(STAFF_DENIED_CODE, STAFF_DENIED_MESSAGE)
    throw codedError(STAFF_UNVERIFIED_CODE, STAFF_UNVERIFIED_MESSAGE)
  }

  // 正式模式用 Google 彈窗登入；開發模式 fallback 用 email 模擬。
  // Firebase 路徑：只負責彈窗，權限驗證交給 processFbUser（與 onAuthStateChanged 共用 in-flight）。
  const signIn = async (email) => {
    if (isFirebaseConfigured) {
      setAuthNotice(null)
      const result = await signInWithPopup(auth, googleProvider)
      return outcomeOrThrow(await processFbUser(result.user))
    }
    const e = (email || '').trim().toLowerCase()
    if (!e) throw new Error('請輸入 email')
    if (!ALLOWED_EMAILS.includes(e)) throw new Error('此帳號未授權，請聯絡店長加入白名單')
    const u = buildUser(e)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
    return u
  }

  // 「無法確認權限」後的重試：沿用既有 Firebase session，不需重新彈 Google 視窗。
  const retryVerify = async () => {
    const fbUser = auth?.currentUser
    if (!fbUser) throw codedError(STAFF_UNVERIFIED_CODE, STAFF_UNVERIFIED_MESSAGE)
    setAuthNotice(null)
    return outcomeOrThrow(await processFbUser(fbUser))
  }

  const signOut = () => {
    staffGate.cancelBackground()
    staffGate.clear(user?.email) // 只清角色快取；不動訂位／顧客本機資料
    if (isFirebaseConfigured) {
      fbSignOut(auth).catch(() => {})
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    setAuthNotice(null)
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
      user, loading, signIn, signOut, can, authNotice, retryVerify,
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
