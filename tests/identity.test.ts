import {describe,it,expect} from 'vitest';
import {normalizeIdentification} from '../packages/domain/src/identity';
describe('identity',()=>{
 it('preserves leading zeros and letters',()=>{expect(normalizeIdentification({country:'CR',type:'other',value:' 00Ab-123 '})).toBe('00Ab-123')});
 it('only removes approved separators for national IDs',()=>{expect(normalizeIdentification({country:'CR',type:'national',value:'1-0123-0456'})).toBe('101230456')});
 it('rejects empty identifiers',()=>{expect(()=>normalizeIdentification({country:'CR',type:'other',value:'  '})).toThrow()});
});
