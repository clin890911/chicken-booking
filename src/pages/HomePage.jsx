import { Link } from 'react-router-dom'
import { CalendarCheck, Clock, MapPin, Phone, ShieldCheck, Utensils } from 'lucide-react'

const INFO = [
  { icon: Clock, label: '營業時間', value: '11:00 - 19:00' },
  { icon: ShieldCheck, label: '訂位確認', value: '線上送出立即保留' },
  { icon: Utensils, label: '用餐時間', value: '90 分鐘，逾時 15 分釋出' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-chicken-cream">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8 lg:grid lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:gap-10">
        <section className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-chicken-red/15 bg-white px-3 py-1.5 text-xs font-bold text-chicken-red shadow-sm">
            <CalendarCheck size={15} />
            鹿芝谷主場館線上訂位
          </div>

          <h1 className="text-4xl font-black leading-tight text-chicken-brown sm:text-5xl">
            雞王刷刷鍋
          </h1>
          <p className="mt-2 text-base font-bold text-chicken-red">Master of Chicken</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-chicken-brown/70">
            48 小時冷藏文昌雞，現場桌位與線上訂位同步管理。選好人數、日期與時段後，系統會立即建立訂位紀錄。
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {INFO.map(({ icon: Icon, label, value }) => (
              <div key={label} className="surface p-3">
                <Icon className="mb-2 text-chicken-red" size={20} />
                <div className="text-xs font-bold text-chicken-brown/55">{label}</div>
                <div className="mt-1 text-sm font-black text-chicken-brown">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link to="/book" className="btn-primary inline-flex flex-1 items-center justify-center gap-2 py-4 text-base">
              <CalendarCheck size={20} />
              我要訂位
            </Link>
            <a href="tel:04-XXXX-XXXX" className="btn-secondary inline-flex items-center justify-center gap-2 py-4 text-base">
              <Phone size={18} />
              來電詢問
            </a>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-xs font-bold text-chicken-brown/55">
            <span className="inline-flex items-center gap-1.5"><MapPin size={14} />鹿芝谷主場館</span>
            <span>超過 12 位可於備註說明</span>
          </div>
        </section>

        <section className="pb-6 lg:pb-0">
          <div className="surface overflow-hidden">
            <div className="bg-chicken-red px-5 py-4 text-white">
              <div className="text-xs font-bold opacity-85">今日訂位流程</div>
              <div className="mt-1 text-2xl font-black">4 步驟完成保留</div>
            </div>
            <div className="space-y-3 p-5">
              {['選擇用餐人數', '挑選日期', '確認抵達時段', '留下聯絡資訊'].map((text, i) => (
                <div key={text} className="flex items-center gap-3 rounded-xl border border-chicken-brown/10 bg-white p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-chicken-red text-sm font-black text-white">
                    {i + 1}
                  </div>
                  <div className="font-bold text-chicken-brown">{text}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 text-center">
            <Link to="/admin" className="text-xs font-bold text-chicken-brown/45 underline underline-offset-4">
              同仁登入管理後台
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
