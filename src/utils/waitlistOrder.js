// 原取號順位：時間相同仍按號碼，再以id穩定排序；回來不可因merge append落隊尾。
export function compareWaitlistOrder(a,b){
 return String(a.takenAt||'').localeCompare(String(b.takenAt||''))
  || (Number(a.queueNumber)||0)-(Number(b.queueNumber)||0)
  || String(a.id||'').localeCompare(String(b.id||''))
}
