import { useState, useMemo } from 'react'
import { Modal, Input } from '../../ui'
import { useToast, useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import GuestCountField from '../GuestCountField'
import HonorificNameField, { composeName, DEFAULT_TITLE } from './HonorificNameField'
import WaitlistHistorySheet from './WaitlistHistorySheet'

function diffMin(d) {
  if (!d) return 0
  const t = new Date(d).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 60000))
}

// 現場右側欄「候位」籤：取號 → 叫號 → 入座全程在現場頁完成。
// 歷史與統計屬低頻查閱，收在 WaitlistHistorySheet（Modal）不佔常駐欄位。
export default function WaitlistPanel({ onSeatWaitlist }) {
  const { waitlist, addWaitlist, callWaitlist, leaveWaitlist } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  const [showAdd, setShowAdd] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', partySize: 2, notes: '' })
  // 稱謂＋姓氏快選（與現場帶位共用同一套元件）：滿場尖峰時取號不必切注音。
  // 存進 waitlist 的仍是同一個 name 字串，資料結構不變。
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [surname, setSurname] = useState(null)
  const [customName, setCustomName] = useState('')

  const active = waitlist.filter(w => w.status === 'waiting' || w.status === 'called')

  // 「前面還有 N 組」：依取號先後排名（越早取號越前面）
  const aheadOf = useMemo(() => {
    const m = {}
    waitlist
      .filter(w => w.status === 'waiting' || w.status === 'called')
      .sort((a, b) => (a.takenAt || '').localeCompare(b.takenAt || ''))
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
    setTitle(DEFAULT_TITLE); setSurname(null); setCustomName('')
  }

  const handleAdd = () => {
    const size = Number(form.partySize)
    if (!size || size < 1 || size > 12) return toast.warning('人數需介於 1～12 位')
    // 快選組出來的稱呼優先；沒選就沿用手打的 name（兩者都空＝匿名取號，靠號碼叫人）
    const name = composeName(title, surname, customName.trim()) || form.name.trim()
    const w = addWaitlist({ ...form, name, partySize: size, estimatedMin: estimatedWaitMin })
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
        <button onClick={() => setShowAdd(true)} className="text-xs px-2.5 py-1.5 min-h-[32px] bg-chicken-red text-white rounded-md font-bold">
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
                  <span className="text-sm font-black text-chicken-red flex-shrink-0">#{w.queueNumber}</span>
                  <span className="text-sm font-bold truncate">{w.name}</span>
                  <span className="text-[10px] text-chicken-brown/60">{w.partySize} 位</span>
                  <span className="text-[10px] text-chicken-brown/45">建議{w.partySize > 4 ? '六人桌' : '四人桌'}</span>
                </div>
                {w.status === 'called' && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-bold">已叫號</span>}
              </div>
              <div className="text-[10px] text-chicken-brown/50 mt-0.5">
                已等 {diffMin(w.takenAt)} 分
                {aheadOf[w.id] > 0
                  ? <span className="font-bold text-chicken-brown"> · 前面還有 {aheadOf[w.id]} 組</span>
                  : <span className="font-bold text-chicken-green"> · 🔔 輪到了</span>}
                {w.notes && <span className="italic"> · 「{w.notes}」</span>}
              </div>
              <div className="flex gap-1 mt-2">
                <button
                  onClick={() => onSeatWaitlist?.(w)}
                  className="flex-1 min-h-[44px] text-[11px] py-1 bg-chicken-green text-white rounded-md font-bold"
                >
                  入座
                </button>
                {w.status === 'waiting' && (
                  <button
                    onClick={() => callWaitlist(w.id)}
                    className="flex-1 min-h-[44px] text-[11px] py-1 bg-chicken-yellow text-white rounded-md font-bold"
                  >
                    叫號
                  </button>
                )}
                <button
                  onClick={async () => { if (await confirm(`確定讓 ${w.name || `#${w.queueNumber}`} 棄號？此動作會將其移出候位。`, { title: '棄號', danger: true, confirmLabel: '棄號' })) leaveWaitlist(w.id) }}
                  className="min-h-[44px] text-[11px] px-3 py-1 bg-white border border-chicken-red/40 text-chicken-red rounded-md font-bold hover:bg-chicken-red/5"
                  aria-label="棄號"
                  title="棄號"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 取號 Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); resetForm() }} title="🚦 候位取號" footer={
        <>
          <button onClick={() => { setShowAdd(false); resetForm() }} className="btn-secondary px-4 py-2">取消</button>
          <button onClick={handleAdd} className="btn-primary px-4 py-2">取號</button>
        </>
      }>
        {/* 人數擺第一個：它是唯一必填，滿場尖峰「點人數 → 取號」兩下就走完 */}
        <div className="space-y-3">
          <GuestCountField
            value={form.partySize}
            onChange={n => setForm(f => ({ ...f, partySize: n }))}
            max={12}
            label="幾位？（1～12 位）"
          />
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
