// Firebase 初始化（預留）。目前所有資料操作走 localStorage（見 bookingService / tableService）。
// 未來切換到 Firestore：填入 .env、把 service 層的 localStorage 操作改為 Firestore 呼叫即可。
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'placeholder',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'placeholder',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'placeholder',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'placeholder',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'placeholder',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'placeholder'
}

let app, auth, db, googleProvider
export const isFirebaseConfigured = firebaseConfig.apiKey !== 'placeholder'

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  googleProvider = new GoogleAuthProvider()
}

// 取得目前登入者的 Firebase ID Token（給呼叫受驗證的 admin Cloud Functions 用）
export async function getIdToken(forceRefresh = false) {
  if (!auth?.currentUser) return null
  try {
    return await auth.currentUser.getIdToken(forceRefresh)
  } catch {
    return null
  }
}

export { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged }
