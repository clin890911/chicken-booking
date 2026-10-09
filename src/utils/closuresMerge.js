// 休店／關閉三方合併：與後端共用同一份純函式（同 lineReadiness 的轉出口模式），前後端合併口徑不會分岔。
export { mergeClosures, sameClosures } from '../../functions/lib/closuresMerge.js'
