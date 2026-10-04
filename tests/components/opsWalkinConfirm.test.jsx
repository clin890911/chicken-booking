import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
const mocks = vi.hoisted(() => ({ error:vi.fn(), suggestion:{number:'201',floor:'2F',capacity:6} }))
vi.mock('../../src/contexts/BookingContext',()=>({useBooking:()=>({suggestTable:()=>mocks.suggestion,suggestTableCombo:()=>({enough:false})})}))
vi.mock('../../src/components/ui/Toast',()=>({useToast:()=>({error:mocks.error})}))
vi.mock('../../src/services/customerService',()=>({getByPhone:()=>null,search:()=>[]}))
vi.mock('../../src/services/bookingService',()=>({getNoshowCount:()=>0}))
const FastWalkInPanel=(await import('../../src/components/admin/ops/FastWalkInPanel')).default
const StatusBar=(await import('../../src/components/admin/floormap/StatusBar')).default
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let root,node
const table={number:'105',floor:'1F',capacity:4,status:'vacant'}
const mount=props=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);act(()=>root.render(<FastWalkInPanel guests={2} onGuestsChange={vi.fn()} {...props}/>))}
const button=()=>node.querySelector('[data-testid="walkin-seat"]')
afterEach(()=>{act(()=>root?.unmount());node?.remove();vi.clearAllMocks()})
describe('帶位明確確認',()=>{
 it('按鈕寫客人、人數、桌；快速重點只提交一次',()=>{const onSeat=vi.fn(()=>true);mount({tables:[table],onSeat});expect(button().tagName).toBe('BUTTON');expect(button().textContent).toMatch(/確認入座.*2 位.*105/);act(()=>{button().click();button().click()});expect(onSeat).toHaveBeenCalledTimes(1)})
 it('預配／團保警示未確認時不能入座，確認後才呼叫原服務',()=>{const onSeat=vi.fn(()=>true);mount({tables:[table],warning:{text:'下組13:00'},onSeat});expect(button().disabled).toBe(true);act(()=>button().click());expect(onSeat).not.toHaveBeenCalled();act(()=>node.querySelector('input[type="checkbox"]').click());expect(button().disabled).toBe(false);act(()=>button().click());expect(onSeat).toHaveBeenCalledTimes(1)})
 it('不足席數不提交；服務失敗可重試、不重置已選桌',()=>{const onSeat=vi.fn(()=>false);mount({tables:[table],guests:6,onSeat});expect(button().disabled).toBe(true);act(()=>root.render(<FastWalkInPanel guests={2} tables={[table]} onGuestsChange={vi.fn()} onSeat={onSeat}/>));act(()=>button().click());expect(node.textContent).toContain('105');act(()=>button().click());expect(onSeat).toHaveBeenCalledTimes(2)})
 it('推薦顯示樓層且定位只通知地圖，不提交客人',()=>{const onSeat=vi.fn(),onLocateSuggestion=vi.fn();mount({onSeat,onLocateSuggestion});expect(node.textContent).toContain('2F・201');act(()=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes('定位建議桌')).click());expect(onLocateSuggestion).toHaveBeenCalledWith('201');expect(onSeat).not.toHaveBeenCalled();expect(button().disabled).toBe(true)})
 it('暫停任務隱藏電話鍵盤但保留姓名電話註記草稿，恢復後可提交同一組',()=>{const onSeat=vi.fn(()=>false),onGuestsChange=vi.fn();mount({tables:[table],onSeat,onGuestsChange});const input=node.querySelector('input[aria-label="電話"]');act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0911222333');input.dispatchEvent(new Event('input',{bubbles:true}));input.click()});expect(document.querySelector('[aria-label="電話數字鍵盤"]')).not.toBeNull();act(()=>root.render(<FastWalkInPanel guests={2} tables={[table]} onSeat={onSeat} onGuestsChange={onGuestsChange} suspended/>));expect(document.querySelector('[aria-label="電話數字鍵盤"]')).toBeNull();act(()=>root.render(<FastWalkInPanel guests={2} tables={[table]} onSeat={onSeat} onGuestsChange={onGuestsChange}/>));expect(node.querySelector('input[aria-label="電話"]').value).toBe('0911222333')})
 it('全店可入座沿用同一桌況判定，不把時間衝突空桌計入',()=>{mount({});act(()=>root.render(<StatusBar tables={[table,{...table,number:'102'}]} waitlist={[]} tablePresentation={{105:{canSeatNow:true},102:{canSeatNow:false}}}/>));const chip=node.querySelector('.status-vacant');expect(chip.textContent).toContain('1');expect(chip.textContent).toContain('可入座')})
 it('候位完成捷徑只返回候位清單',()=>{const onNextWaitlist=vi.fn(),onSeat=vi.fn();mount({onSeat,onNextWaitlist,showNextWaitlist:true});act(()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='帶下一組候位').click());expect(onNextWaitlist).toHaveBeenCalledTimes(1);expect(onSeat).not.toHaveBeenCalled()})
})
