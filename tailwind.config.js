/** @type {import('tailwindcss').Config} */

// 文字對比 WCAG AA（2026-10）：品牌色當「字色」時的專用色階，只影響 text-*，不動底色／邊框／placeholder。
// 現場頁實測約半數小字不到 4.5:1——次要字 text-chicken-brown/40–70 在白底只有 2.3–4.8:1、
// 雞王綠字 2.0:1、雞王黃字 2.3:1、雞王紅字在淡紅底 3.7–4.3:1。iPad 在餐廳燈光下看不清就會點錯。
// 做法：在 textColor 裡把這些 class 名直接對到「同色相、加深」的值（Tailwind 先查 values['chicken-brown/60']
// 這種完整 key，所以 className 一個都不用改；bg-chicken-brown/5 之類的底色不受影響）。
// 層次仍保留兩階：/40–/45 次要、/50–/65 一般次要、/70–/75 接近主文字；/20–/35 刻意不動（停用、過去日、裝飾圖示）。
const BROWN = '58 46 38'
const brownText = (a) => `rgb(${BROWN} / ${a})`
const TEXT_ONLY = {
  chicken: {
    'brown/40': brownText(0.75),
    'brown/45': brownText(0.75),
    'brown/50': brownText(0.78),
    'brown/55': brownText(0.78),
    'brown/60': brownText(0.78),
    'brown/65': brownText(0.78),
    'brown/70': brownText(0.84),
    'brown/75': brownText(0.84),
    'brown/80': brownText(0.88),  // 原 0.80 會比 /70（0.84）還淡，層次倒置 → 拉到 0.88 保持遞增
    // 品牌色字：色相不變、加深到白底／淡色底都 ≥4.5:1
    green: '#5a7314',            // 雞王綠 #9eb63a 當字 2.0:1 → 5.4:1
    yellow: '#9a5700',           // 雞王黃 #f29100 當字 2.3:1 → 白底 5.5:1、黃淡底 4.9:1
    red: '#c2000f',              // 雞王紅 #e60012 在 red-50/100 底 3.7–4.3:1 → ≥5:1
    'red/70': 'rgb(194 0 15 / 0.88)',
    'red/80': 'rgb(194 0 15 / 0.92)',
  },
}

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        chicken: {
          red: '#e60012',
          yellow: '#f29100',
          green: '#9eb63a',
          cream: '#FAF7F0',
          brown: '#3A2E26'
        }
      },
      textColor: TEXT_ONLY,
      fontFamily: {
        sans: ['"Noto Sans TC"', 'system-ui', '-apple-system', 'sans-serif']
      }
    }
  },
  plugins: []
}
