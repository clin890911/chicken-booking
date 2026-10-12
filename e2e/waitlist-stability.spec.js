import { test, expect } from '@playwright/test'
import { startWaitlistBackend, FIREBASE_STUB, BACKEND_URL } from './helpers/waitlistSharedBackend.js'
import { testCommand } from '../tests/support/waitlistEmulator.js'

let backend, contexts=[]
test.beforeAll(async()=>{backend=await startWaitlistBackend()})
test.afterAll(async()=>{await backend?.close()})
test.beforeEach(async()=>{await backend.reset()})
test.afterEach(async()=>{await Promise.all(contexts.map(c=>c.close()));contexts=[]})
async function device(browser) {
  const context=await browser.newContext({viewport:{width:1024,height:1366}});contexts.push(context)
  await context.route('https://**/*',r=>r.abort())
  await context.route(`${BACKEND_URL}/adminWaitlistTransition`,async route=>{
    const command=route.request().postDataJSON()
    const barrier=backend.controls.barrier
    if(barrier&&command.action===barrier.action){
      barrier.routes.push(route)
      if(barrier.routes.length===barrier.count){backend.controls.barrier=null;await Promise.all(barrier.routes.map(r=>r.continue()))}
      return
    }
    if(!backend.controls.dropBrowserAck)return route.continue()
    backend.controls.dropBrowserAck=false
    // Reach the real HTTP handler/transaction, then deterministically discard its successful ACK.
    const response=await route.fetch()
    expect(response.status()).toBe(200)
    backend.controls.committedLostAck++
    return route.abort('failed')
  })
  await context.route('**/src/services/firebase.js*',r=>r.fulfill({contentType:'application/javascript',body:FIREBASE_STUB}))
  const page=await context.newPage();await page.goto('/admin')
  await expect(page.locator('aside').getByRole('button',{name:/現場/})).toBeVisible()
  await page.locator('aside').getByRole('button',{name:/現場/}).click()
  await page.getByRole('button',{name:/^候位\s*\d*$/}).click()
  return {context,page}
}
async function createThroughUI(page) {
  await page.getByRole('button',{name:/新增取號/}).click()
  await page.getByRole('button',{name:'4 位',exact:true}).click()
  await page.getByRole('button',{name:'取號',exact:true}).click()
}
async function showWaitlist(page){await page.locator('aside').getByRole('button',{name:/現場/}).click();await page.getByRole('button',{name:/^候位\s*\d*$/}).click()}
const commandHTTP=async command=>{const response=await fetch(`${BACKEND_URL}/adminWaitlistTransition`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer isolated-test-token'},body:JSON.stringify(command)});return {code:response.status,body:await response.json()}}
async function browserCommand(page,command){return page.evaluate(async command=>{
  const cloud=await import('/src/services/cloudDataService.js')
  try{const result=await cloud.operationalRequest('adminWaitlistTransition',command);cloud.acceptWaitlistCommandResult(result);return {code:200,result}}
  catch(error){return {code:error.status,error:error.code||error.message}}
},command)}

test('three actual browser service clients race same queue; cross-group table seat stays atomic and canonical after reload',async({browser})=>{
  for(const id of ['RACE','SEAT_A','SEAT_B'])expect((await commandHTTP(testCommand('create',id,0,{name:id,partySize:4,phone:''}))).code).toBe(200)
  const devices=await Promise.all(Array.from({length:3},()=>device(browser)))
  const responses=await Promise.all(devices.map(({page})=>browserCommand(page,testCommand('call','RACE',1))))
  expect(responses.map(r=>r.code).sort()).toEqual([200,409,409])
  const seats=await Promise.all(devices.slice(0,2).map(({page},i)=>browserCommand(page,testCommand('seat',i?'SEAT_B':'SEAT_A',1,{tableNumbers:['101']}))))
  expect(seats.map(r=>r.code).sort()).toEqual([200,409])
  expect((await backend.db.collection('bookings').get()).size).toBe(1)
  for(const {page}of devices){await page.reload();await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_v1')||'[]').find(w=>w.id==='RACE')?.queueVersion)).toBe(2)}
  expect((await backend.db.collection('tables').doc('101').get()).data().status).toBe('dining')
})

test('three isolated iPad-sized contexts: 50 groups canonical sync; independent storage; offline before send and lost committed ACK survive reload',async({browser})=>{
  for(let i=0;i<50;i++)expect((await commandHTTP(testCommand('create',`FIFTY_${i}`,0,{name:`測試組${i+1}`,partySize:4,phone:''}))).code).toBe(200)
  console.info('E2E_STAGE','seeded50')
  const devices=await Promise.all(Array.from({length:3},()=>device(browser)))
  console.info('E2E_STAGE','opened3')
  for(const {page}of devices)await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_v1')||'[]').length)).toBe(50)
  await devices[0].page.evaluate(()=>localStorage.setItem('isolated-device-proof','A'))
  expect(await devices[1].page.evaluate(()=>localStorage.getItem('isolated-device-proof'))).toBe(null)
  const a=devices[0]
  await a.context.setOffline(true)
  await createThroughUI(a.page)
  await expect.poll(()=>a.page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_commands_v1')||'[]').length)).toBe(1)
  await expect(a.page.getByText('尚未顯示成功。確認會重送原操作，請勿另建同一組。')).toBeVisible()
  await a.page.screenshot({path:'test-results/waitlist-stability-pending-offline.png',fullPage:true})
  expect((await backend.db.collection('waitlist').get()).size).toBe(50)
  await a.context.setOffline(false)
  await a.page.reload()
  await showWaitlist(a.page)
  const retry=a.page.getByRole('button',{name:/確認原操作|確認狀態|重新確認|確認結果|重試/}).first()
  await expect(retry).toBeVisible();await retry.click()
  await expect.poll(async()=>(await backend.db.collection('waitlist').get()).size).toBe(51)
  backend.controls.dropBrowserAck=true
  await a.page.getByRole('button',{name:/^候位\s*\d*$/}).click()
  await createThroughUI(a.page)
  await expect.poll(()=>backend.controls.committedLostAck).toBe(1)
  const original=await a.page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_commands_v1')||'[]')[0]?.command)
  expect(original).toBeTruthy();expect((await backend.db.collection('waitlist').get()).size).toBe(52)
  await expect(a.page.getByText('尚未顯示成功。確認會重送原操作，請勿另建同一組。')).toBeVisible()
  await a.page.screenshot({path:'test-results/waitlist-stability-pending-lost-ack.png',fullPage:true})
  await a.page.reload();await showWaitlist(a.page);await expect(retry).toBeVisible();await retry.click()
  await expect.poll(()=>a.page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_commands_v1')||'[]').length)).toBe(0)
  expect((await backend.db.collection('waitlist').get()).size).toBe(52)
  expect(backend.controls.requests.filter(c=>c.commandId===original.commandId).length).toBeGreaterThanOrEqual(2)
  for(const [i,{page}]of devices.entries()){await page.reload();await showWaitlist(page);await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_v1')||'[]').length)).toBe(52);await page.screenshot({path:`test-results/waitlist-stability-device-${i+1}.png`})}
})

const queueCard=(page,name)=>page.locator('div.rounded-xl.border-2').filter({has:page.getByText(name,{exact:true})})
test('three UI contexts with 50 groups: actual call buttons race, two UI seat confirmations race one table',async({browser})=>{
  for(let i=0;i<50;i++)expect((await commandHTTP(testCommand('create',`UI_${i}`,0,{name:`UI組${i+1}`,partySize:4,phone:''}))).code).toBe(200)
  const devices=await Promise.all(Array.from({length:3},()=>device(browser)))
  for(const {page}of devices)await expect(queueCard(page,'UI組1').getByRole('button',{name:'叫號',exact:true})).toBeVisible()
  backend.controls.barrier={action:'call',count:3,routes:[]}
  await Promise.all(devices.map(({page})=>queueCard(page,'UI組1').getByRole('button',{name:'叫號',exact:true}).click()))
  await expect.poll(async()=>(await backend.db.collection('waitlist').doc('UI_0').get()).data()?.queueVersion).toBe(2)
  for(const {page}of devices)await expect(queueCard(page,'UI組1').getByText('已叫號',{exact:true})).toBeVisible()
  expect(backend.controls.requests.filter(c=>c.id==='UI_0'&&c.action==='call')).toHaveLength(3)
  const seatDevices=devices.slice(0,2)
  for(const [i,{page}]of seatDevices.entries()){
    await queueCard(page,`UI組${i+2}`).getByRole('button',{name:'入座',exact:true}).click()
    await page.locator('[data-table-number="101"]').first().click()
    await expect(page.getByRole('button',{name:/確認入座|確認指派|確認併桌/}).first()).toBeVisible()
  }
  backend.controls.barrier={action:'seat',count:2,routes:[]}
  await Promise.all(seatDevices.map(({page})=>page.getByRole('button',{name:/確認入座|確認指派|確認併桌/}).first().click()))
  await expect.poll(async()=>(await backend.db.collection('bookings').get()).size).toBe(1)
  await expect.poll(()=>backend.controls.requests.filter(c=>c.action==='seat').length).toBe(2)
  const canonical=await backend.read(),winner=canonical.waitlist.find(w=>w.status==='seated'),loser=canonical.waitlist.find(w=>['UI_1','UI_2'].includes(w.id)&&w.status==='waiting')
  expect(winner).toBeTruthy();expect(loser).toBeTruthy();expect(canonical.tables.find(t=>t.number==='101').currentBookingId).toBe(winner.bookingId)
  for(const [i,{page}]of devices.entries()){
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_v1')||'[]').filter(w=>w.status==='seated').length)).toBe(1)
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_bookings_v1')||'[]').length)).toBe(1)
    await page.screenshot({path:`test-results/waitlist-stability-ui-race-${i+1}.png`,fullPage:true})
  }
})
