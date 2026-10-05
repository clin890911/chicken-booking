import { operationalRequest } from './cloudDataService'
export const commandId = () => crypto.randomUUID()
export function mergeTasks(current, incoming) {
  const byId=new Map(current.map(t=>[t.id,t]))
  for(const task of incoming) if(!byId.has(task.id) || (task.version||0)>=(byId.get(task.id).version||0)) byId.set(task.id,task)
  return [...byId.values()].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''))
}
export function resolveTaskTarget(task, bookings, tables) {
  if(task.bookingId){
    const booking=bookings.find(b=>b.id===task.bookingId)
    if(!booking)return {label:'訂位已不存在',numbers:[],ended:true}
    const numbers=[booking.assignedTableId,...(booking.extraTableIds||[])].filter(Boolean).map(String)
    return {label:`${booking.name||'客人'}${numbers.length?' · '+numbers.join(' + '):' · 未配桌'}${['completed','cancelled','noshow'].includes(booking.status)?' · 已結束':''}`,numbers,ended:['completed','cancelled','noshow'].includes(booking.status)}
  }
  const table=tables.find(t=>String(t.number)===String(task.tableNumber))
  return {label:table?`桌 ${table.number}`:`桌 ${task.tableNumber}（已不存在）`,numbers:table?[String(table.number)]:[],ended:!table}
}
export async function pullTasks(){return (await operationalRequest('adminHandoff')).items}
export async function sendTaskCommand(command){return (await operationalRequest('adminHandoff',command)).item}
export const operationError = error => error.status===409?'另一位同仁已更新，請重整待辦後再操作':error.status===403?'此帳號沒有編輯權限':'未儲存成功，請檢查連線後重試'
