import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-cream to-white flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-7xl mb-4">🐔</div>
        <h1 className="text-3xl font-black text-chicken-red mb-2">雞王刷刷鍋</h1>
        <p className="text-sm text-chicken-brown/70 mb-1">Master of Chicken</p>
        <p className="text-xs text-chicken-brown/50 mb-8">48 小時冷藏文昌雞 · 鹿芝谷主場館</p>

        <div className="space-y-3">
          <Link
            to="/book"
            className="block w-full bg-chicken-red hover:opacity-90 active:scale-[.98] text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-md"
          >
            🍲 我要訂位
          </Link>
          <Link
            to="/admin"
            className="block w-full bg-white hover:bg-chicken-cream active:scale-[.98] text-chicken-brown font-bold py-3 px-6 rounded-2xl transition-all border border-chicken-brown/15 text-sm"
          >
            🔐 同仁登入
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-chicken-brown/10 text-xs text-chicken-brown/50">
          <p>營業時間 11:00 - 19:00</p>
          <p className="mt-1">© Master of Chicken</p>
        </div>
      </div>
    </div>
  )
}
