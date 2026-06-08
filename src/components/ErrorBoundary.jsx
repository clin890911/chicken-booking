import { Component } from 'react'

// 全域錯誤邊界：任何頁面在 render 階段拋出例外時，不再讓整個 React tree 卸載
// 變成「空白畫面」，改為顯示可恢復的友善畫面，並把真實錯誤記到 console / 監控。
//
// 為什麼需要：本系統先前完全沒有 ErrorBoundary，只要某頁 render 丟一次例外
//（例如 ConfirmPage 對異常日期/時段做 new Date(...).toISOString() 會丟 RangeError），
// 整頁就會白屏，顧客只看到全白、無法操作。
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // 記錄真實錯誤，方便正式環境用瀏覽器 console 或日後接上監控時定位根因。
    console.error('[ErrorBoundary] 畫面發生未預期錯誤：', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // 路由變更（resetKey 改變）時自動清除錯誤狀態，讓使用者切換頁面即可恢復。
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-chicken-cream px-6 text-center">
        <div className="w-full max-w-sm rounded-3xl border border-chicken-brown/10 bg-white p-7 shadow-sm">
          <div className="text-5xl">🐔</div>
          <h1 className="mt-3 text-xl font-black text-chicken-brown">這個畫面出了點狀況</h1>
          <p className="mt-2 text-sm leading-6 text-chicken-brown/60">
            可能是網路或資料暫時異常。您的訂位資料不會因此遺失，請重新整理或回首頁再試一次。
          </p>
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary w-full"
            >
              重新整理
            </button>
            <a href="/" className="btn-secondary block w-full text-center">回首頁</a>
            <a href="tel:049-2753377" className="block pt-1 text-xs font-bold text-chicken-brown/55 underline">
              直接來電訂位 049-2753377
            </a>
          </div>
        </div>
      </div>
    )
  }
}
