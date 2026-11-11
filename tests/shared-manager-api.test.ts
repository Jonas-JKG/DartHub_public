import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({session:vi.fn(),from:vi.fn(),rpc:vi.fn(),removeAuth:vi.fn(),update:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({configured:()=>true,managerSchemaReady:async()=>true,repository:{session:m.session},rpc:m.rpc,db:()=>({from:m.from,auth:{admin:{deleteUser:m.removeAuth}}}),DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
import {DatabaseError} from '../src/server/repositories/supabase';
import {POST as manager} from '../src/app/api/managers/route';
import {POST as app} from '../src/app/api/app/route';
const id='00000000-0000-4000-8000-000000000002',root={role:'owner',manager_id:null,token_hash:'root'};
const request=(path:string,body:unknown,origin='https://darts.example')=>new NextRequest('https://darts.example/api/'+path,{method:'POST',headers:{origin,cookie:'dartbracket_session=test'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('MANAGER_AUTH_ENABLED','true');vi.stubEnv('APP_ORIGIN','https://darts.example');vi.stubEnv('RATE_LIMIT_HMAC_KEY','1'.repeat(64));m.session.mockResolvedValue(root);m.rpc.mockResolvedValue(true);m.removeAuth.mockResolvedValue({error:null});const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{email:'manager@example.test'},error:null}),update:(patch:unknown)=>{m.update(patch);return q;},then:(resolve:(v:unknown)=>void)=>resolve({error:null})};m.from.mockReturnValue(q);});
afterEach(()=>vi.unstubAllEnvs());
it('nur globaler Owner darf löschen; andere Rollen und fremde Origin erreichen keine Auth-Löschung',async()=>{
 for(const s of [null,{role:'editor'},{role:'viewer'},{role:'owner',manager_id:id}]){m.session.mockResolvedValue(s);expect((await manager(request('managers',{id,operation:'delete',confirmation:'manager@example.test'}))).status).toBe(403);}m.session.mockResolvedValue(root);expect((await manager(request('managers',{id,operation:'delete',confirmation:'manager@example.test'},'https://foreign.test'))).status).toBe(403);expect(m.removeAuth).not.toHaveBeenCalled();
});
it('Löschen verlangt bestätigte E-Mail und schützt das Owner-Konto',async()=>{
 expect((await manager(request('managers',{id,operation:'delete',confirmation:'wrong'}))).status).toBe(409);expect((await manager(request('managers',{id:'00000000-0000-4000-8000-000000000001',operation:'delete',confirmation:'owner'}))).status).toBe(400);expect(m.removeAuth).not.toHaveBeenCalled();expect(m.rpc.mock.calls.some(([name])=>name==='prepare_manager_deletion')).toBe(false);
});
it('vor dem Löschen im Auth-System werden Zugänge gesperrt und Turniere übertragen',async()=>{
 const sequence:string[]=[];m.rpc.mockImplementation(async(name)=>{if(name==='prepare_manager_deletion')sequence.push('database');return true;});m.removeAuth.mockImplementation(async()=>{sequence.push('auth');return {error:null};});expect((await manager(request('managers',{id,operation:'delete',confirmation:'manager@example.test'}))).status).toBe(200);expect(sequence).toEqual(['database','auth']);expect(m.update).toHaveBeenCalledWith(expect.objectContaining({email:'deleted:'+id,name:'Gelöschtes Konto',auth_deleted_at:expect.any(String)}));
});
it('fehlende Migration löscht kein Auth-Konto; fehlgeschlagene Auth-Löschung bleibt gesperrt und wiederholbar',async()=>{
 m.rpc.mockImplementation(async(name)=>{if(name==='prepare_manager_deletion')throw new DatabaseError('missing','PGRST202');return true;});const missing=await manager(request('managers',{id,operation:'delete',confirmation:'manager@example.test'}));expect(await missing.text()).toContain('013_shared_players');expect(m.removeAuth).not.toHaveBeenCalled();
 m.rpc.mockResolvedValue(true);m.removeAuth.mockResolvedValue({error:{status:503}});const failed=await manager(request('managers',{id,operation:'delete',confirmation:'manager@example.test'}));expect(failed.status).toBe(503);expect(await failed.text()).toContain('erneut ausführen');expect(m.update).not.toHaveBeenCalled();
 m.removeAuth.mockResolvedValue({error:{status:404,code:'user_not_found'}});expect((await manager(request('managers',{id,operation:'delete',confirmation:'manager@example.test'}))).status).toBe(200);
});
it('Löschsperre darf durch Aktivieren nicht umgangen werden',async()=>{m.rpc.mockImplementation(async(name)=>{if(name==='manage_manager_status')throw new DatabaseError('deleted','42501');return true;});expect((await manager(request('managers',{id,operation:'enable'}))).status).toBe(400);expect(m.update).not.toHaveBeenCalled();});
it('alte zusätzliche Spielercodes sind deaktiviert',async()=>{m.session.mockResolvedValue({role:'editor',player_access_id:'anchor',tournament_id:id,token_hash:'player'});const r=await app(request('app',{action:'join-player',payload:{code:'123456'}}));expect(r.status).toBe(400);expect(m.rpc.mock.calls.some(([name])=>name==='add_device_player')).toBe(false);});

it('alter zusätzlicher Spielercode darf keine bestehende Identitätsbindung oder Online-Freigabe umgehen',async()=>{m.session.mockResolvedValue({role:'editor',player_access_id:'anchor',tournament_id:id,token_hash:'player'});const r=await app(request('app',{action:'join-player',payload:{code:'123456',takeover:true}}));expect(r.status).toBe(400);expect(m.rpc.mock.calls.some(([name])=>name==='add_device_player')).toBe(false);});
