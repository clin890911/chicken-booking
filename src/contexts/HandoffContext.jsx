import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { useConfirm } from '../components/ui/Toast'
import { Modal, Input } from '../components/ui'
import { commandId, mergeTasks, pullTasks, sendTaskCommand, operationError } from '../services/handoffService'
const HandoffContext=createContext(null)
const LABELS=['需回電','等兒童椅','需協助','其他']
export const useHandoff=()=>useContext(HandoffContext)||{tasks:[],loaded:false,canWrite:false,openTask:()=>{}}
export function HandoffProvider({children}){
 const {user,can}=useAuth()||{}
 const confirm=useConfirm()
 const canWrite=!!user&&!!can?.('table.update')
 const [tasks,setTasks]=useState([]),[loaded,setLoaded]=useState(false),[error,setError]=useState('')
 const [target,setTarget]=useState(null),[label,setLabel]=useState(LABELS[0]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[draftError,setDraftError]=useState('')
 const pending=useRef(null),alive=useRef(true)
 const refresh=useCallback(async()=>{
  if(!user)return false
  try{const items=await pullTasks();if(alive.current){setTasks(t=>mergeTasks(t,items));setLoaded(true);setError('')}return true}
  catch(e){if(alive.current)setError(operationError(e));return false}
 },[user?.email])
 useEffect(()=>{
  alive.current=true;setTasks([]);setLoaded(false)
  if(!user)return
  refresh();const timer=setInterval(refresh,5000)
  return()=>{alive.current=false;clearInterval(timer)}
 },[refresh])
 const openTask=async refs=>{if(!canWrite||busy)return;
  if(target&&(text.trim()||label!==LABELS[0])&&!(await confirm('有未儲存的交班事項，確定改為新增另一筆？',{title:'保留交班草稿',confirmLabel:'放棄草稿'})))return;
 setTarget(refs);setLabel(LABELS[0]);setText('');setDraftError('');pending.current=null}
 const closeComposer=async()=>{
  if(busy)return
  if((text.trim()||label!==LABELS[0])&&!(await confirm('取消後不會儲存這份交班草稿，確定取消？',{title:'取消交班事項',confirmLabel:'放棄草稿'})))return
  setTarget(null);pending.current=null
 }
 const submit=async()=>{
  if(!canWrite||busy)return
  if(!loaded){setDraftError('尚未取得交班資料，請先重整再儲存');return}
  const value=label==='其他'?text.trim():label
  if(!value||value.length>80){setDraftError('請填寫1～80字的交班事項');return}
  const body={action:'create',label:value,...target}
  const key=JSON.stringify(body)
  if(pending.current?.key!==key)pending.current={key,command:{...body,id:commandId(),commandId:commandId(),expectedVersion:0}}
  setBusy(true);setDraftError('')
  try{const item=await sendTaskCommand(pending.current.command);setTasks(t=>mergeTasks(t,[item]));setTarget(null);pending.current=null}
  catch(e){setDraftError(operationError(e))}finally{setBusy(false)}
 }
 useEffect(()=>{
  const saved=pending.current?.command
  if(!target||!saved)return
  const draft=JSON.stringify({action:'create',label:label==='其他'?text.trim():label,...target})
  const item=tasks.find(t=>t.id===saved.id)
  if(item&&item.version>=1&&pending.current.key===draft&&item.label===saved.label&&item.bookingId===(saved.bookingId||null)&&item.tableNumber===(saved.tableNumber||null)){
   setTarget(null);setDraftError('');pending.current=null
  }
 },[tasks,target,label,text])
 const changeTask=async(task,action,operation)=>{
  if(!canWrite||!loaded)return {ok:false,error:'尚未取得資料或沒有編輯權限'}
  try{const item=await sendTaskCommand({id:task.id,action,commandId:operation,expectedVersion:task.version});setTasks(t=>mergeTasks(t,[item]));return {ok:true}}
  catch(e){if(e.status===409)await refresh();return {ok:false,error:operationError(e)}}
 }
 return <HandoffContext.Provider value={{tasks,loaded,error,canWrite,openTask,refresh,changeTask}}>{children}
  <Modal open={!!target} onClose={closeComposer} title="新增交班事項" footer={<><button disabled={busy} onClick={closeComposer} className="btn-secondary">取消</button><button disabled={busy||!loaded} onClick={submit} className="btn-primary">{busy?'儲存中…':'儲存交班事項'}</button></>}>
   <p className="text-sm mb-3">{target?.bookingId?'跟隨這筆客人的桌位；改桌後一起更新':'只跟隨這張桌；客人換桌時不搬移'}</p>
   <div className="flex gap-2 flex-wrap">{LABELS.map(v=><button key={v} aria-pressed={label===v} onClick={()=>setLabel(v)} className={`min-h-[44px] px-3 rounded-lg border ${label===v?'bg-chicken-brown text-white':''}`}>{v}</button>)}</div>
   {label==='其他'&&<Input label="交班事項（80字內）" maxLength={80} value={text} onChange={e=>setText(e.target.value)}/>}
   {(draftError||(!loaded&&error))&&<p role="alert" className="text-chicken-red mt-3">{draftError||error}</p>}
   {!loaded&&<button onClick={refresh} className="min-h-[44px] underline">重整交班資料</button>}
  </Modal>
 </HandoffContext.Provider>
}
