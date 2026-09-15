// 單色線條圖示（24 格、1.8 描邊、currentColor）。後台導覽與規劃頁以此取代 emoji：
// emoji 在不同裝置字型不一、無法跟隨文字色，也讓畫面顯得雜；線條圖示可依 className 控色/控大小。
// 用法：<Icon name="bus" size={18} className="text-chicken-red" />
const PATHS = {
  ops: <><path d="M5 10h14v11" /><path d="M5 10V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v6" /><path d="M5 21v-6" /><path d="M5 15h14" /></>,
  planning: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14" /><path d="M15 6v14" /></>,
  bookings: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></>,
  roster: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 15a5 5 0 0 1 5.5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" /><path d="M4.9 4.9l2.1 2.1" /><path d="M17 17l2.1 2.1" /><path d="M4.9 19.1L7 17" /><path d="M17 7l2.1-2.1" /></>,
  logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  bus: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M3 11h18" /><circle cx="7" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>,
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  leaf: <><path d="M4 20c0-8 4-14 16-16-1 12-7 16-16 16z" /><path d="M4 20c4-6 8-9 12-11" /></>,
  child: <><circle cx="12" cy="6" r="3" /><path d="M8 21v-6l-2-5h12l-2 5v6" /></>,
  walk: <><circle cx="13" cy="4" r="2" /><path d="M10 22l2-7" /><path d="M15 22l-2-6-3-3 1-5 3 1 2 3" /><path d="M8 12l1-4 3-1" /></>,
  wheelchair: <><circle cx="14" cy="4" r="2" /><path d="M13 8v6h5l3 6" /><circle cx="9" cy="17" r="4" /><path d="M13 9H9" /></>,
  warning: <><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><path d="M12 18h.01" /></>,
  print: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 21h12v-6H6z" /></>,
  map: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14" /><path d="M15 6v14" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  utensils: <><path d="M7 3v8" /><path d="M4 3v5a3 3 0 0 0 6 0V3" /><path d="M7 11v10" /><path d="M17 3c-2 1-3 3-3 6v3h3v9" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></>,
  table: <><rect x="3" y="7" width="18" height="4" rx="1" /><path d="M6 11v8" /><path d="M18 11v8" /><path d="M6 15h12" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
}

export default function Icon({ name, size = 20, strokeWidth = 1.8, className = '', title }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {d}
    </svg>
  )
}
