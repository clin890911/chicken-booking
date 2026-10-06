// 團單編輯器「存檔前檢查清單」與存檔錯誤訊息的純邏輯（從 GroupEditorStage 抽出，方便單元測試）。
//
// 語意（2026-10，店主拍板）：
//   - 「關閉場次 / 時段」（closures.closedSeatings / closedSlots）只擋線上客人；後台建團不受它擋，
//     只在清單上黃字提醒「線上已關」。公休日（closedDates）維持原狀：照擋（後端也擋）。
//   - 席位不夠（7 人圈 6 人桌、場次總席位超收）不擋，黃字警告；店家大客滿時會請客人擠一擠。
//   - 硬擋只剩：基本欄位（旅行社 / 人數 / 場次 / 每梯圈桌）、停用/維修桌、撞桌（地圖與後端交易把關）。
//
// check 四態：ok（綠勾）／warn（黃點＋原因，ok:true 不擋存檔）／bad（紅點，擋）／todo（灰點，還沒填）。
// canSave = 每一項 ok && !bad（warn 項 ok 為 true，不影響）。

// 場次卡 / 拆梯選擇器共用的狀態判定（r 來自 remainingTablesForSeating(..., { ignoreOnlineClosure: true })）。
//   dayClosed     公休日 → 不可選（維持原狀）
//   onlineClosed  線上已關（場次被關）→ 可選，只提示
//   full          實際已無剩餘席 → 可選，只提示「客滿」
export function seatingCardState(r) {
  const dayClosed = !!r?.dayClosed
  const onlineClosed = !!r?.closed && !dayClosed
  const full = !dayClosed && (r?.remainingSeats ?? 0) <= 0
  return { dayClosed, onlineClosed, full, selectable: !dayClosed }
}

// 檢查清單。所有輸入都是 GroupEditorStage 已算好的值。
//   seatWarnings: groupSeatWarnings() 的結果（超坐）
//   onlineClosedNames: 本團各梯所在、線上已關閉的場次/時段名稱（已去重）
//   overbookedSeatings: [{ name, over }] 場次總席位超收（散客＋其他團＋本團 > 全店座位）
export function buildGroupEditorChecks({
  hasAgency, total, specialErr,
  hasSeatings, seatingPicked, dayClosed = false,
  batchesReady, heldSeats, seatWarnings = [],
  onlineClosedNames = [], overbookedSeatings = [],
  badTables = [],
}) {
  const checks = [
    { key: 'agency', label: '已選旅行社', ok: !!hasAgency, bad: false, reason: '請選擇或新增旅行社' },
    { key: 'total', label: '總人數大於 0', ok: total > 0 && !specialErr, bad: !!specialErr, reason: specialErr || '請填總人數' },
    {
      key: 'seating',
      label: hasSeatings ? '已選場次' : '已選用餐時段',
      ok: !!seatingPicked && !dayClosed,
      bad: !!dayClosed,
      reason: dayClosed ? '本日公休，無法建團' : (hasSeatings ? '請選擇場次' : '請選擇用餐時段'),
    },
  ]
  if (onlineClosedNames.length) {
    checks.push({
      key: 'online', label: `線上已關：${onlineClosedNames.join('、')}`,
      ok: true, warn: true, bad: false, reason: '只停線上訂位，後台照樣可存',
    })
  }
  checks.push({ key: 'batches', label: '每梯都已圈桌且有人數', ok: !!batchesReady, bad: false, reason: '還有梯次沒圈桌或沒填人數' })

  const singleOver = seatWarnings.length === 1 && seatWarnings[0].key === 'total' ? seatWarnings[0].over : 0
  const seatsLabel = `席位：已圈 ${heldSeats} / 需 ${total}${singleOver ? `，超坐 ${singleOver} 人` : ''}`
  const seatsFilled = total > 0 && heldSeats > 0
  checks.push({
    key: 'seats',
    label: seatsLabel,
    ok: seatsFilled,
    warn: seatsFilled && seatWarnings.length > 0,
    bad: false,
    reason: !seatsFilled
      ? '請圈桌'
      : singleOver ? '大客滿可請客人擠一擠，照樣可存'
        : seatWarnings.map(w => w.message).join('；'),
  })
  if (overbookedSeatings.length) {
    checks.push({
      key: 'overbooked',
      label: `場次總席位超收：${overbookedSeatings.map(s => `${s.name} ${s.over} 席`).join('、')}`,
      ok: true, warn: true, bad: false, reason: '含散客與其他團，請確認現場坐得下',
    })
  }
  checks.push({ key: 'tables', label: '沒有停用/維修中的桌', ok: badTables.length === 0, bad: badTables.length > 0, reason: `${badTables.join('、')} 當日停用/維修中` })
  return checks
}

export function canSaveGroup(checks = []) {
  return checks.every(c => c.ok && !c.bad)
}

// 存檔失敗的提示文字：依錯誤類型，不要把非撞桌的 409（如公休日）也標成「桌位衝突」。
// 後端撞桌訊息本身已以「桌位衝突：」開頭，原樣顯示（舊版會變成「桌位衝突：桌位衝突：…」）。
export function groupSaveErrorMessage(err) {
  const msg = String(err?.message || '').trim()
  if (err?.status === 409) {
    if (!msg) return '桌位衝突：已被其他團或現場訂位佔用，請重新圈桌'
    if (msg.startsWith('桌位衝突')) return msg
    return '無法儲存：' + msg
  }
  return '儲存失敗：' + (msg || '未知錯誤')
}
