import http from 'node:http'
import { createWaitlistHandler } from '../../functions/lib/waitlistCommands.js'
import { connectWaitlistEmulator, resetEmulator, seedEmulator } from '../../tests/support/waitlistEmulator.js'

export const BACKEND_URL = 'http://127.0.0.1:5201'
// HTTP transport and read-only pull adapter only. All mutations use the product's real DI handler/Firestore transaction.
export async function startWaitlistBackend() {
  const env = connectWaitlistEmulator()
  const controls = { dropNextAck: false, dropBrowserAck:false, committedLostAck: 0, rejectBeforeCommit: false, requests: [], notifications: 0 }
  const handler = createWaitlistHandler({ db: env.measured, requireStaff: async req => {
    if (req.headers.authorization !== 'Bearer isolated-test-token') throw Object.assign(Error('unauthorized'),{status:401})
    return { uid: req.headers['x-test-device'] || 'TEST_STAFF', role:'floor' }
  }, afterCommit: async () => {} })
  const read = async () => {
    const names=['bookings','tables','waitlist','customers','agencies','guides','groupReservations','handoffTasks']
    const entries=await Promise.all(names.map(async n=>[n,(await env.db.collection(n).get()).docs.map(d=>({id:d.id,...d.data()}))]))
    return {ok:true,serverCollections:names,...Object.fromEntries(entries),settings:(await env.db.collection('settings').doc('main').get()).data()||{}}
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-Test-Device');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
    try {
      const url=new URL(req.url,BACKEND_URL)
      if(url.pathname==='/adminPullData'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await read()));return}
      if(url.pathname!=='/adminWaitlistTransition'){res.writeHead(501);res.end(JSON.stringify({ok:false,error:'test-endpoint-not-implemented'}));return}
      const chunks=[];for await(const chunk of req)chunks.push(chunk)
      const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');controls.requests.push(body)
      if(controls.rejectBeforeCommit){req.socket.destroy();return}
      let status=200
      await handler({method:req.method,headers:req.headers,body},{status(code){status=code;return this},json(value){
        if(controls.dropNextAck&&status===200){controls.dropNextAck=false;controls.committedLostAck++;req.socket.destroy();return}
        res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))
      }})
    }catch(error){if(!res.destroyed){res.writeHead(500);res.end(JSON.stringify({ok:false,error:error.message}))}}
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5201,'127.0.0.1',resolve)})
  return {...env,controls,read,async reset(){await resetEmulator();await seedEmulator(env.db);controls.requests.length=0;controls.dropNextAck=false;controls.rejectBeforeCommit=false},async close(){await new Promise(resolve=>server.close(resolve));await env.close()}}
}

// Test-only module substitute: actual AuthContext/BookingContext/commands run; Firebase network/token acquisition is stubbed.
export const FIREBASE_STUB = `
export const isFirebaseConfigured=true;
const user={uid:'TEST_STAFF',email:'berrylin0911@gmail.com',displayName:'隔離測試員'};
export const auth={currentUser:user}, db=null,googleProvider={};
export async function getIdToken(){return 'isolated-test-token'}
export function onAuthStateChanged(_auth,fn){queueMicrotask(()=>fn(user));return ()=>{}}
export async function signInWithPopup(){return {user}}
export async function signOut(){}
`
