import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { toastWaitlistSeat } from '../../src/utils/waitlistSeatToast'
let toast, result, undo, view
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T04:00:00Z'))
 toast={action:vi.fn(),success:vi.fn(),info:vi.fn(),error:vi.fn(),dismiss:vi.fn()}
 result={item:{id:'W1',assignedTableNumber:'102',bookingId:'B1'},commandId:'seat-1',tables:[{number:'102',status:'dining',currentBookingId:'B1'}],undoUntil:new Date(Date.now()+4000).toISOString()}
 undo=vi.fn(async()=>({ok:true}));view=vi.fn()
})
afterEach(()=>vi.useRealTimers())
it('ACK keeps 查看 using canonical table, plus a separate cloud-only 復原 within server deadline',async()=>{
 toastWaitlistSeat(result,{message:'入座102',toast,undoWaitlistSeat:undo,onView:view})
 const actions=toast.action.mock.calls
 expect(actions.map(call=>call[1].label)).toEqual(['查看','復原'])
 actions[0][1].onClick();expect(view).toHaveBeenCalledWith('102');expect(undo).not.toHaveBeenCalled()
 expect(actions[1][2].duration).toBe(4000)
 await actions[1][1].onClick();expect(undo).toHaveBeenCalledWith('W1','seat-1')
 expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('已復原入座'))
})
it('expired undo still retains 查看 and never offers late undo',()=>{
 result.undoUntil=new Date(Date.now()-1).toISOString()
 toastWaitlistSeat(result,{message:'入座102',toast,undoWaitlistSeat:undo,onView:view})
 expect(toast.action.mock.calls.map(call=>call[1].label)).toEqual(['查看'])
 toast.action.mock.calls[0][1].onClick();expect(view).toHaveBeenCalledWith('102')
})
it('cloud undo rejection does not report success or invoke a local rollback',async()=>{
 undo.mockResolvedValue({ok:false,error:'桌已改變'})
 toastWaitlistSeat(result,{message:'入座102',toast,undoWaitlistSeat:undo,onView:view})
 await toast.action.mock.calls[1][1].onClick()
 expect(toast.error).toHaveBeenCalledWith('復原未確認：桌已改變')
 expect(toast.info).not.toHaveBeenCalled();expect(view).not.toHaveBeenCalled()
})
