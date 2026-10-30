import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Input, Button, Card } from '../components/ui'
import GlyphText from '../components/ui/GlyphText'
import { describeAuthError } from '../utils/authErrors'
import { useAdminAppManifest } from '../hooks/useAppManifest'
import { KeyRound, LockKeyhole, TriangleAlert } from 'lucide-react'

// 彈窗登入多久沒回應就顯示「改用整頁方式登入」
export const SLOW_LOGIN_MS = 15000

export default function LoginPage() {
  const { signIn, signInRedirect, usingFirebase, user, authNotice, retryVerify } = useAuth()
  useAdminAppManifest() // 從登入頁「加入主畫面」＝後台 App
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [errDetail, setErrDetail] = useState('')
  const [busy, setBusy] = useState(false)
  // 「登入中…」超過 15 秒沒結果：多半是彈窗的結果回不來（iOS／主畫面 App），給整頁導向的出口，不讓人卡死
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!busy) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), SLOW_LOGIN_MS)
    return () => clearTimeout(t)
  }, [busy])

  // 登入成功後才導向，而且要「等 user 真的被設定」才導向：
  // Google 登入時 signIn() 不直接 setUser（由 onAuthStateChanged 非同步接手，
  // 動態管理員還要多一次後端確認）。若在 signIn() return 後立刻 nav('/admin')，
  // 此刻 user 可能仍為 null，ProtectedRoute 會把人踢回 /login —— 就是「第一次沒反應、
  // 要按第二次」的根因。改為響應 user 變化導向，第一次就成立；已登入訪問 /login 也會直接進後台。
  useEffect(() => {
    if (user) nav('/admin', { replace: true })
  }, [user, nav])

  // 把任何錯誤轉成中文顯示；使用者自己關彈窗／連點造成的取消不顯示錯誤。
  const showError = (ex) => {
    const d = describeAuthError(ex)
    setErr(d.silent ? '' : d.message)
    setErrDetail(d.silent ? '' : d.detail)
  }

  const doSignIn = async (value) => {
    if (busy) return // 防連點：第二次彈窗會讓第一次變成 cancelled-popup-request
    setErr('')
    setErrDetail('')
    setBusy(true)
    try {
      await signIn(value)
      // 成功後不在這裡 nav；交給上方 useEffect 等 user set 後導向（避免 race）。
      // 維持 busy=true 直到 user set、元件因導向而卸載。
    } catch (ex) {
      showError(ex)
      setBusy(false)
    }
  }

  // 無法確認權限（連線不穩）時重試：沿用既有 Firebase session，不重新彈 Google 視窗。
  const doRetry = async () => {
    if (busy) return
    setErr('')
    setErrDetail('')
    setBusy(true)
    try {
      await retryVerify()
    } catch (ex) {
      showError(ex)
      setBusy(false)
    }
  }

  const doRedirect = async () => {
    setErr('')
    setErrDetail('')
    setBusy(true)
    try {
      await signInRedirect()
    } catch (ex) {
      showError(ex)
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
          <LockKeyhole size={52} strokeWidth={1.8} aria-hidden="true" className="mx-auto mb-3 text-chicken-red" />
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
                {busy ? '登入中…' : '使用 Google 登入'}
              </Button>
              {busy && slow && (
                <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3">
                  <p className="text-sm font-bold text-amber-800">登入一直沒有回應？</p>
                  <p className="text-xs leading-5 text-amber-800">
                    Google 登入視窗的結果可能沒傳回來（常見於 iPhone／iPad 或主畫面 App）。改用整頁方式登入，會直接跳到 Google 再回來。
                  </p>
                  <Button onClick={doRedirect} className="w-full">改用整頁方式登入</Button>
                </div>
              )}
              {(err || authNotice) && (
                <div role="alert" className="space-y-2">
                  <p className="text-sm text-chicken-red font-bold">{err || authNotice.message}</p>
                  {errDetail && <p className="text-xs text-chicken-brown/50">錯誤代碼：{errDetail}</p>}
                  {authNotice?.kind === 'unverified' && (
                    <Button onClick={doRetry} disabled={busy} className="w-full">
                      {busy ? '確認中…' : '重試'}
                    </Button>
                  )}
                </div>
              )}
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
                {busy ? '登入中…' : <GlyphText icon={KeyRound} size={18}>模擬登入（僅本機開發）</GlyphText>}
              </Button>
              <p className="text-xs text-chicken-red bg-red-50 border border-chicken-red/40 rounded-lg px-3 py-2 leading-5">
                <TriangleAlert size={14} strokeWidth={2.4} aria-hidden="true" className="mr-1 inline-block align-[-2px]" />未設定 Firebase，目前為本機開發模式，登入後資料<b>不會上傳雲端</b>。
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
