import {useState,useRef,useEffect} from 'react'
import {useHandoff} from '../../../contexts/HandoffContext'
import {useBooking} from '../../../contexts/BookingContext'
import {todayStr} from '../../../utils/timeSlots'
import {commandId,resolveTaskTarget} from '../../../services/handoffService'
export default function HandoffPanel({onLocate}){
 const {tasks,loaded,error,canWrite,changeTask,refresh}=useHandoff()
 const {bookings,tables}=useBooking()
 const [collapsed,setCollapsed]=useState(false)
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
 const act=async(task)=>{
  if(busy)return
  const action=tab==='pending'?'complete':'reopen',key=task.id+':'+task.version+':'+action
  if(!pending.current.has(key))pending.current.set(key,commandId())
  setBusy(task.id);setFailure('')
  const result=await changeTask(task,action,pending.current.get(key));setBusy(null)
  if(!result.ok){failedTask.current={id:task.id,version:task.version,status:action==='complete'?'completed':'pending'};setFailure(result.error)}
  else {pending.current.delete(key);failedTask.current=null}
 }
 return <section aria-label="現場交班待辦" className="rounded-xl border bg-white p-3 flex flex-col gap-2 max-h-[260px] overflow-hidden flex-none">
  <div className={`grid items-center gap-2 flex-none ${collapsed?'grid-cols-1':'grid-cols-[minmax(0,1fr)_120px_36px]'}`}>
   <button aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)} className="font-bold text-sm text-left min-h-[44px]">交班待辦 {tasks.filter(t=>t.date===date&&t.status==='pending').length} <span className="text-xs font-normal">{collapsed?'展開':'收合'}</span></button>
   {!collapsed&&<><input aria-label="交班日期" type="date" value={date} onChange={e=>setDate(e.target.value)} className="min-h-[44px] w-full text-xs"/><button onClick={refresh} className="min-h-[44px] underline text-xs">重整</button></>}
  </div>
  {!collapsed&&<>
   <div className="flex gap-2 flex-none">{[['pending','待辦'],['completed','已完成']].map(([value,label])=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)} className="min-h-[44px] px-3 border rounded-lg text-xs">{label} {tasks.filter(t=>t.date===date&&t.status===value).length}</button>)}</div>
   {(error||failure)&&<p role="alert" className="text-chicken-red text-xs flex-none">{failure||error}</p>}
   <div data-testid="handoff-task-list" className="overflow-y-auto min-h-0 space-y-1.5 overscroll-contain">
   {!loaded?<p>讀取交班資料中…</p>:!items.length?<p className="text-xs text-chicken-brown/60">{tab==='pending'?'這天沒有待辦事項':'這天尚無已完成事項'}</p>:items.map(task=>{
    const target=resolveTaskTarget(task,bookings,tables)
    const time=new Date(task.completedAt||task.createdAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})
    return <div key={task.id} className="rounded-lg border px-2 py-1.5 flex items-center justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><b className="text-sm leading-5 break-words">{task.label}</b><small className="flex-none text-[10px] text-chicken-brown/55" title={task.completedAt?'完成時間':'建立時間'}>{time}</small></div><button disabled={!target.numbers.length} onClick={()=>onLocate?.(target.numbers[0])} className="block underline text-xs min-h-[44px] text-left leading-4">{target.label}</button></div>{canWrite&&<button disabled={!!busy} onClick={()=>act(task)} className="min-h-[44px] px-2 border rounded-lg text-xs flex-none">{busy===task.id?'儲存中…':tab==='pending'?'完成':'恢復待辦'}</button>}</div>
   })}
   </div>
  </>}
 </section>
}
