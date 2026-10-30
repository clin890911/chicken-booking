// 測試專用：以 page.route 換掉 src/services/firebase.js。AuthContext／BookingContext 照真的跑，
// 只把 Firebase 網路與取 token 換成固定值——讓需要「已登入且拿得到 ID Token」的員工路徑
// （adminPullData／adminPushData 等走 strictAuthHeader 的請求）在 E2E 裡真的送出。
// 後端端點仍須由各 spec 自己攔截；這裡不提供任何回應。
export const FIREBASE_STUB = `
export const isFirebaseConfigured=true;
const user={uid:'TEST_STAFF',email:'berrylin0911@gmail.com',displayName:'隔離測試員'};
export const auth={currentUser:user}, db=null,googleProvider={};
export async function getIdToken(){return 'isolated-test-token'}
export function onAuthStateChanged(_auth,fn){queueMicrotask(()=>fn(user));return ()=>{}}
export async function signInWithPopup(){return {user}}
export async function signInWithRedirect(){}
export async function getRedirectResult(){return null}
export const authOnSameOrigin=false;
export async function signOut(){}
`
