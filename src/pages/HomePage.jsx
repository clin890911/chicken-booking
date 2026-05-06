import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarCheck, Clock, MapPin, Phone, ShieldCheck, Utensils } from 'lucide-react'
import { useBooking } from '../contexts/BookingContext'

const INFO = [
  { icon: Clock, label: '營業時間', value: '11:00 - 19:00' },
  { icon: ShieldCheck, label: '訂位確認', value: '線上送出立即保留' },
  { icon: Utensils, label: '用餐時間', value: '90 分鐘，逾時 15 分釋出' },
]

export default function HomePage() {
  const { settings } = useBooking()
  const banners = settings.heroBanners || []

  return (
    <div className="min-h-screen bg-chicken-cream">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8 lg:grid lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:gap-10">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 }}
          className="flex flex-1 flex-col justify-center py-8"
        >
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-chicken-red/15 bg-white px-3 py-1.5 text-xs font-bold text-chicken-red shadow-sm">
            <CalendarCheck size={15} />
            鹿芝谷主場館線上訂位
          </div>

          <h1 className="text-4xl font-black leading-tight text-chicken-brown sm:text-5xl">
            <span className="inline-flex items-center gap-3">
              <img src="/brand/master-of-chicken-logo.jpg" alt="Master of Chicken" className="h-14 w-14 rounded-full bg-white object-contain p-1.5 shadow-sm" />
              雞王刷刷鍋
            </span>
          </h1>
          <p className="mt-2 text-base font-bold text-chicken-red">Master of Chicken</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-chicken-brown/70">
            48 小時冷藏文昌雞，現場桌位與線上訂位同步管理。選好人數、日期與時段後，系統會立即建立訂位紀錄。
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {INFO.map(({ icon: Icon, label, value }) => (
              <motion.div key={label} whileHover={{ y: -2 }} className="surface p-3">
                <Icon className="mb-2 text-chicken-red" size={20} />
                <div className="text-xs font-bold text-chicken-brown/55">{label}</div>
                <div className="mt-1 text-sm font-black text-chicken-brown">{value}</div>
              </motion.div>
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
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.08 }}
          className="pb-6 lg:pb-0"
        >
          <HeroCarousel banners={banners} />

          <div className="mt-4 text-center">
            <Link to="/admin" className="text-xs font-bold text-chicken-brown/45 underline underline-offset-4">
              同仁登入管理後台
            </Link>
          </div>
        </motion.section>
      </main>
    </div>
  )
}

function HeroCarousel({ banners }) {
  const slides = useMemo(() => {
    if (banners.length > 0) return banners
    return [
      {
        id: 'brand-logo',
        title: 'Master of Chicken',
        subtitle: '48 小時冷藏文昌雞 · 鹿芝谷主場館',
        image: '/brand/master-of-chicken-logo.jpg',
        fit: 'contain',
      },
      {
        id: 'booking',
        title: '線上訂位立即保留',
        subtitle: '選人數、日期與時段，送出後立即建立訂位紀錄',
        image: '',
      },
    ]
  }, [banners])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (slides.length <= 1) return
    const id = window.setInterval(() => setActive(i => (i + 1) % slides.length), 4200)
    return () => window.clearInterval(id)
  }, [slides.length])

  const slide = slides[active] || slides[0]

  return (
    <div className="surface overflow-hidden">
      <div className="relative aspect-[16/10] bg-white">
        {slide.image ? (
          <motion.img
            key={slide.id || slide.image}
            src={slide.image}
            alt={slide.title || '雞王刷刷鍋'}
            className={`h-full w-full bg-white ${slide.fit === 'contain' ? 'object-contain p-6' : 'object-cover'}`}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45 }}
          />
        ) : (
          <motion.div
            key={slide.id}
            className="flex h-full items-center justify-center bg-chicken-red text-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <img src="/brand/master-of-chicken-logo.jpg" alt="Master of Chicken" className="h-36 w-36 rounded-full bg-white object-cover p-2 shadow-lg" />
          </motion.div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-5 text-white">
          <div className="text-xs font-bold opacity-85">{slide.subtitle}</div>
          <div className="mt-1 text-2xl font-black">{slide.title}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="flex gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id || s.image || i}
              onClick={() => setActive(i)}
              className={`h-2 rounded-full transition-all ${i === active ? 'w-7 bg-chicken-red' : 'w-2 bg-chicken-brown/20'}`}
              aria-label={`切換到第 ${i + 1} 張廣告`}
            />
          ))}
        </div>
        <Link to="/book" className="text-xs font-black text-chicken-red">
          立即訂位
        </Link>
      </div>
    </div>
  )
}
