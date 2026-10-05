import crypto from 'node:crypto'
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
export const NOTIFICATION_LEASE_MS=60_000
export function notificationIdentity(doc){
 const version=String(doc.version||crypto.createHash('sha256').update(JSON.stringify(canonical(doc.payload||{}))).digest('hex'))
 return crypto.createHash('sha256').update(JSON.stringify([doc.channel,doc.event||'unknown',doc.bookingId||null,version])).digest('hex')
}
export function notificationIntent(doc,now){
 const id=doc.id||notificationIdentity(doc)
 return {id,channel:doc.channel,event:doc.event||'unknown',bookingId:doc.bookingId||null,version:String(doc.version||id),...(Number.isFinite(doc.bookingVersion)?{bookingVersion:doc.bookingVersion}:{}),stateHash:doc.stateHash||null,payload:doc.payload||{},status:'pending',createdAt:now,updatedAt:now,queueAttempts:0,lastError:null}
}
export function outboxFromIntent(intent,now){
 return {...intent,status:'pending',attempts:0,maxAttempts:6,nextAttemptAt:now,sentAt:null,leaseOwner:null,leaseExpiresAt:null}
}
export function claimNotification(data,owner,nowMs){
 if(!data||['sent','failed','superseded'].includes(data.status))return null
 const lease=Date.parse(data.leaseExpiresAt||'')
 if(data.status==='processing'&&Number.isFinite(lease)&&lease>nowMs)return null
 const next=Date.parse(data.nextAttemptAt||'')
 if(Number.isFinite(next)&&next>nowMs)return null
 return {...data,status:'processing',leaseOwner:owner,leaseExpiresAt:new Date(nowMs+NOTIFICATION_LEASE_MS).toISOString(),...(data.status==='processing'?{deliveryUnknown:true,lastError:'delivery-ack-unknown'}:{})}
}
export function deliveryUpdate(data,result,nowMs,backoff){
 const base={leaseOwner:null,leaseExpiresAt:null}
 if(result.ok)return {...base,status:'sent',sentAt:new Date(nowMs).toISOString(),lastError:null,nextAttemptAt:null}
 const attempts=(Number(data.attempts)||0)+1
 if(attempts>=(Number(data.maxAttempts)||6)||result.retryable===false)return {...base,status:'failed',attempts,lastError:String(result.error||'send-failed').slice(0,200),nextAttemptAt:null,failedAt:new Date(nowMs).toISOString(),...(result.retryable===false?{nonRetryable:true}:{})}
 return {...base,status:'pending',attempts,lastError:String(result.error||'send-failed').slice(0,200),nextAttemptAt:new Date(nowMs+backoff[Math.min(attempts-1,backoff.length-1)]).toISOString()}
}
export function aggregateNotificationHealth(entries,at){
 const values=Object.values(entries||{})
 const priority=['failed','retrying','pending','processing','sent']
 const status=priority.find(s=>values.some(v=>v.status===s))||(values.length?'sent':'pending')
 return {status,at,failed:values.filter(v=>v.status==='failed').length,pending:values.filter(v=>['pending','retrying','processing'].includes(v.status)).length}
}
export function healthEntry(intent,status,at,error=null){
 return {channel:intent.channel,event:intent.event,status,at,...(error?{error:String(error).split(':')[0].slice(0,80)}:{})}
}
// 待補送的舊版本不得冒充目前資訊；已在provider途中的請求仍無法撤回。
export function notificationIsSuperseded(data,current,stateHash){
 if(!data?.bookingId||data.event==='deleted')return false
 if(!current)return true
 if(['created','confirmed'].includes(data.event)&&current.status!=='confirmed')return true
 if(data.event==='updated'&&['cancelled','completed','noshow'].includes(current.status))return true
 if(data.event==='cancelled'&&current.status!=='cancelled')return true
 if(Number.isFinite(data.bookingVersion)&&Number(current.notificationVersion)>data.bookingVersion)return true
 return !!data.stateHash&&data.stateHash!==stateHash
}
