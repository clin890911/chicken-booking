import {it,expect,vi,afterEach} from 'vitest'
import {operationalRequest} from '../../src/services/cloudDataService'
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('操作API沿用HTTP timeout，不會永遠儲存中，保留可辨識失敗',async()=>{
 vi.useFakeTimers()
 vi.stubGlobal('fetch',vi.fn((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))))))
 const pending=operationalRequest('adminHandoff',{id:'T1'});const result=expect(pending).rejects.toMatchObject({code:'timeout',message:'連線逾時，請檢查網路後重試'})
 await vi.advanceTimersByTimeAsync(20000);await result
})
