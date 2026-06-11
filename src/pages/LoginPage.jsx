import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Input, Button, Card } from '../components/ui'

export default function LoginPage() {
  const { signIn, usingFirebase, user } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // 登入成功後才導向，而且要「等 user 真的被設定」才導向：
  // Google 登入時 signIn() 不直接 setUser（由 onAuthStateChanged 非同步接手，
  // 動態管理員還要多一次後端確認）。若在 signIn() return 後立刻 nav('/admin')，
  // 此刻 user 可能仍為 null，ProtectedRoute 會把人踢回 /login —— 就是「第一次沒反應、
  // 要按第二次」的根因。改為響應 user 變化導向，第一次就成立；已登入訪問 /login 也會直接進後台。
  useEffect(() => {
    if (user) nav('/admin', { replace: true })
  }, [user, nav])

  const doSignIn = async (value) => {
    setErr('')
    setBusy(true)
    try {
      await signIn(value)
      // 成功後不在這裡 nav；交給上方 useEffect 等 user set 後導向（避免 race）。
      // 維持 busy=true 直到 user set、元件因導向而卸載。
    } catch (ex) {
      setErr(ex.message || '登入失敗，請再試一次')
      setBusy(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    doSignIn(email)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-cream to-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="text-6xl mb-2">🔐</div>
          <h1 className="text-2xl font-black text-chicken-brown">同仁登入</h1>
          <p className="text-sm text-chicken-brown/60 mt-1">雞王涮涮鍋管理後台</p>
        </div>

        <Card>
          {usingFirebase ? (
            <div className="space-y-4">
              <p className="text-sm text-chicken-brown/70 leading-6">
                請使用授權的 Google 帳號登入。僅限店長加入白名單的同仁帳號可進入後台。
              </p>
              <Button onClick={() => doSignIn()} disabled={busy} className="w-full">
                {busy ? '登入中...' : '使用 Google 登入'}
              </Button>
              {err && <p className="text-sm text-chicken-red font-bold">{err}</p>}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email（開發模式）"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                error={err}
              />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? '登入中...' : '🔑 模擬登入（僅本機開發）'}
              </Button>
              <p className="text-xs text-chicken-red bg-red-50 border border-chicken-red/40 rounded-lg px-3 py-2 leading-5">
                ⚠️ 未設定 Firebase，目前為本機開發模式，登入後資料<b>不會上傳雲端</b>。
                正式環境請設定 VITE_FIREBASE_* 後重新部署，登入會改用 Google。
              </p>
            </form>
          )}
        </Card>

        <Link to="/" className="block text-center text-xs text-chicken-brown/50 underline mt-4">回首頁</Link>
      </div>
    </div>
  )
}
