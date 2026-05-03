import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import * as bookingService from '../services/bookingService'
import { dayLabel } from '../utils/timeSlots'
import { Card, Button, Badge } from '../components/ui'

export default function ConfirmPage() {
  const { id } = useParams()
  const [b, setB] = useState(null)

  useEffect(() => {
    setB(bookingService.getById(id))
  }, [id])

  if (!b) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="text-center max-w-sm">
          <div className="text-5xl mb-2">🤔</div>
          <p className="font-bold text-chicken-brown">找不到此訂位</p>
          <Link to="/book" className="text-chicken-red text-sm mt-3 inline-block underline">重新訂位</Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-cream to-white p-4 flex flex-col">
      <main className="max-w-md w-full mx-auto pt-8 flex-1">
        <div className="text-center mb-6">
          <div className="inline-flex w-20 h-20 bg-chicken-green/15 rounded-full items-center justify-center text-5xl mb-3">
            ✅
          </div>
          <h1 className="text-2xl font-black text-chicken-brown">訂位成功</h1>
          <p className="text-sm text-chicken-brown/60 mt-1">期待您的光臨 🐔</p>
        </div>

        <Card className="space-y-4">
          <Row label="訂位編號" value={<span className="font-mono font-bold text-chicken-red">{b.id}</span>} />
          <Row label="姓名" value={b.name} />
          <Row label="電話" value={b.phone} />
          <Row label="日期" value={dayLabel(b.date)} />
          <Row label="時段" value={<span className="text-lg font-black text-chicken-red">{b.timeSlot}</span>} />
          <Row label="人數" value={`${b.guests} 位`} />
          {(b.notes?.pet || b.notes?.child || b.notes?.mobility) && (
            <Row label="特殊需求" value={
              <div className="flex gap-1 flex-wrap justify-end">
                {b.notes.pet && <Badge color="yellow">🐾 寵物</Badge>}
                {b.notes.child && <Badge color="green">👶 兒童</Badge>}
                {b.notes.mobility && <Badge color="brown">♿ 行動不便</Badge>}
              </div>
            } />
          )}
          {b.notes?.text && <Row label="備註" value={<span className="text-sm">{b.notes.text}</span>} />}
        </Card>

        <div className="mt-6 p-4 bg-chicken-yellow/10 border border-chicken-yellow/30 rounded-2xl">
          <p className="text-sm text-chicken-brown leading-relaxed">
            ⚠️ <strong>溫馨提醒</strong><br />
            · 請於用餐時段前 5 分鐘抵達<br />
            · 逾時 15 分鐘訂位將自動取消<br />
            · 如需取消請來電通知，避免影響其他客人
          </p>
        </div>

        <div className="mt-6 space-y-2">
          <Link to="/book" className="block">
            <Button variant="secondary" className="w-full">再訂一筆</Button>
          </Link>
          <Link to="/" className="block text-center text-xs text-chicken-brown/50 underline">回首頁</Link>
        </div>
      </main>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-chicken-brown/5 last:border-0">
      <span className="text-sm text-chicken-brown/60">{label}</span>
      <span className="text-chicken-brown font-bold text-right">{value}</span>
    </div>
  )
}
