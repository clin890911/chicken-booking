import { compareWaitlistOrder } from '../../../utils/waitlistOrder'
import { useAuth } from '../../../contexts/AuthContext'
import { seatingPerms } from '../../../utils/seatingPerms'
import { waitlistDay } from '../../../services/waitlistService'
import { todayStr } from '../../../utils/timeSlots'
import { commandId } from '../../../services/handoffService'
import { useState, useMemo, useRef, useEffect } from 'react'
import { Modal, Input } from '../../ui'
import { useToast, useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import PartySizeField from '../PartySizeField'
import PhoneLink from './PhoneLink'
import { normalizeSplit, splitSuffix } from '../../../utils/partySplit'
import HonorificNameField, { composeName, DEFAULT_TITLE } from './HonorificNameField'
import WaitlistHistorySheet from './WaitlistHistorySheet'
import FloatingPhoneKeypad from './FloatingPhoneKeypad'
import { X } from 'lucide-react'
import { waitlistPhoneHint, waitlistSmsBadge, smsLooksActive } from '../../../utils/waitlistSms'

// 候位人數上限與散客後台相同（200，見 GuestCountField／PartySizeField）；線上訂位的 12 人上限不在這裡。
// 超過單桌常見容量（12）＝大組，入座時需併桌（seatingService 的候位入座已支援併桌）。
const WAITLIST_MAX = 200
const BIG_PARTY = 12

function diffMin(d) {
  if (!d) return 0
  const t = new Date(d).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 60000))
}

// 現場右側欄「候位」籤：取號 → 叫號 → 入座全程在現場頁完成。
// 歷史與統計屬低頻查閱，收在 WaitlistHistorySheet（Modal）不佔常駐欄位。
export default function WaitlistPanel({ onSeatWaitlist }) {
  const { waitlist, skipWaitlist, returnWaitlist, addWaitlist, callWaitlist, leaveWaitlist, pendingWaitlistCommands = [], waitlistCommandOwner = '', retryWaitlistCommands } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  const [showAdd, setShowAdd] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', partySize: 2, notes: '' })
  const [kids, setKids] = useState(0) // 小孩數（大人＝partySize−kids）；預設 0
  // 稱謂＋姓氏快選（與現場帶位共用同一套元件）：滿場尖峰時取號不必切注音。
  // 存進 waitlist 的仍是同一個 name 字串，資料結構不變。
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [surname, setSurname] = useState(null)
  const [customName, setCustomName] = useState('')
  // 電話用與帶位面板同款的漂浮數字鍵盤：iPad 系統鍵盤會整個蓋住 Modal 底部的「取號」鈕
  const [keypadOpen, setKeypadOpen] = useState(false)
  const phoneRef = useRef(null)
  const formRef = useRef(null)

  const {can}=useAuth()
  const canEdit=can('waitlist.update')
  const canCreate=can('waitlist.create')
  // 候位「入座」會連動建 walk-in 訂位並佔桌（寫 waitlist＋bookings＋tables），不只 waitlist.update；
  // 叫號／棄號／暫過只寫 waitlist，維持 canEdit。見 utils/seatingPerms.js。
  const canSeat=seatingPerms(can).waitlistSeat
  const [busy,setBusy]=useState(null)
  const pending=useRef(new Map())
  const changeQueue=async(w,action)=>{
    if(busy)return
    const key=w.id+':'+(w.queueVersion||0)+':'+action
    if(!pending.current.has(key))pending.current.set(key,commandId())
    setBusy(w.id)
    const handler={skip:skipWaitlist,return:returnWaitlist,call:callWaitlist,leave:leaveWaitlist}[action]
    const result=await handler(w.id,pending.current.get(key))
    setBusy(null)
    if(!result.ok)return toast.error(result.error)
    pending.current.delete(key)
    toast.success({skip:`#${w.queueNumber} 暫過號，號碼保留`,return:`#${w.queueNumber} 已回來，依原順位恢復候位`,call:`#${w.queueNumber} 已叫號`,leave:`#${w.queueNumber} 已棄號`}[action])
  }
  const skipped=waitlist.filter(w=>w.status==='skipped'&&waitlistDay(w)===todayStr()).sort(compareWaitlistOrder)
  const active = waitlist.filter(w => ['waiting','called'].includes(w.status)&&waitlistDay(w)===todayStr()).sort(compareWaitlistOrder)
  const smsActive = smsLooksActive(waitlist.filter(w => waitlistDay(w) === todayStr()))
  const phoneHint = waitlistPhoneHint(form.phone)

  // 「前面還有 N 組」：依取號先後排名（越早取號越前面）
  const aheadOf = useMemo(() => {
    const m = {}
    waitlist
      .filter(w => w.status === 'waiting' || w.status === 'called')
      .sort(compareWaitlistOrder)
      .forEach((w, idx) => { m[w.id] = idx })
    return m
  }, [waitlist])

  // C2：取號預估 —— 活躍候位組數 × 每組平均佔用估時，給門口透明、合理的等待估計
  const AVG_MIN_PER_GROUP = 12
  const estPartyExtra = (size) => (Number(size) > 4 ? 8 : 0)   // 大桌較難排，略加估時
  const estimatedWaitMin = useMemo(() => {
    const base = active.length * AVG_MIN_PER_GROUP + estPartyExtra(form.partySize)
    return Math.max(5, base)
  }, [active.length, form.partySize])

  const resetForm = () => {
    setForm({ name: '', phone: '', partySize: 2, notes: '' })
    setKids(0)
    setTitle(DEFAULT_TITLE); setSurname(null); setCustomName('')
    setKeypadOpen(false)
  }

  const restoredDraft = useRef(null)
  useEffect(() => { resetForm(); restoredDraft.current = null }, [waitlistCommandOwner])
  useEffect(() => {
    const draft = pendingWaitlistCommands.find(entry => entry.command.action === 'create')
    if (draft && restoredDraft.current !== draft.command.commandId) {
      restoredDraft.current = draft.command.commandId
      setForm(draft.command.payload); setKids(draft.command.payload.children || 0)
      setSurname(null); setCustomName(draft.command.payload.name || '')
    }
  }, [pendingWaitlistCommands])

  const handleAdd = async () => {
    if (busy) return
    const size = Number(form.partySize)
    if (!size || size < 1 || size > WAITLIST_MAX) return toast.warning(`人數需介於 1～${WAITLIST_MAX} 位`)
    // 快選組出來的稱呼優先；沒選就沿用手打的 name（兩者都空＝匿名取號，靠號碼叫人）
    const name = composeName(title, surname, customName.trim()) || form.name.trim()
    setBusy('add')
    const result = await addWaitlist({ ...form, name, partySize: size, children: normalizeSplit(size, kids).children, estimatedMin: estimatedWaitMin })
    setBusy(null)
    const w = result?.item || (result?.queueNumber ? result : null)
    if (!w || result?.ok === false) return toast.error(result?.error || '取號未確認，請保留表單後重試')
    setShowAdd(false)
    resetForm()
    if (w?.queueNumber) toast.success(`已取號 #${w.queueNumber}，預估等待 ${w.estimatedMin} 分`)
  }

  return (
    <div>
      {!!pendingWaitlistCommands.length && <div role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
        <p className="font-bold">有 {pendingWaitlistCommands.length} 筆候位操作待確認</p>
        {pendingWaitlistCommands.map(entry => <p key={entry.command.commandId}>{({create:'取號',call:'叫號',seat:'入座',leave:'棄號',skip:'暫過號',return:'回來了',undo:'復原入座'})[entry.command.action]} · {entry.command.payload?.name || waitlist.find(w=>w.id===entry.command.id)?.name || '原候位'}{entry.command.payload?.tableNumbers?.length ? ` · 桌 ${entry.command.payload.tableNumbers.join(' + ')}` : ''}</p>)}
        <p>尚未顯示成功。確認會重送原操作，請勿另建同一組。</p>
        <button disabled={!!busy} className="min-h-[44px] underline font-bold" onClick={async()=>{setBusy('retry');try{await retryWaitlistCommands?.()}finally{setBusy(null)}}}>確認／重試原操作</button>
      </div>}
      <div className="flex items-center justify-end gap-1.5 mb-2">
        <button
          onClick={() => setShowHistory(true)}
          className="text-xs px-2.5 py-1.5 min-h-[32px] bg-white border border-chicken-brown/15 text-chicken-brown rounded-md font-bold"
        >歷史</button>
        <button disabled={!canCreate || !!busy} onClick={() => setShowAdd(true)} className="text-xs px-2.5 py-1.5 min-h-[32px] bg-chicken-red text-white rounded-md font-bold">
          + 新增取號
        </button>
      </div>

      {active.length === 0 ? (
        <div className="text-center py-6 text-xs text-chicken-brown/40">目前無人候位</div>
      ) : (
        <div className="space-y-2">
          {active.map(w => (
            <div
              key={w.id}
              className={`p-2.5 rounded-xl border-2 transition-all
                         ${w.status === 'called'
                           ? 'border-chicken-yellow bg-chicken-yellow/10'
                           : 'border-chicken-brown/10 bg-white'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                  <span className="text-sm font-bold text-chicken-red flex-shrink-0">#{w.queueNumber}</span>
                  <span className="text-sm font-bold truncate">{w.name}</span>
                  <span className="text-[10px] text-chicken-brown/60 flex-shrink-0">{w.partySize} 位{splitSuffix(w)}</span>
                  <span className="text-[10px] text-chicken-brown/45">{w.partySize > BIG_PARTY ? '大組需併桌' : `建議${w.partySize > 4 ? '六人桌' : '四人桌'}`}</span>
                </div>
                <PhoneLink phone={w.phone} className="text-sm" />
                {w.status === 'called' && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-bold">已叫號</span>}
              </div>
              <SmsBadge w={w} smsActive={smsActive} />
              <div className="text-[10px] text-chicken-brown/50 mt-0.5">
                已等 {diffMin(w.takenAt)} 分
                {aheadOf[w.id] > 0
                  ? <span className="font-bold text-chicken-brown"> · 前面還有 {aheadOf[w.id]} 組</span>
                  : <span className="font-bold text-chicken-green"> · 輪到了</span>}
                {w.notes && <span className="italic"> · 「{w.notes}」</span>}
              </div>
              {canEdit&&<div className="flex gap-1 mt-2">
                {canSeat && <button
                  disabled={!!busy} onClick={() => onSeatWaitlist?.(w)}
                  className="flex-1 min-h-[44px] text-[11px] py-1 bg-chicken-green text-white rounded-md font-bold"
                >
                  入座
                </button>}
                {w.status === 'waiting' && (
                  <button
                    disabled={!!busy} onClick={() => changeQueue(w,'call')}
                    className="flex-1 min-h-[44px] text-[11px] py-1 bg-chicken-yellow text-white rounded-md font-bold"
                  >
                    叫號
                  </button>
                )}
                <button disabled={!!busy} onClick={()=>changeQueue(w,'skip')} className="min-h-[44px] text-xs px-2 border rounded-md">{busy===w.id?'儲存中…':'暫過號'}</button>
                <button
                  disabled={!!busy} onClick={async () => { if (await confirm(`確定讓 ${w.name || `#${w.queueNumber}`} 棄號？此動作會將其移出候位。`, { title: '棄號', danger: true, confirmLabel: '棄號' })) await changeQueue(w,'leave') }}
                  className="min-h-[44px] text-[11px] px-3 py-1 bg-white border border-chicken-red/40 text-chicken-red rounded-md font-bold hover:bg-chicken-red/5"
                  aria-label="棄號"
                  title="棄號"
                >
                  <X size={16} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>}
            </div>
          ))}
        </div>
      )}

      {!!skipped.length&&<section aria-label="暫過號候位" className="mt-3 space-y-2"><h3 className="font-bold text-sm">暫過號 · 保留原號</h3>{skipped.map(w=><div key={w.id} className="p-2 border rounded-lg text-sm"><div className="flex items-baseline gap-2 flex-wrap"><b>#{w.queueNumber} {w.name}</b><span>{w.partySize} 位{splitSuffix(w)}</span><PhoneLink phone={w.phone} className="text-sm" /></div>{canEdit&&<div className="flex gap-2"><button disabled={!!busy} onClick={()=>changeQueue(w,'return')} className="min-h-[44px] px-3 border rounded-lg">{busy===w.id?'儲存中…':'回來了'}</button><button disabled={!!busy} onClick={async()=>{if(await confirm(`確定讓 #${w.queueNumber} 棄號？`,{title:'棄號',danger:true}))await changeQueue(w,'leave')}} className="min-h-[44px] px-3 border rounded-lg">棄號</button></div>}</div>)}</section>}
      {/* 取號 Modal */}
      <Modal open={showAdd} onClose={() => { if(!busy) setShowAdd(false) }} title="候位取號" footer={
        <>
          <button disabled={!!busy} onClick={() => setShowAdd(false)} className="btn-secondary px-4 py-2">取消</button>
          <button disabled={!!busy} onClick={handleAdd} className="btn-primary px-4 py-2">{busy==='add'?'確認取號中…':pendingWaitlistCommands.some(e=>e.command.action==='create')?'確認原取號':'取號'}</button>
        </>
      }>
        {/* 人數擺第一個：它是唯一必填，滿場尖峰「點人數 → 取號」兩下就走完 */}
        <div ref={formRef} className="space-y-3">
          <PartySizeField
            total={form.partySize}
            kids={kids}
            onChange={(t, c) => { setKids(c); setForm(f => ({ ...f, partySize: t })) }}
            max={WAITLIST_MAX}
          />
          {Number(form.partySize) > BIG_PARTY && (
            <p role="status" className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              大組，入座時需併桌
            </p>
          )}
          <div className="rounded-xl border border-chicken-brown/10 bg-chicken-cream/60 px-3 py-2 text-sm text-chicken-brown/70">
            預估約 <span className="font-bold text-amber-700">{estimatedWaitMin} 分</span>
            <span className="text-xs text-chicken-brown/50">（目前 {active.length} 組候位中）</span>
          </div>
          <HonorificNameField
            title={title}
            surname={surname}
            onChange={({ title: t, surname: s }) => { setTitle(t); setSurname(s) }}
            custom={customName}
            onCustomChange={setCustomName}
          />
          {/* inputMode="none"：不叫出系統鍵盤，點欄位改浮出數字鍵盤（不蓋住「取號」） */}
          <div>
            <label className="label">手機（叫號簡訊用，選填）</label>
            <input
              ref={phoneRef}
              type="tel"
              inputMode="none"
              aria-label="手機（叫號簡訊用，選填）"
              aria-describedby={phoneHint ? 'waitlist-phone-hint' : undefined}
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
              onClick={() => setKeypadOpen(true)}
              onFocus={() => setKeypadOpen(true)}
              placeholder="0912345678"
              className={`input tabular-nums ${keypadOpen ? 'ring-4 ring-chicken-red/20 border-chicken-red' : ''}`}
            />
            {phoneHint && <p id="waitlist-phone-hint" role="status" className="mt-1 text-xs text-amber-700">{phoneHint}</p>}
          </div>
          <FloatingPhoneKeypad
            open={showAdd && keypadOpen}
            onClose={() => setKeypadOpen(false)}
            value={form.phone}
            onChange={v => setForm(f => ({ ...f, phone: v }))}
            anchorRef={phoneRef}
            boundsRef={formRef}
          />
          <Input label="備註（選填）" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="例：靠窗、過敏" />
        </div>
      </Modal>

      <WaitlistHistorySheet open={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  )
}

// 已叫號卡片的簡訊狀態：失敗／不明一律提示改打電話（簡訊是補充，不取代喊號）。
const SMS_TONE = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  bad: 'bg-red-50 text-red-700 border-red-200 font-bold',
  neutral: 'bg-chicken-brown/5 text-chicken-brown/60 border-chicken-brown/10',
}
function SmsBadge({ w, smsActive }) {
  const badge = waitlistSmsBadge(w, { smsActive })
  if (!badge) return null
  return (
    <div className="mt-1">
      <span data-sms-badge={badge.tone} className={`inline-block text-[11px] px-1.5 py-0.5 rounded-md border ${SMS_TONE[badge.tone]}`}>{badge.label}</span>
    </div>
  )
}
