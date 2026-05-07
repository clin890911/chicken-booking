import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { BookingProvider } from './contexts/BookingContext'
import { ToastProvider, ConfirmProvider } from './components/ui/Toast'
import { LoadingScreen } from './components/ui'
import HomePage from './pages/HomePage'
import BookingPage from './pages/BookingPage'
import ConfirmPage from './pages/ConfirmPage'
import ManageBookingPage from './pages/ManageBookingPage'
import LineBindPage from './pages/LineBindPage'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <BookingProvider>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/book" element={<BookingPage />} />
              <Route path="/confirm/:id" element={<ConfirmPage />} />
              <Route path="/manage/:id" element={<ManageBookingPage />} />
              <Route path="/line/bind" element={<LineBindPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BookingProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}
