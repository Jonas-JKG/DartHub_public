import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),from:vi.fn(),rpc:vi.fn(),profile:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({configured:()=>true,managerSchemaReady:async()=>true,repository:{session:mock.session},db:()=>({from:mock.from}),rpc:mock.rpc}));
vi.mock('../src/server/manager-access',()=>({managerProfile:mock.profile,managerId:(s:{manager_id?:string})=>s.manager_id??'root'}));
import {GET,POST} from '../src/app/api/managers/route';
const request=(body:unknown)=>new NextRequest('https://darts.example/api/managers',{method:'POST',headers:{origin:'https://darts.example',cookie:'dartbracket_session=test'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('MANAGER_AUTH_ENABLED','true');vi.stubEnv('APP_ORIGIN','https://darts.example');vi.stubEnv('RATE_LIMIT_HMAC_KEY','1'.repeat(64));mock.rpc.mockResolvedValue(true);});
afterEach(()=>vi.unstubAllEnvs());
it('Manager und Spieler können weder fremde Manager auflisten noch deaktivieren',async()=>{
 for(const s of [null,{role:'viewer',manager_id:'a'},{role:'editor',manager_id:'a'},{role:'owner',manager_id:'a'}]){
  mock.session.mockResolvedValue(s);expect((await GET(new NextRequest('https://darts.example/api/managers',{headers:{cookie:'dartbracket_session=test'}}))).status).toBe(403);
  expect((await POST(request({id:'00000000-0000-4000-8000-000000000002',operation:'disable'}))).status).toBe(403);
 }
 expect(mock.from).not.toHaveBeenCalled();
});

it('ausgewählter Manager ist auch ohne Turniere abrufbar und bleibt auf den Owner beschränkt',async()=>{const id='00000000-0000-4000-8000-000000000002';const q={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:async()=>({data:{id,name:'Leas Darts'},error:null})};mock.from.mockReturnValue(q);mock.session.mockResolvedValue({role:'owner',manager_id:null});const r=await GET(new NextRequest('https://darts.example/api/managers?manager='+id,{headers:{cookie:'dartbracket_session=test'}}));expect(await r.json()).toEqual({manager:{id,name:'Leas Darts'}});expect(q.select).toHaveBeenCalledWith('id,name');mock.from.mockClear();mock.session.mockResolvedValue({role:'owner',manager_id:'other'});expect((await GET(new NextRequest('https://darts.example/api/managers?manager='+id,{headers:{cookie:'dartbracket_session=test'}}))).status).toBe(403);expect(mock.from).not.toHaveBeenCalled();});
