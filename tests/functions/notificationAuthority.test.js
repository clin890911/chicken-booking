import {it,expect} from 'vitest'
import {stripServerOwnedBookingFields} from '../../functions/lib/dataProjection'
it('generic舊/惡意booking snapshot不能降版本或蓋notifyhealth/protocol',()=>{
 const patch={id:'B',name:'測試',notificationVersion:0,notificationProtocol:null,notificationHealth:{status:'sent'},notificationHealthByEvent:{},manageToken:'MOCK_CLIENT_TOKEN'}
 const result=stripServerOwnedBookingFields(patch)
 expect(result).toMatchObject({id:'B',name:'測試'})
 for(const field of ['notificationVersion','notificationProtocol','notificationHealth','notificationHealthByEvent','manageToken'])expect(result[field]).toBeUndefined()
})
