// @vitest-environment node
// adminPushData（真 handler）× 本機 Firestore emulator：休店／關閉三方合併（真 transaction、真 mergeFields 語意）。
// 只在 emulator 下執行（npm test 沒設 FIRESTORE_EMULATOR_HOST 時整段略過）：
//   firebase emulators:exec --only firestore --project demo-closures-merge \
//     "npx vitest run tests/functions/closuresMerge.emulator.test.js"
// 🔴 安全：只接受 127.0.0.1 的 emulator＋demo-* 專案 id，絕不碰正式 Firestore。
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildAdminPush, normalizeStoreSettings } from '../helpers/adminPushHarness'
import { CLOUD, defineClosuresMergeScenarios } from '../helpers/closuresMergeScenarios'

const host = process.env.FIRESTORE_EMULATOR_HOST || ''
const projectId = process.env.GCLOUD_PROJECT || 'demo-closures-merge'
const enabled = host.startsWith('127.0.0.1:') && projectId.startsWith('demo-')

describe.runIf(enabled)('adminPushData：closures 三方合併（Firestore emulator）', () => {
  let app
  let db
  let call
  beforeAll(() => {
    if (!host.startsWith('127.0.0.1:')) throw new Error('FIRESTORE_EMULATOR_HOST 必須是 127.0.0.1')
    const require = createRequire(resolve('functions/package.json'))
    const { initializeApp, deleteApp } = require('firebase-admin/app')
    const { getFirestore } = require('firebase-admin/firestore')
    app = initializeApp({ projectId }, 'closures-merge-' + Date.now())
    app.__delete = () => deleteApp(app)
    db = getFirestore(app)
    call = buildAdminPush(db)
  })
  afterAll(async () => { await app?.__delete() })
  beforeEach(async () => {
    expect(app.options.projectId.startsWith('demo-')).toBe(true)
    await db.collection('settings').doc('main').set(structuredClone(CLOUD))
  })
  const read = async () => (await db.collection('settings').doc('main').get()).data()
  defineClosuresMergeScenarios(() => ({ call, read }))

  it('真並行：host 與店長同時送出（transaction 互相重跑）→ 兩人的日期都在', async () => {
    const base = normalizeStoreSettings(CLOUD)
    const push = (role, closedDates, extra = {}) => call(role, {
      partial: true, settingsChangedKeys: ['closures'], closuresBase: base.closures,
      dataset: { settings: { ...base, ...extra, closures: { ...base.closures, closedDates } } },
    })
    const results = await Promise.all([
      push('host', ['2026-10-20', '2026-11-01']),
      push('manager', ['2026-10-20', '2026-11-02'], { openTime: '10:45' }),
      push('host', ['2026-10-20', '2026-11-03']),
    ])
    results.forEach(r => expect(r.code).toBe(200))
    const saved = await read()
    expect([...saved.closures.closedDates].sort()).toEqual(['2026-10-20', '2026-11-01', '2026-11-02', '2026-11-03'])
    expect(saved.openTime).toBe('10:45')
  })
})
