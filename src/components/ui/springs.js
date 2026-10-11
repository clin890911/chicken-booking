// Apple 預設 UI spring：critically damped（damping 1.0、response ≈0.35s），不 overshoot。
// sheet（modal 面板）帶一點點回彈（bounce 0.15）。只用在 transform / opacity。
// 系統開「減少動態效果」時，App 外層的 MotionConfig reducedMotion="user" 會讓 framer 略過 transform 動畫。
export const SPRING_UI = { type: 'spring', bounce: 0, duration: 0.35 }
export const SPRING_SHEET = { type: 'spring', bounce: 0.15, duration: 0.4 }
