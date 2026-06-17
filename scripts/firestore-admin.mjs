// 一次性 Firestore 維運工具：上線前備份 / 預覽 / 清除測試資料。
// 用法：
//   node scripts/firestore-admin.mjs backup            備份全部集合成 JSON
//   node scripts/firestore-admin.mjs dry-run           預覽 6 個目標集合筆數＋抽樣（不刪）
//   node scripts/firestore-admin.mjs purge --confirm   實刪 6 個目標集合（沒 --confirm 只預覽）
//
// 金鑰：預設讀專案根 serviceAccountKey.json，或用 SA_KEY=<path> 指定。
// firebase-admin 借用 functions/node_modules，不污染根目錄依賴。

import { createRequire } from 'module'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const PROJECT_ID = 'chicken-booking-tw'
// 要清空的集合（使用者已確認：6 個營運集合 + 3 個後端測試殘留集合）
const TARGET_COLLECTIONS = [
  'bookings', 'groupReservations', 'waitlist', 'customers', 'agencies', 'guides',
  'lineBookingBindings', 'notifications', 'rateLimits',
]
// 一律保留的集合（tables 桌位/settings 店鋪設定/admins 店員/system sync 時間戳）
const KEEP_COLLECTIONS = ['tables', 'settings', 'admins', 'system']

let admin
try {
  admin = require(join(ROOT, 'functions', 'node_modules', 'firebase-admin'))
} catch {
  console.error('✗ 找不到 firebase-admin。請先在 functions/ 跑過 npm install。')
  process.exit(1)
}

const keyPath = process.env.SA_KEY || join(ROOT, 'serviceAccountKey.json')
if (!existsSync(keyPath)) {
  console.error(`✗ 找不到 service account 金鑰：${keyPath}\n`)
  console.error('取得方式：')
  console.error(`  Firebase Console → 專案 ${PROJECT_ID} → ⚙️ 專案設定 → 服務帳戶`)
  console.error('  → Firebase Admin SDK → 「產生新的私密金鑰」→ 下載 JSON')
  console.error(`  下載後放到 ${join(ROOT, 'serviceAccountKey.json')}，或用 SA_KEY=<path> 指定。`)
  process.exit(1)
}

const cred = JSON.parse(readFileSync(keyPath, 'utf8'))
// 防呆：金鑰必須指向正確專案，避免動錯資料庫
if (cred.project_id && cred.project_id !== PROJECT_ID) {
  console.error(`✗ 金鑰 project_id 是「${cred.project_id}」，預期「${PROJECT_ID}」。中止以免動錯專案。`)
  process.exit(1)
}
admin.initializeApp({ credential: admin.credential.cert(cred), projectId: PROJECT_ID })
const db = admin.firestore()

const cmd = process.argv[2]
const confirmed = process.argv.includes('--confirm')

function summary(col, d) {
  if (col === 'bookings') return { name: d.name, phone: d.phone, date: d.date, timeSlot: d.timeSlot, status: d.status }
  if (col === 'groupReservations') return { agency: d.agencyName, date: d.date, total: d.counts?.total, status: d.status }
  if (col === 'waitlist') return { name: d.name, phone: d.phone, guests: d.guests, status: d.status }
  if (col === 'customers') return { name: d.name, phone: d.phone }
  if (col === 'agencies') return { name: d.name }
  if (col === 'guides') return { name: d.name, phone: d.phone }
  if (col === 'lineBookingBindings') return { bookingId: d.bookingId, name: d.booking?.name, line: d.lineDisplayName }
  if (col === 'notifications') return { event: d.event, status: d.status, bookingId: d.bookingId }
  if (col === 'rateLimits') return { count: d.count, updatedAt: d.updatedAt }
  return d
}

async function backup() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(ROOT, 'backups', `firestore-${ts}`)
  mkdirSync(dir, { recursive: true })
  console.log(`備份 → ${dir}\n`)
  const cols = await db.listCollections()
  let total = 0
  for (const c of cols) {
    const snap = await c.get()
    const data = snap.docs.map(d => ({ id: d.id, data: d.data() }))
    writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(data, null, 2))
    total += data.length
    console.log(`  ${c.id.padEnd(20)} ${String(data.length).padStart(5)} 筆`)
  }
  console.log(`\n✅ 備份完成：${cols.length} 個集合、共 ${total} 筆 → ${dir}`)
}

async function dryRun() {
  console.log('=== DRY-RUN（不刪任何東西）===\n')
  console.log('🗑️  即將清空的目標集合：')
  let grand = 0
  for (const col of TARGET_COLLECTIONS) {
    const snap = await db.collection(col).get()
    grand += snap.size
    console.log(`\n  ■ ${col}: ${snap.size} 筆`)
    snap.docs.slice(0, 5).forEach(d => console.log(`      - ${d.id}: ${JSON.stringify(summary(col, d.data()))}`))
    if (snap.size > 5) console.log(`      …其餘 ${snap.size - 5} 筆`)
  }
  console.log(`\n  目標集合合計：${grand} 筆\n`)
  console.log('✅ 保留不動的設定集合：')
  for (const col of KEEP_COLLECTIONS) {
    const snap = await db.collection(col).get()
    console.log(`  ${col.padEnd(12)} ${snap.size} 筆（保留）`)
  }
}

async function purge() {
  if (!confirmed) {
    console.log('⚠️ 未帶 --confirm，僅預覽不刪除。\n')
    await dryRun()
    console.log('\n→ 確認無誤後，執行：node scripts/firestore-admin.mjs purge --confirm')
    return
  }
  console.log('=== PURGE 實刪（已帶 --confirm）===\n')
  let grand = 0
  for (const col of TARGET_COLLECTIONS) {
    const snap = await db.collection(col).get()
    const docs = snap.docs
    for (let i = 0; i < docs.length; i += 450) {
      const batch = db.batch()
      docs.slice(i, i + 450).forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
    grand += docs.length
    console.log(`  ${col.padEnd(20)} 刪除 ${docs.length} 筆`)
  }
  console.log(`\n✅ 清除完成：共刪 ${grand} 筆。建議再跑 dry-run 確認目標集合皆為 0。`)
}

const run = { backup, 'dry-run': dryRun, purge }[cmd]
if (!run) {
  console.log('用法: node scripts/firestore-admin.mjs <backup | dry-run | purge [--confirm]>')
  process.exit(1)
}
run().then(() => process.exit(0)).catch(err => { console.error('✗ 失敗：', err); process.exit(1) })
