import {useState,useRef,useEffect} from 'react'
import {useHandoff} from '../../../contexts/HandoffContext'
import {useBooking} from '../../../contexts/BookingContext'
import {todayStr} from '../../../utils/timeSlots'
import {commandId,resolveTaskTarget} from '../../../services/handoffService'
const COLLAPSE_KEY='handoffPanelCollapsed'
// 讀寫 localStorage 一律 try/catch（私密視窗／封鎖網站資料時會丟例外）→ 失敗就用預設
const readStored=()=>{try{const v=localStorage.getItem(COLLAPSE_KEY);return v==='1'?true:v==='0'?false:null}catch{return null}}
const writeStored=v=>{try{localStorage.setItem(COLLAPSE_KEY,v?'1':'0')}catch{/* 儲存失敗不影響操作 */}}
export default function HandoffPanel({onLocate}){
 const {tasks,loaded,error,canWrite,changeTask,refresh}=useHandoff()
 const {bookings,tables}=useBooking()
 // 一律預設收成一行（2026-10-30 頁面捲動第 1 批：展開的卡片固定吃 ~260px，把帶位面板擠到 iPad Safari 只剩 145px、人數鍵看不到）。
 // 展開／收合＝這台裝置上店員自己的偏好，記在 localStorage；有新待辦也「不」自動展開，改成收合列的徽章亮起。
 const [collapsed,setCollapsed]=useState(()=>readStored()??true)
 // seen＝店員「上次看到」的待辦數（展開時持續跟上）；收合時待辦數超過它 → 收合列亮「新」。null＝首次載入前。
 const [seen,setSeen]=useState(null)
 const [date,setDate]=useState(todayStr()),[tab,setTab]=useState('pending'),[busy,setBusy]=useState(null),[failure,setFailure]=useState('')
 const pending=useRef(new Map())
 const failedTask=useRef(null)
 useEffect(()=>{
  const failed=failedTask.current
  if(!failed)return
  const latest=tasks.find(t=>t.id===failed.id)
  if(latest&&latest.version>failed.version&&latest.status===failed.status){setFailure('');failedTask.current=null}
 },[tasks])
 const items=tasks.filter(t=>t.date===date&&t.status===tab)
 const pendingCount=tasks.filter(t=>t.date===date&&t.status==='pending').length
 // 首次載入完成時的待辦不算「新」（開機就有的，收合列本來就會顯示筆數）；展開中＝看得到，基準跟上；別台完成了 → 基準往下調
 if(loaded&&seen===null)setSeen(pendingCount)
 else if(seen!==null&&seen!==pendingCount&&(!collapsed||pendingCount<seen))setSeen(pendingCount)
 const fresh=collapsed&&seen!==null&&pendingCount>seen?pendingCount-seen:0
 const toggle=()=>{const next=!collapsed;setCollapsed(next);writeStored(next);if(!next)setSeen(pendingCount)}
 const act=async(task)=>{
  if(busy)return
  const action=tab==='pending'?'complete':'reopen',key=task.id+':'+task.version+':'+action
  if(!pending.current.has(key))pending.current.set(key,commandId())
  setBusy(task.id);setFailure('')
  const result=await changeTask(task,action,pending.current.get(key));setBusy(null)
  if(!result.ok){failedTask.current={id:task.id,version:task.version,status:action==='complete'?'completed':'pending'};setFailure(result.error)}
  else {pending.current.delete(key);failedTask.current=null}
 }
 // 收合 → 一條細列（視覺約 32px、可點區 44px（min-h 44＋負 margin 抵銷 12px），不再是卡片）：帶位欄每一像素都要還給帶位面板。
 // 有待辦：筆數用紅色徽章；收合期間又進來新待辦 → 多一顆琥珀色「新 +N」徽章（不靠動畫，靜態就看得到），按下展開後才消失。
 // 仍保留入口（看已完成／別天的交班），不整個藏掉。
 if(collapsed)return <section aria-label="現場交班待辦" data-compact="true" data-fresh={fresh?'true':undefined} className="flex-none">
  <button aria-expanded={false} onClick={toggle} className={`w-full text-left text-xs min-h-[44px] -my-[6px] px-1 flex items-center gap-1.5 ${pendingCount?'text-chicken-brown font-bold':'text-chicken-brown/55'}`}>
   交班待辦{pendingCount?<span data-testid="handoff-pending-badge" className="inline-flex items-center h-[22px] px-2 rounded-full bg-chicken-red text-white tabular-nums">{pendingCount} 筆</span>:' 0'}
   {fresh>0&&<span data-testid="handoff-fresh-badge" role="status" className="inline-flex items-center h-[22px] px-2 rounded-full bg-amber-300 text-amber-950 ring-2 ring-amber-500 tabular-nums">新 +{fresh}</span>}
   <span className="font-normal text-chicken-brown/55">·</span><span className="font-normal underline underline-offset-2">展開</span>
  </button>
 </section>
 return <section aria-label="現場交班待辦" className="rounded-xl border bg-white p-3 flex flex-col gap-2 max-h-[260px] overflow-hidden flex-none">
  <div className="grid items-center gap-2 flex-none grid-cols-[minmax(0,1fr)_120px_36px]">
   <button aria-expanded onClick={toggle} className="font-bold text-sm text-left min-h-[44px]">交班待辦 {pendingCount} <span className="text-xs font-normal">收合</span></button>
   <input aria-label="交班日期" type="date" value={date} onChange={e=>setDate(e.target.value)} className="min-h-[44px] w-full text-xs"/><button onClick={refresh} className="min-h-[44px] underline text-xs">重整</button>
  </div>
   <div className="flex gap-2 flex-none">{[['pending','待辦'],['completed','已完成']].map(([value,label])=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)} className="min-h-[44px] px-3 border rounded-lg text-xs">{label} {tasks.filter(t=>t.date===date&&t.status===value).length}</button>)}</div>
   {(error||failure)&&<p role="alert" className="text-chicken-red text-xs flex-none">{failure||error}</p>}
   <div data-testid="handoff-task-list" className="overflow-y-auto min-h-0 space-y-1.5 overscroll-contain">
   {!loaded?<p>讀取交班資料中…</p>:!items.length?<p className="text-xs text-chicken-brown/60">{tab==='pending'?'這天沒有待辦事項':'這天尚無已完成事項'}</p>:items.map(task=>{
    const target=resolveTaskTarget(task,bookings,tables)
    const time=new Date(task.completedAt||task.createdAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})
    return <div key={task.id} className="rounded-lg border px-2 py-1.5 flex items-center justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><b className="text-sm leading-5 break-words">{task.label}</b><small className="flex-none text-[10px] text-chicken-brown/55" title={task.completedAt?'完成時間':'建立時間'}>{time}</small></div><button disabled={!target.numbers.length} onClick={()=>onLocate?.(target.numbers[0])} className="block underline text-xs min-h-[44px] text-left leading-4">{target.label}</button></div>{canWrite&&<button disabled={!!busy} onClick={()=>act(task)} className="min-h-[44px] px-2 border rounded-lg text-xs flex-none">{busy===task.id?'儲存中…':tab==='pending'?'完成':'恢復待辦'}</button>}</div>
   })}
   </div>
 </section>
}
