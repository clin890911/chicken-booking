// 「我知道，仍要用這桌」勾選（C 包，2026-11-27）：取代帶位面板、選桌面板（兩處）、抽屜候選名單、抽屜散客入座
// 四套各自寫的 checkbox（三種字面：「我知道，仍要帶這桌」「知道了，仍用這桌」…）。
// 語意不變（M1，不可回退）：防呆綁在「已選的桌」——呼叫端在換桌／換警示時把 checked 重置成 false，
//   勾了才解鎖確認鈕；這個元件只負責長相與觸控尺寸，不持有狀態。
// 觸控：整個 label 是點擊目標，min-h 44px、滿寬；方框本身 20px。
// tone：'severe'＝紅底白字（會解除別組排位／佔團體桌）｜'soft'＝黃底深字（只是提醒）｜'plain'＝透明底，吃外層的警示框顏色。
export const RISK_ACK_TEXT = '我知道，仍要用這桌'

const TONE = {
  severe: 'text-white',
  soft: 'text-amber-950',
  plain: 'text-chicken-red',
}

export default function RiskAck({ checked, onChange, tone = 'plain', className = '' }) {
  return (
    <label data-testid="risk-ack" className={`flex items-center gap-2.5 w-full min-h-[44px] cursor-pointer select-none text-sm font-bold ${TONE[tone] || TONE.plain} ${className}`}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange?.(e.target.checked)}
        className="w-5 h-5 shrink-0 accent-current"
      />
      {RISK_ACK_TEXT}
    </label>
  )
}
