const STORAGE_KEY = 'chicken_settings_v1'

const DEFAULT = {
  openTime: '11:00',
  closeTime: '19:00',
  slotInterval: 30,
  maxDaysAhead: 30,
  heroBanners: [],
  lineOfficialUrl: 'https://lin.ee/8lECi4S',
  lineOfficialName: '雞王刷刷鍋 LINE 官方帳號',
  lineLiffUrl: 'https://liff.line.me/2009996489-f1SCb75q',
  lineLiffId: '2009996489-f1SCb75q',
  lineBindEndpoint: 'https://linebind-reaor76eyq-uc.a.run.app',
  linePushEndpoint: 'https://linepushbooking-reaor76eyq-uc.a.run.app',
  lineManageEndpoint: 'https://linegetbooking-reaor76eyq-uc.a.run.app',
  storeName: '雞王刷刷鍋',
  storePhone: '',
  storeAddress: '南投縣鹿谷鄉中正路二段377號',
  storeMapUrl: 'https://www.google.com/maps/search/?api=1&query=%E5%8D%97%E6%8A%95%E7%B8%A3%E9%B9%BF%E8%B0%B7%E9%84%89%E4%B8%AD%E6%AD%A3%E8%B7%AF%E4%BA%8C%E6%AE%B5377%E8%99%9F',
  storeLatitude: '23.7523874',
  storeLongitude: '120.746746'
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT }
    return { ...DEFAULT, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT }
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
