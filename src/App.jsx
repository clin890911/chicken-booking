import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { BookingProvider } from './contexts/BookingContext'
import { ToastProvider, ConfirmProvider } from './components/ui/Toast'
import { LoadingScreen } from './components/ui'
import ErrorBoundary from './components/ErrorBoundary'
import HomePage from './pages/HomePage'
import BookingPage from './pages/BookingPage'
import ConfirmPage from './pages/ConfirmPage'
import ManageBookingPage from './pages/ManageBookingPage'
import LookupBookingPage from './pages/LookupBookingPage'
import LineBindPage from './pages/LineBindPage'
import LineMyBookingsPage from './pages/LineMyBookingsPage'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'
import SlotMapDemoPage from './pages/SlotMapDemoPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  // 用目前路徑當作 ErrorBoundary 的 resetKey：使用者切換頁面時自動清除錯誤狀態，
  // 避免某頁崩潰後即使導到別頁仍卡在錯誤畫面。
  const location = useLocation()
  return (
    <ErrorBoundary resetKey={location.pathname + location.search}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/confirm/:id" element={<ConfirmPage />} />
        <Route path="/lookup" element={<LookupBookingPage />} />
        <Route path="/manage/:id" element={<ManageBookingPage />} />
        <Route path="/line/bind" element={<LineBindPage />} />
        <Route path="/line/my-bookings" element={<LineMyBookingsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        <Route path="/demo/slot-map" element={<SlotMapDemoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <BookingProvider>
            <AppRoutes />
          </BookingProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}
