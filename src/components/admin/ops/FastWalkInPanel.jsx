import { useState, useEffect, useRef } from 'react'
import { Input } from '../../ui'
import { useToast } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import PartySizeField from '../PartySizeField'
import { normalizeSplit } from '../../../utils/partySplit'
import FloatingPhoneKeypad from './FloatingPhoneKeypad'
import ReturningGuestBadges, { useMatchedCustomer } from '../ReturningGuestBadges'
import HonorificNameField, { composeName, DEFAULT_TITLE } from './HonorificNameField'
import Icon from '../../ui/Icon'
import { todayStr } from '../../../utils/timeSlots'
import { squeezeSeats } from '../../../utils/capacity'
import GlyphText from '../../ui/GlyphText'
import { History } from 'lucide-react'
import RiskAck from './RiskAck'
import { SEAT_PRIMARY, SEAT_SECONDARY } from './seatButtons'

// 現場常駐「帶位」面板（v3）：順序不拘的狀態機——系統只需要「桌」和「幾位」，
// 先點桌或先選人數都行，兩者到齊底部的確認鈕才亮；確認＝入座（唯一語意，不再二次確認）。
//
// 併桌統一在同一條路徑：selected 是桌陣列，一桌走 walkInSeat、多桌走 walkInSeatMulti，
// 同一個手勢靠陣列長度分派（舊版另開 walkin-multi mode，且漏了預配/團保兩道防呆）。
//
// 版面：上半可捲、主要動作釘在底部。iPad 10 橫向左欄可視高只有 506pt，欄位全展開一定超過，
// 釘底才能保證「確認入座」永遠按得到（舊版主按鈕會被捲到視線外）。
//
// props:
//   guests / onGuestsChange — 人數提到父層，桌況圖才能同步標建議桌
//   tables                  — 已選桌物件陣列（父層持有，與桌況圖同一份真相）
//   onRemoveTable / onClearTables
//   warning                 — { text } 預配衝突或團體保留桌的警示；有警示時確認鈕要先解鎖
//   onSeat(payload)         — 真正入座，回傳 false 代表失敗（維持欄位，方便改人數或改候位）
export default function FastWalkInPanel({
  suspended = false, onLocateSuggestion, onApplySuggestion, showNextWaitlist, onNextWaitlist,
  guests, onGuestsChange, tables = [], onRemoveTable, onClearTables, warning, onSeat, onOpenTable,
  lastParty, multi = false, autoMulti = false, onToggleMulti = null, excess = null, restore = null, onRestored,
}) {
  const toast = useToast()
  const { suggestTable, suggestTableCombo } = useBooking()
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [surname, setSurname] = useState(null)
  const [customName, setCustomName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [kids, setKids] = useState(0) // 小孩數（大人＝guests−kids）；預設 0，常態只點大人
  const [keypadOpen, setKeypadOpen] = useState(false) // 漂浮數字鍵盤（點電話欄才跳）
  const [override, setOverride] = useState(false)   // 有警示時，店員要先明確解鎖才能確認
  const matched = useMatchedCustomer(phone)
  const rootRef = useRef(null)
  const phoneRef = useRef(null)
  useEffect(() => { if (suspended) setKeypadOpen(false) }, [suspended])

  // 電話帶到顧客 → 自動帶姓名（不覆蓋店員已點的稱謂/姓氏，也不覆蓋已手打的）
  useEffect(() => {
    if (matched && !surname && !customName) setCustomName(matched.name || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched?.phone])

  // 復原散客入座（C 包驗收 F4）：父層把入座前的表單原樣丟回來（nonce 區分每一次），回填後通知父層清掉。
  // 面板不在畫面上（切到別籤）時復原也不會丟：下次掛載時照樣回填。
  useEffect(() => {
    if (!restore) return
    setTitle(restore.title || DEFAULT_TITLE); setSurname(restore.surname ?? null); setCustomName(restore.customName || '')
    setKids(Number(restore.kids) || 0); setPhone(restore.phone || ''); setNotes(restore.notes || '')
    setKeypadOpen(false); setOverride(false)
    onRestored?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.nonce])

  // 換了桌或換了警示 → 解鎖狀態重置，避免上一次的「仍要覆蓋」被沿用到下一桌
  useEffect(() => { setOverride(false) }, [warning?.text, tables.map(t => t.number).join(',')])

  const seatFired = useRef(false)
  useEffect(() => { seatFired.current = false }, [tables.map(t => t.number).join(','), guests, warning?.text])
  const g = Number(guests) || 0
  const seats = tables.reduce((sum, t) => sum + (t.capacity || 0), 0)
  // 擠一擠：每桌可多坐 1 位（6 人桌坐 7 位），超過原席數照樣可入座、但標黃提醒
  const maxSeats = squeezeSeats(tables)
  const enough = tables.length > 0 && g > 0 && maxSeats >= g
  const squeezed = enough && seats < g

  // 即時可坐判定（不估時間）。已選桌看合計席數；沒選桌才給建議。
  // 文案（C 包 #16）：一行只講一件事，不用店內黑話（擠一擠）。超坐＝每桌可多坐 1 位，照樣可入座、標黃提醒。
  let verdict = null
  let recommendation = null
  if (tables.length > 0) {
    const label = tables.map(t => t.number).join(' + ')
    verdict = g <= 0
      ? { tone: 'idle', icon: 'chair', text: `${label}（${seats} 席）· 請選人數` }
      : squeezed
        ? { tone: 'multi', icon: 'warning', text: `${g} 位 → ${label}（${seats} 席・超坐 ${g - seats} 位）` }
        : enough
          ? { tone: 'ok', icon: 'checkCircle', text: `${g} 位 → ${label}（${seats} 席）` }
          : { tone: 'none', icon: 'warning', text: `${g} 位坐不下 ${label}（${seats} 席）· 再加一桌或換桌` }
  } else if (g > 0) {
    // 建議桌看「現在入座」的佔用區間 [現在, 現在+佔位)：避開其間已被別筆預配的桌與團保桌（只影響建議，不擋點選）
    // 「（自行選桌）」拿掉：建議只是建議，店員點哪張就是哪張（點桌＝改選），下方「用建議桌」鈕一下選好
    const single = suggestTable(g, { date: todayStr(), mode: 'now' })
    if (single) { recommendation = { ...single, tableNumbers: [String(single.number)] }; verdict = { tone: 'ok', icon: 'pointer', text: `${g} 位 · 建議 ${single.floor}・${single.number}` } }
    else {
      const combo = suggestTableCombo(g, { date: todayStr(), mode: 'now' })
      if (combo.enough) recommendation = { number: combo.tableNumbers?.[0], floor: combo.floor, tableNumbers: (combo.tableNumbers || []).map(String) }
      verdict = combo.enough
        ? { tone: 'multi', icon: 'chair', text: `${g} 位 · 建議併桌 ${combo.floor}・${(combo.tableNumbers || []).join(' + ')}${combo.squeezed ? `（${combo.seats} 席・超坐 ${g - combo.seats} 位）` : ''}` }
        : { tone: 'none', icon: 'hourglass', text: '目前座位不足 · 建議改候位取號' }
    }
  }
  const V = {
    ok: 'bg-chicken-green/15 text-chicken-green border-chicken-green/40',
    idle: 'bg-chicken-brown/5 text-chicken-brown/70 border-chicken-brown/20',
    multi: 'bg-amber-500/10 text-amber-700 border-amber-500/40',
    none: 'bg-chicken-red/10 text-chicken-red border-chicken-red/40',
  }

  const blockedByWarning = !!warning && !override
  const ready = enough && !blockedByWarning
  // 停用時講「還缺哪一步」（灰底，不是淡紅——淡紅像錯誤，walkthrough #16）。
  // 人數優先：入座後人數回到「未選」（C 包 #14），下一組一定要重新點人數，不會沿用到上一組的預設 2。
  const slideLabel = enough
    ? (blockedByWarning ? '請先勾選上方確認' : '確認入座 →')
    : g <= 0 ? '先選人數'
      : tables.length === 0 ? '請先選桌'
        : '席數不足 · 再加一桌'

  // 目前組好的稱呼（已選桌卡片與入座共用同一份，卡片上看到什麼就是會存進去的什麼）
  const displayName = composeName(title, surname, customName.trim()) || matched?.name || ''

  // 入座後重置：人數回到「未選」（0），不預選 2（C 包 #14：預選的 2 位會讓下一組 4 位被當 2 位入座）。
  // 要沿用上一組 → 按釘底的「沿用上一組 N 位」（只沿用人數＋店員手打的 staffNotes）。
  const reset = () => {
    onGuestsChange(0); setKids(0); setTitle(DEFAULT_TITLE); setSurname(null); setCustomName('')
    setPhone(''); setNotes(''); setKeypadOpen(false); setOverride(false)
  }

  const seat = () => {
    if (!tables.length) return toast.error('請先點桌況圖選一張桌')
    if (!(g > 0)) return toast.error('請選人數')
    if (maxSeats < g) return toast.error(`${g} 位坐不下 ${tables.map(t => t.number).join(' + ')}（${seats} 席）`)
    if (seatFired.current || blockedByWarning) return false
    seatFired.current = true
    const nm = displayName
    const allergyNote = matched?.allergies ? `過敏：${matched.allergies}` : ''
    const noteText = [notes.trim(), allergyNote].filter(Boolean).join('；')
    const ok = onSeat?.({
      name: nm, phone: phone.trim(), guests: g, children: normalizeSplit(g, kids).children, notes: noteText,
      // 🔴 staffNotes＝店員手打的那段，**不含**由電話帶出的「過敏：xxx」。
      // M6「沿用上一組」只能沿用這個；用 noteText 會把上一位客人的過敏資訊
      // 帶到下一組的訂位上（個資外洩＋出餐安全）。
      staffNotes: notes.trim(),
      tableNumbers: tables.map(t => t.number),
      // 復原用（C 包驗收 F4）：按下入座前表單的原樣，復原時姓氏、稱謂跟人數一起回填（不是只回人數、姓名變「現場客」）
      form: { title, surname, customName, kids, phone, notes },
    })
    if (ok !== false) reset()
    else seatFired.current = false
  }

  // M6 沿用上一組：只有在「真的會改變什麼」時才出現（人數與註記都已相同就別佔版面、也別讓人白按一下）
  // 桌和人數都選好了就收起（C 包驗收 F2）：這時候已經不會再「沿用人數」，留著只會把釘底區撐高、壓到備註欄。
  const showReuse = !!lastParty && (tables.length === 0 || g <= 0) && (g !== lastParty.guests || kids !== (lastParty.children || 0) || notes.trim() !== (lastParty.notes || ''))

  return (
    <div ref={rootRef} className="flex-1 min-h-0 phone:flex-none flex flex-col">
      {/* 🔴 C 包 #8＋驗收修正 F2：版面分三段，任何一段長高都不可蓋到姓氏、人數鍵。
          ① 鍵盤區（姓氏＋人數）flex-none：永不縮、永不被裁，座標在「選桌前／選桌後／入座後」一模一樣。
          ② 電話＋備註 flex-1（basis 0）：吃剩下的高度，最少保留一列（電話與備註並排，備註永遠露出）。
          ③ 釘底區：資訊列（已選桌、可坐判定、沿用上一組…）可縮、內部捲動；警示勾選＋確認入座永不縮。
          過去整個上半部是一個可捲區、釘底區不設上限 → iPad 橫選 2 桌＋沿用時釘底區長到人數鍵上面，
          點「8 位」實際按到「移除桌 111」（verify-c P1-2）。
          p-3 space-y-1.5：常態情境（一桌＋姓氏＋人數）要能一面式不捲；「🪑 帶位」標題刻意不放（上方分頁籤已寫著）。 */}
      <div data-rail-keys className="flex-none px-3 pt-3 space-y-1.5">
        <HonorificNameField
          title={title}
          surname={surname}
          onChange={({ title: t, surname: s }) => { setTitle(t); setSurname(s) }}
          custom={customName}
          onCustomChange={setCustomName}
          roomAbove
        />

        <PartySizeField total={guests} kids={kids} onChange={(t, c) => { setKids(c); onGuestsChange(t) }} accent="amber" size="lg" />
      </div>

      {/* 電話常駐（不再是收合鈕）：欄位只負責顯示，點它才浮出漂浮數字鍵盤。
          inputMode="none" 是為了不要叫出 iOS 軟鍵盤——鍵盤一跳，左欄就整個被推走。
          電話與備註並排（手機改直排）：iPad 橫向選桌後備註欄過去被壓到幾乎看不見（verify-c P2-6）。 */}
      <div data-rail-fields className="flex-1 min-h-[96px] overflow-y-auto phone:flex-none phone:min-h-0 phone:overflow-visible px-3 pt-1.5 pb-3">
        <div className="grid grid-cols-2 phone:grid-cols-1 gap-2 items-start">
          <div className="min-w-0">
            <label className="label !text-xs !mb-1 whitespace-nowrap overflow-hidden text-ellipsis">
              電話
              <span className="ml-1.5 text-[11px] font-semibold text-chicken-brown/50">帶顧客檔 · 過敏</span>
            </label>
            <input
              ref={phoneRef}
              type="tel"
              inputMode="none"
              aria-label="電話"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onClick={() => setKeypadOpen(true)}
              onFocus={() => setKeypadOpen(true)}
              placeholder="0912345678"
              className={`w-full h-[56px] rounded-xl border-2 px-2.5 text-[20px] font-bold tracking-wide tabular-nums outline-none transition-all ${
                keypadOpen
                  ? 'bg-white border-chicken-red ring-4 ring-chicken-red/20'
                  : 'bg-white border-chicken-brown/15'}`}
            />
          </div>
          <div className="min-w-0">
            <Input
              label="備註（選填）" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="例：靠窗、慶生、過敏" className="!h-[56px]" labelClassName="!text-xs !mb-1"
            />
          </div>
        </div>
        <ReturningGuestBadges phone={phone} matched={matched} />
      </div>

      {/* 釘底：永遠可見，不隨上方欄位捲走。資訊列長高時只會在自己裡面捲，不會往上吃到鍵盤區。 */}
      <div data-rail-footer className="flex-initial min-h-0 phone:flex-none flex flex-col border-t border-chicken-brown/10 bg-white">
        <div data-rail-footer-info className="min-h-0 overflow-y-auto phone:overflow-visible px-3 pt-3 space-y-2 empty:hidden">
          {/* 已選桌：精簡成一行（C 包驗收 F2）。單桌「103・6 人桌｜詳情｜移除」；併桌「101 ✕｜102 ✕」。
              「＋再加一桌」併在同一行，不另佔一列。合計席數看下方的可坐判定。
              帶位籤上點空桌＝選位，抽屜點不到了 → 單桌時「詳情」補一個入口（維修/停用等仍在抽屜裡）。 */}
          {(tables.length > 0 || autoMulti) && (
            <div data-testid="walkin-selected" className="flex items-center gap-1.5 flex-wrap">
              {tables.length === 1 && (() => { const t = tables[0]; return (
                <>
                  <span className="inline-flex items-center gap-1.5 min-h-[44px] rounded-xl border-2 border-chicken-green/60 bg-chicken-green/10 px-2.5">
                    <span className="text-xl font-bold leading-none text-chicken-brown tabular-nums">{t.number}</span>
                    <span className="text-xs font-bold text-chicken-brown/70">{t.capacity} 人桌</span>
                  </span>
                  <button type="button" aria-label={`桌 ${t.number} 詳情`} onClick={() => onOpenTable?.(t.number)}
                    className={`${SEAT_SECONDARY} !px-2.5 text-sm`}>詳情</button>
                  <button type="button" aria-label={`移除桌 ${t.number}`} onClick={() => onRemoveTable?.(t.number)}
                    className={`${SEAT_SECONDARY} !px-2.5 text-sm`}>移除</button>
                </>
              ) })()}
              {tables.length > 1 && tables.map(t => (
                <button key={t.number} type="button" aria-label={`移除桌 ${t.number}`} onClick={() => onRemoveTable?.(t.number)}
                  className="tap inline-flex items-center gap-1 min-h-[44px] rounded-xl border-2 border-chicken-green/60 bg-chicken-green/10 pl-2.5 pr-2 font-bold text-chicken-brown">
                  <span className="text-lg leading-none tabular-nums">{t.number}</span>
                  <span aria-hidden="true" className="text-sm text-chicken-brown/60">✕</span>
                </button>
              ))}
              {/* A2 點桌語意：單選（預設，點別張＝改選）／多選（＋再加一桌，或大組自動）。與選桌入座模式同一套（utils/tablePick） */}
              {autoMulti ? (
                <span data-testid="walkin-auto-multi" className="text-sm font-bold text-amber-800">大組・可選多桌（沒有單桌坐得下 {g} 位）</span>
              ) : onToggleMulti && tables.length > 0 && (
                <button type="button" data-testid="walkin-multi-toggle" aria-pressed={multi} onClick={onToggleMulti}
                  className={`${SEAT_SECONDARY} !px-2.5 text-sm ml-auto ${multi ? '!border-chicken-brown !bg-chicken-brown !text-white' : '!border-dashed'}`}>
                  {multi ? '併桌中・改回單桌' : '＋再加一桌（併桌）'}
                </button>
              )}
            </div>
          )}
          {verdict && (
            <div className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${V[verdict.tone]}`}>
              <Icon name={verdict.icon} size={16} className="inline-block align-[-3px] mr-1" />{verdict.text}
            </div>
          )}
          {excess && (
            <div data-testid="walkin-excess" className="rounded-xl border border-amber-500/40 bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-900">{excess.text}</div>
          )}
          {/* 「用建議桌」＝切樓層＋選好建議桌（含併桌），店員再按確認入座；不自動勾（PR #137）。
              「定位建議桌」與 ModeBanner 同一個動作 → 同一種次鈕（不是底線連結，verify-c P2-5） */}
          {recommendation && (
            <div className="flex items-center gap-2 flex-wrap">
              {onApplySuggestion && (
                <button type="button" data-testid="walkin-apply-suggestion"
                  onClick={() => onApplySuggestion(recommendation.tableNumbers)}
                  className={`${SEAT_SECONDARY} text-sm`}>
                  用建議桌 {recommendation.floor}・{recommendation.tableNumbers.join(' + ')}
                </button>
              )}
              <button type="button" data-testid="walkin-locate-suggestion" onClick={() => onLocateSuggestion?.(recommendation.number)}
                className={`${SEAT_SECONDARY} text-sm`}>定位建議桌 {recommendation.floor}・{recommendation.number}</button>
            </div>
          )}
          {/* M6 沿用上一組：連續同型客人（一直來 2 位）省掉重選。放釘底（C 包 #8）：入座後才出現，不可推動上方鍵盤。
              只沿用人數＋店員手打的 staffNotes（🔴 不可沿用合成 notes：會把上一組的過敏資訊帶到這一組） */}
          {showReuse && (
            <button
              type="button"
              onClick={() => { setKids(lastParty.children || 0); onGuestsChange(lastParty.guests); setNotes(lastParty.notes || '') }}
              className={`${SEAT_SECONDARY} w-full text-sm !border-dashed`}
            >
              <GlyphText icon={History} size={16}>
                沿用上一組（{lastParty.guests} 位{lastParty.children > 0 ? `（小${lastParty.children}）` : ''}{lastParty.notes ? ` · ${lastParty.notes}` : ''}）
              </GlyphText>
            </button>
          )}
        </div>
        {/* 警示勾選＋確認入座：永不縮（資訊列再多也不會把這兩個擠出畫面） */}
        <div className="flex-none p-3 space-y-2">
          {warning && (
            <div className="rounded-xl border border-chicken-red/40 bg-chicken-red/10 px-3 pt-2">
              {/* 併桌時可能不只一張桌有問題 → 逐條列，勾同意前看得到全部 */}
              {(warning.lines || [warning.text]).map((line, i) => (
                <div key={i} className="text-sm font-bold text-chicken-red">{line}</div>
              ))}
              <RiskAck checked={override} onChange={setOverride} />
            </div>
          )}
          <button data-testid="walkin-seat" type="button" onClick={seat} disabled={!ready}
            className={`${SEAT_PRIMARY} w-full min-h-[60px] text-lg !whitespace-normal`}>
            {ready ? `確認入座 · ${displayName || '現場客'} ${g} 位 · ${tables.map(t => t.number).join(' + ')}` : <GlyphText>{slideLabel}</GlyphText>}
          </button>
          {showNextWaitlist && <button type="button" onClick={onNextWaitlist} className={`${SEAT_SECONDARY} w-full`}>帶下一組候位</button>}
        </div>
      </div>

      {/* 漂浮數字鍵盤（與候位取號共用 FloatingPhoneKeypad）：遮罩只用 bg-black/20，桌況圖全程看得見 */}
      <FloatingPhoneKeypad
        open={keypadOpen}
        onClose={() => setKeypadOpen(false)}
        value={phone}
        onChange={setPhone}
        anchorRef={phoneRef}
        boundsRef={rootRef}
        status={matched ? (
          <>
            常客・{matched.name || '（未留名）'}
            {matched.lastVisit ? `・上次 ${new Date(matched.lastVisit).toLocaleDateString('zh-TW')}` : ''}
            {matched.allergies && <b className="text-red-300">・忌{matched.allergies}</b>}
          </>
        ) : phone.length >= 4 ? '查無顧客檔（新客）' : '輸入 4 碼以上自動比對常客'}
      />
    </div>
  )
}
