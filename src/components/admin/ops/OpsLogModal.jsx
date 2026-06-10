import { Modal } from '../../ui'
import { listAll } from '../../../services/opsLogService'

// 系統自動處理紀錄：自動清檯（超時釋桌/換日掃除）做了什麼，一筆一行可回查。
// 本機留存（cap 200），回答「這桌怎麼自己空了」。
const KIND_LABEL = {
  'auto-release': { label: '超時釋桌', cls: 'bg-amber-100 text-amber-800' },
  'day-rollover': { label: '換日掃除', cls: 'bg-sky-100 text-sky-800' },
}

function fmtAt(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function OpsLogModal({ open, onClose }) {
  if (!open) return null
  const logs = listAll()
  return (
    <Modal open={open} onClose={onClose} title="🤖 系統自動處理紀錄">
      {logs.length === 0 ? (
        <div className="text-center py-8 text-sm text-chicken-brown/45">目前沒有自動處理紀錄</div>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {logs.map(e => {
            const k = KIND_LABEL[e.kind] || { label: e.kind, cls: 'bg-chicken-brown/10 text-chicken-brown' }
            return (
              <div key={e.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-chicken-cream/50 text-xs">
                <span className="text-chicken-brown/45 tabular-nums flex-shrink-0">{fmtAt(e.at)}</span>
                <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${k.cls}`}>{k.label}</span>
                <span className="text-chicken-brown">{e.message || `${e.type || ''} ${e.tableNumber || ''}`}</span>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
