import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Input, Button, Card } from '../components/ui'

export default function LoginPage() {
  const { signIn, allowedEmails } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('berrylin0911@gmail.com')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await signIn(email)
      nav('/admin', { replace: true })
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-cream to-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="text-6xl mb-2">🔐</div>
          <h1 className="text-2xl font-black text-chicken-brown">同仁登入</h1>
          <p className="text-sm text-chicken-brown/60 mt-1">雞王刷刷鍋管理後台</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              error={err}
            />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? '登入中...' : '🔑 模擬 Google 登入'}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t border-chicken-brown/10 text-xs text-chicken-brown/60">
            <p className="font-bold mb-1">💡 開發模式</p>
            <p>目前用 localStorage 模擬登入，未來接 Firebase Auth。</p>
            <p className="mt-1">已授權 email：</p>
            <ul className="mt-0.5 space-y-0.5">
              {allowedEmails.map(e => <li key={e} className="font-mono">· {e}</li>)}
            </ul>
          </div>
        </Card>

        <Link to="/" className="block text-center text-xs text-chicken-brown/50 underline mt-4">回首頁</Link>
      </div>
    </div>
  )
}
