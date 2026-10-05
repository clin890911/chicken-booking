import {it,expect,describe} from 'vitest'
import crypto from 'node:crypto'
import {consumeLineLoginState} from '../../functions/lib/lineLogin'
const now=Date.parse('2026-10-05T12:00:00+08:00')
function fake(data){let saved=data,locked=Promise.resolve(),fail=false;const ref={};return {setFail:v=>{fail=v},exists:()=>!!saved,collection:()=>({doc:()=>ref}),runTransaction:fn=>{const run=locked.then(async()=>{let removed=false;const result=await fn({get:async()=>({exists:!!saved,data:()=>saved}),delete:()=>{removed=true}});if(fail)throw Error('MOCK_DELETE_COMMIT_FAILED');if(removed)saved=null;return result});locked=run.catch(()=>{});return run}}}
const valid=()=>({bookingId:'B',manageToken:'MOCK_MANAGE_TOKEN',expiresAt:new Date(now+60000).toISOString()})
describe('OAuth state實際consume helper',()=>{
 it('並發兩consume僅一次成功（第二個無法交換code）',async()=>{
  const db=fake(valid()),state=crypto.randomBytes(24).toString('hex'),results=await Promise.allSettled([consumeLineLoginState(db,state,now),consumeLineLoginState(db,state,now)])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(db.exists()).toBe(false)
 })
 it.each([undefined,'','bad',new Date(now).toISOString(),new Date(now-1).toISOString()])('missing/invalid/expired expiry%s failclosed不consume',async expiresAt=>{
  const db=fake({...valid(),expiresAt});await expect(consumeLineLoginState(db,crypto.randomBytes(24).toString('hex'),now)).rejects.toThrow('expired-state');expect(db.exists()).toBe(true)
 })
 it('delete/commit失敗不consume，不吞掉失敗繼續exchange',async()=>{
  const db=fake(valid());db.setFail(true);await expect(consumeLineLoginState(db,crypto.randomBytes(24).toString('hex'),now)).rejects.toThrow('MOCK_DELETE_COMMIT_FAILED');expect(db.exists()).toBe(true)
 })
 it('非48hex state無db讀寫',async()=>{let calls=0;await expect(consumeLineLoginState({collection:()=>{calls++}},'invalid',now)).rejects.toThrow('invalid-state');expect(calls).toBe(0)})
})
