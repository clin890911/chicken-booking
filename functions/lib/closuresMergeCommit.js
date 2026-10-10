// adminPushData：settings/main 的 closures 以「三方合併」在 Firestore transaction 內原子寫入。
// （純合併規則見 ./closuresMerge.js；本檔只負責「讀雲端→合併→寫回」放在同一個 transaction。）
//
// 為何在後端 transaction 而不是前端先拉再推：前端「拉取→合併→推送」之間別台仍可能存檔，
// 競態窗口是整個網路往返；transaction 內讀到的雲端值若在 commit 前被別人改掉，Firestore 會自動重跑，
// 保證合併的 remote 就是實際被覆寫的那一份。
//
// 只有新前端（請求帶 closuresBase＝該裝置同步基準線內的 closures）才走這裡；舊前端維持 PR #162 行為。
import { mergeClosures, sameClosures } from './closuresMerge.js'
import { settingsReplaceOptions } from './settingsGuard.js'

// 參數：
//   db, ref      Firestore 實例與 settings/main 參照（呼叫端注入，本檔不 import firebase-admin，可單測）
//   base, local  基準線 closures、存檔者本機 closures（原始形狀；本函式會正規化）
//   normalize    後端 normalizeStoreSettings（只取其 .closures）
//   buildData    ({ cloudRaw, closures, remote }) => 要寫入的資料物件 | null（null＝免寫）。
//                頂層 key 以 mergeFields 整欄替換（settingsReplaceOptions），沒列出的欄位不動。
// 回傳：{ cloudRaw, remote, closures, conflicts, wrote }
//   closures  合併並正規化後、此刻在雲端的 closures（前端據此推進基準線與 rebase 本機）
export async function commitClosuresMerge({ db, ref, base, local, normalize, buildData }) {
  const norm = c => normalize({ closures: c }).closures
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const cloudRaw = snap.exists ? (snap.data() || {}) : {}
    const remote = norm(cloudRaw.closures)
    const { merged, conflicts } = mergeClosures(norm(base), norm(local), remote)
    const closures = norm(merged)
    const data = buildData({ cloudRaw, closures, remote, unchanged: sameClosures(remote, closures) })
    if (data) tx.set(ref, data, settingsReplaceOptions(data))
    return { cloudRaw, remote, closures, conflicts, wrote: !!data }
  })
}
