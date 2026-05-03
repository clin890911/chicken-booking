import { useState } from 'react'
import { Input, Select, Textarea, Button } from '../ui'

const NOTE_OPTIONS = [
  { key: 'pet', label: '🐾 攜帶寵物' },
  { key: 'child', label: '👶 有兒童' },
  { key: 'mobility', label: '♿ 行動不便' }
]

export default function BookingForm({
  initial = {},
  showSource = false,
  maxGuests = 20,
  onSubmit,
  submitLabel = '送出訂位',
  busy = false
}) {
  const [form, setForm] = useState({
    name: initial.name || '',
    phone: initial.phone || '',
    guests: initial.guests || 2,
    notes: {
      pet: false,
      child: false,
      mobility: false,
      text: '',
      ...(initial.notes || {})
    },
    source: initial.source || 'phone'
  })
  const [error, setError] = useState({})

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleNote = (k) => setForm(f => ({ ...f, notes: { ...f.notes, [k]: !f.notes[k] } }))

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.name.trim()) errs.name = '請填姓名'
    if (!form.phone.trim()) errs.phone = '請填電話'
    else if (!/^[\d\-+\s]{7,}$/.test(form.phone.trim())) errs.phone = '電話格式不正確'
    if (!form.guests || form.guests < 1) errs.guests = '人數至少 1 位'
    setError(errs)
    if (Object.keys(errs).length === 0) onSubmit?.(form)
  }

  const guestOptions = Array.from({ length: maxGuests }, (_, i) => ({ value: i + 1, label: `${i + 1} 位` }))

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="姓名"
        value={form.name}
        onChange={e => set('name', e.target.value)}
        placeholder="王小姐"
        error={error.name}
      />
      <Input
        label="電話"
        type="tel"
        inputMode="numeric"
        value={form.phone}
        onChange={e => set('phone', e.target.value)}
        placeholder="0912345678"
        error={error.phone}
      />
      <Select
        label="人數"
        value={form.guests}
        onChange={e => set('guests', Number(e.target.value))}
        options={guestOptions}
      />
      {showSource && (
        <Select
          label="來源"
          value={form.source}
          onChange={e => set('source', e.target.value)}
          options={[
            { value: 'phone', label: '📞 電話' },
            { value: 'walkin', label: '🚶 現場' },
            { value: 'group', label: '👥 團體' },
            { value: 'line', label: '💚 LINE' },
            { value: 'online', label: '🌐 線上' }
          ]}
        />
      )}

      <div>
        <label className="label">特殊需求</label>
        <div className="grid grid-cols-3 gap-2">
          {NOTE_OPTIONS.map(n => {
            const active = form.notes[n.key]
            return (
              <button
                type="button"
                key={n.key}
                onClick={() => toggleNote(n.key)}
                className={`chip justify-center ${
                  active
                    ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                    : 'border-chicken-brown/15 bg-white text-chicken-brown'
                }`}
              >
                <span className="text-sm font-bold">{n.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <Textarea
        label="備註（選填）"
        value={form.notes.text}
        onChange={e => set('notes', { ...form.notes, text: e.target.value })}
        placeholder="例：靠窗、慶生、過敏資訊..."
      />

      <Button type="submit" disabled={busy} className="w-full text-lg">
        {busy ? '處理中...' : submitLabel}
      </Button>
    </form>
  )
}
