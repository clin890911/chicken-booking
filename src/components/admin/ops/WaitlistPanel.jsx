import { compareWaitlistOrder } from '../../../utils/waitlistOrder'
import { useAuth } from '../../../contexts/AuthContext'
import { seatingPerms } from '../../../utils/seatingPerms'
import { waitlistDay } from '../../../services/waitlistService'
import { todayStr } from '../../../utils/timeSlots'
import { commandId } from '../../../services/handoffService'
import { useState, useMemo, useRef } from 'react'
import { Modal, Input } from '../../ui'
import { useToast, useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import PartySizeField from '../PartySizeField'
import PhoneLink from './PhoneLink'
import { normalizeSplit, splitSuffix } from '../../../utils/partySplit'
import HonorificNameField, { composeName, DEFAULT_TITLE } from './HonorificNameField'
import WaitlistHistorySheet from './WaitlistHistorySheet'
import GlyphText from '../../ui/GlyphText'

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
  const { waitlist, skipWaitlist, returnWaitlist, addWaitlist, callWaitlist, leaveWaitlist } = useBooking()
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

  const {can}=useAuth()
  const canEdit=can('waitlist.update')
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
    const result=await (action==='skip'?skipWaitlist:returnWaitlist)(w.id,pending.current.get(key))
    setBusy(null)
    if(!result.ok)return toast.error(result.error)
    pending.current.delete(key)
    toast.success(action==='skip'?`#${w.queueNumber} 暫過號，號碼保留`:`#${w.queueNumber} 已回來，依原順位恢復候位`)
  }
  const skipped=waitlist.filter(w=>w.status==='skipped'&&waitlistDay(w)===todayStr()).sort(compareWaitlistOrder)
  const active = waitlist.filter(w => ['waiting','called'].includes(w.status)&&waitlistDay(w)===todayStr()).sort(compareWaitlistOrder)

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
  }

  const handleAdd = () => {
    const size = Number(form.partySize)
    if (!size || size < 1 || size > WAITLIST_MAX) return toast.warning(`人數需介於 1～${WAITLIST_MAX} 位`)
    // 快選組出來的稱呼優先；沒選就沿用手打的 name（兩者都空＝匿名取號，靠號碼叫人）
    const name = composeName(title, surname, customName.trim()) || form.name.trim()
    const w = addWaitlist({ ...form, name, partySize: size, children: normalizeSplit(size, kids).children, estimatedMin: estimatedWaitMin })
    setShowAdd(false)
    resetForm()
    if (w?.queueNumber) toast.success(`已取號 #${w.queueNumber}，預估等待 ${w.estimatedMin} 分`)
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-1.5 mb-2">
        <button
          onClick={() => setShowHistory(true)}
          className="text-xs px-2.5 py-1.5 min-h-[32px] bg-white border border-chicken-brown/15 text-chicken-brown rounded-md font-bold"
        >歷史</button>
        <button disabled={!canEdit} onClick={() => setShowAdd(true)} className="text-xs px-2.5 py-1.5 min-h-[32px] bg-chicken-red text-white rounded-md font-bold">
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
                    disabled={!!busy} onClick={() => callWaitlist(w.id)}
                    className="flex-1 min-h-[44px] text-[11px] py-1 bg-chicken-yellow text-white rounded-md font-bold"
                  >
                    叫號
                  </button>
                )}
                <button disabled={!!busy} onClick={()=>changeQueue(w,'skip')} className="min-h-[44px] text-xs px-2 border rounded-md">{busy===w.id?'儲存中…':'暫過號'}</button>
                <button
                  disabled={!!busy} onClick={async () => { if (await confirm(`確定讓 ${w.name || `#${w.queueNumber}`} 棄號？此動作會將其移出候位。`, { title: '棄號', danger: true, confirmLabel: '棄號' })) leaveWaitlist(w.id) }}
                  className="min-h-[44px] text-[11px] px-3 py-1 bg-white border border-chicken-red/40 text-chicken-red rounded-md font-bold hover:bg-chicken-red/5"
                  aria-label="棄號"
                  title="棄號"
                >
                  <GlyphText>✕</GlyphText>
                </button>
              </div>}
            </div>
          ))}
        </div>
      )}

      {!!skipped.length&&<section aria-label="暫過號候位" className="mt-3 space-y-2"><h3 className="font-bold text-sm">暫過號 · 保留原號</h3>{skipped.map(w=><div key={w.id} className="p-2 border rounded-lg text-sm"><div className="flex items-baseline gap-2 flex-wrap"><b>#{w.queueNumber} {w.name}</b><span>{w.partySize} 位{splitSuffix(w)}</span><PhoneLink phone={w.phone} className="text-sm" /></div>{canEdit&&<div className="flex gap-2"><button disabled={!!busy} onClick={()=>changeQueue(w,'return')} className="min-h-[44px] px-3 border rounded-lg">{busy===w.id?'儲存中…':'回來了'}</button><button disabled={!!busy} onClick={async()=>{if(await confirm(`確定讓 #${w.queueNumber} 棄號？`,{title:'棄號',danger:true}))leaveWaitlist(w.id)}} className="min-h-[44px] px-3 border rounded-lg">棄號</button></div>}</div>)}</section>}
      {/* 取號 Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); resetForm() }} title="候位取號" footer={
        <>
          <button onClick={() => { setShowAdd(false); resetForm() }} className="btn-secondary px-4 py-2">取消</button>
          <button onClick={handleAdd} className="btn-primary px-4 py-2">取號</button>
        </>
      }>
        {/* 人數擺第一個：它是唯一必填，滿場尖峰「點人數 → 取號」兩下就走完 */}
        <div className="space-y-3">
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
          <Input label="電話（選填）" type="tel" inputMode="numeric" value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
            placeholder="0912345678" />
          <Input label="備註（選填）" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="例：靠窗、過敏" />
        </div>
      </Modal>

      <WaitlistHistorySheet open={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  )
}
