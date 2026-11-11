import {it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({db:mock.db,DatabaseError:class extends Error{},rpc:vi.fn()}));
import {createManagerSession} from '../src/server/manager-access';
it('unbestätigte E-Mail erstellt weder Managerprofil noch Sitzung',async()=>{
 await expect(createManagerSession({id:'forged-user',email:'x@example.test'})).rejects.toThrow('bestätige zuerst');expect(mock.db).not.toHaveBeenCalled();
});
