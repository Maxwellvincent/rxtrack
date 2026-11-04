import {describe,it,expect,vi,afterEach} from 'vitest';
vi.mock('./cloudBase.js',()=>({readCloud:vi.fn(),isHydrated:vi.fn(),readError:vi.fn(),subscribeToCloudStore:vi.fn(),updateCloudAwait:vi.fn()}));
import {updateCloudAwait} from './cloudBase.js';
import {change} from './sourceUse.js';
afterEach(()=>vi.resetAllMocks());
describe('source tracking transactions',()=>{
 it('serializes parallel workers and reads fresh state after the previous commit',async()=>{
  let release;let current={items:{}};
  updateCloudAwait.mockImplementationOnce(async(_user,_key,update)=>{await new Promise(resolve=>{release=resolve;});current=update(current);return current;})
   .mockImplementationOnce(async(_user,_key,update)=>{current=update(current);return current;});
  const first=change('u',value=>({...value,first:true}));
  const second=change('u',value=>({...value,second:true}));
  await Promise.resolve();await Promise.resolve();
  expect(updateCloudAwait).toHaveBeenCalledTimes(1);
  release();await Promise.all([first,second]);
  expect(current).toEqual({items:{},first:true,second:true});
 });
 it('does not poison later changes after a failed commit',async()=>{
  updateCloudAwait.mockRejectedValueOnce(new Error('failed-precondition')).mockImplementationOnce(async(_u,_k,update)=>update({items:{}}));
  await expect(change('u',value=>value)).rejects.toThrow('failed-precondition');
  await expect(change('u',value=>({...value,recovered:true}))).resolves.toEqual({items:{},recovered:true});
 });
});
