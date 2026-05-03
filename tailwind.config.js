/** @type {import('tailwindcss').Config} */
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
      fontFamily: {
        sans: ['"Noto Sans TC"', 'system-ui', '-apple-system', 'sans-serif']
      }
    }
  },
  plugins: []
}
