// 休店／關閉三方合併：與後端共用同一份純函式（同 lineReadiness 的轉出口模式），前後端合併口徑不會分岔。
export { mergeClosures, sameClosures } from '../../functions/lib/closuresMerge.js'

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

// 後端回報的同時修改衝突（[{ field, key }]）→ 給店員看的提示；沒有衝突回 ''。
// key 是日期（YYYY-MM-DD → M/D）或星期（'0'..'6' → 每週日..每週六）；同一天多個欄位只列一次。
export function describeClosureConflicts(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return ''
  const labels = []
  for (const c of conflicts) {
    const key = String(c?.key ?? '')
    const m = key.match(/^\d{4}-(\d{2})-(\d{2})$/)
    const label = m ? `${Number(m[1])}/${Number(m[2])}` : (/^[0-6]$/.test(key) ? `每週${WEEKDAY[Number(key)]}` : key)
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels.length ? `${labels.join('、')} 的休店／關閉設定被他人同時修改，已以你的為準` : ''
}
