import { roleCan } from './staffAccess.js'
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e }
export const businessDate = iso => Number.isNaN(new Date(iso).getTime())?'':new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))
export function checkCommand(command) {
  if (!command || !/^[a-zA-Z0-9_-]{1,100}$/.test(command.id || '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(command.commandId || '')) fail('invalid-command')
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 0) fail('invalid-version')
}
export function buildHandoffCommand(command, previous, { role, actor, now, bookingExists = true, tableExists = true }) {
  if (!roleCan(role, 'table.update')) fail('permission-denied', 403)
  checkCommand(command)
  if (command.action === 'create') {
    if (previous) fail('task-already-exists',409)
    if(command.expectedVersion!==0) fail('invalid-version')
    const { label, bookingId = null, tableNumber = null } = command
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) fail('invalid-label')
    if (!bookingId && !tableNumber) fail('missing-reference')
    if ((bookingId && (typeof bookingId !== 'string' || !bookingExists)) || (tableNumber && (typeof tableNumber !== 'string' || !tableExists))) fail('reference-not-found',404)
    return { id:command.id, date:businessDate(now), label:label.trim(), bookingId, tableNumber, status:'pending', version:1, createdBy:actor, createdAt:now, updatedAt:now, completedBy:null, completedAt:null }
  }
  if (!previous) fail('task-not-found',404)
  if (previous.version !== command.expectedVersion) fail('task-changed',409)
  if (!['complete','reopen'].includes(command.action)) fail('invalid-action')
  const status = command.action === 'complete' ? 'completed' : 'pending'
  if (previous.status === status) fail('task-changed',409)
  return { ...previous, status, version:previous.version+1, updatedAt:now, completedBy:status==='completed'?actor:null, completedAt:status==='completed'?now:null }
}
export function buildQueueCommand(command, previous, { role, now }) {
  if (!roleCan(role,'waitlist.update')) fail('permission-denied',403)
  checkCommand(command)
  if (!previous) fail('waitlist-not-found',404)
  if ((previous.queueVersion || 0) !== command.expectedVersion) fail('waitlist-changed',409)
  if (!previous.takenAt || businessDate(previous.takenAt) !== businessDate(now)) fail('waitlist-not-today',409)
  if (command.action==='skip' && ['waiting','called'].includes(previous.status)) return {...previous,status:'skipped',skippedAt:now,queueVersion:(previous.queueVersion||0)+1}
  if (command.action==='return' && previous.status==='skipped') return {...previous,status:'waiting',returnedAt:now,calledAt:null,queueVersion:(previous.queueVersion||0)+1}
  fail('waitlist-changed',409)
}
// 專用過號啟用後，舊裝置的全量快照不能覆蓋或復活候位；generic push也走逐筆transaction。
export function protectQueueUpsert(item, previous) {
  if (!['waiting','called','seated','left','skipped'].includes(item.status)) fail('invalid-waitlist-status')
  if (previous && ['seated','left'].includes(previous.status) && item.status!==previous.status) fail('waitlist-ended',409)
  if ((item.queueVersion||0)!==(previous?.queueVersion||0)) fail('waitlist-changed',409)
  if (item.status==='skipped' && previous?.status!=='skipped') fail('use-queue-command',409)
  if (previous?.status==='skipped' && !['skipped','left'].includes(item.status)) fail('use-queue-command',409)
  return {...item, ...(previous?{id:previous.id,takenAt:previous.takenAt,queueNumber:previous.queueNumber}:{}),
    queueVersion:(previous?.queueVersion||0)+1,skippedAt:previous?.skippedAt||null,returnedAt:previous?.returnedAt||null}
}
