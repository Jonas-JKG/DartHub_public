import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:mock.from,rpc:mock.rpc})}));
import {SupabaseRepository} from '../src/server/repositories/supabase';
import type {Session} from '../src/server/repositories/interface';
const repo=new SupabaseRepository();
const session=(role:Session['role'],manager_id:string|null,tournament_id:string|null=null):Session=>({role,manager_id,tournament_id,token_hash:'test',credential_version:1,expires_at:'2099-01-01'});
const rows=[{state:{id:'a'},id:'a',manager_id:'manager-a',status:'running'},{state:{id:'b'},id:'b',manager_id:'manager-b',status:'running'},{state:{id:'archive'},id:'archive',manager_id:'manager-a',status:'archived'}];
beforeEach(()=>{vi.stubEnv('MANAGER_AUTH_ENABLED','true');vi.stubEnv('SUPABASE_SECRET_KEY','test');mock.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='account_linked_tournaments'?[]:true,error:null}));mock.from.mockClear();mock.from.mockImplementation(()=>{
 let filtered=[...rows];const q={select:()=>q,order:()=>q,eq:(key:string,value:unknown)=>{filtered=filtered.filter(r=>r[key as keyof typeof r]===value);return q;},neq:(key:string,value:unknown)=>{filtered=filtered.filter(r=>r[key as keyof typeof r]!==value);return q;},maybeSingle:async()=>({data:filtered[0]??null,error:null}),then:(resolve:(v:unknown)=>void)=>resolve({data:filtered,error:null})};return q;
});});
afterEach(()=>vi.unstubAllEnvs());
it('Migration bleibt wirksam, wenn der UI-Schalter deaktiviert wird; Netzwerkfehler öffnen keinen Zugriff',async()=>{
 vi.stubEnv('MANAGER_AUTH_ENABLED','false');mock.rpc.mockResolvedValueOnce({data:null,error:{code:'NETWORK',message:'unavailable'}});
 await expect(repo.list(null)).rejects.toThrow('unavailable');
 mock.rpc.mockResolvedValueOnce({data:false,error:null});await expect(repo.list(null)).rejects.toThrow('nicht bestätigt');
 mock.rpc.mockResolvedValueOnce({data:true,error:null});expect(await repo.list(null)).toEqual([]);
 expect(await repo.get('b',session('owner','manager-a'))).toBeNull();
});

it('ohne Sitzung liefern Liste und direkte IDs keine Turniere',async()=>{expect(await repo.list(null)).toEqual([]);expect(await repo.get('a',null)).toBeNull();expect(mock.from).not.toHaveBeenCalled();});
it('Manager, Spieler und Zuschauer erhalten ausschließlich ihren Bereich',async()=>{
 expect((await repo.list(session('owner','manager-a'))).map(t=>t.id)).toEqual(['a','archive']);
 expect(await repo.get('b',session('owner','manager-a'))).toBeNull();
 expect(await repo.list(session('viewer','manager-a'))).toEqual([]);
 expect(await repo.get('archive',session('viewer','manager-a'))).toBeNull();
 expect(await repo.get('b',session('viewer','manager-a'))).toBeNull();
 expect((await repo.list(session('editor','manager-a','a'))).map(t=>t.id)).toEqual(['a']);
 expect(await repo.get('b',session('editor','manager-a','a'))).toBeNull();
});
it('nur der globale Owner sieht alle Bereiche und Archive',async()=>{expect((await repo.list(session('owner',null))).map(t=>t.id)).toEqual(['a','b','archive']);expect(await repo.get('b',session('owner',null))).not.toBeNull();});
it('Trainingsräume erscheinen nicht im Turnierfeed und verlangen einen eigenen Spielerzugang',async()=>{
 const row={id:'training',state:{id:'training',kind:'training'},manager_id:'manager-a',status:'running'};
 mock.from.mockImplementation(()=>{const q={select:()=>q,order:()=>q,eq:()=>q,neq:()=>q,maybeSingle:async()=>({data:row,error:null}),then:(resolve:(v:unknown)=>void)=>resolve({data:[row],error:null})};return q;});
 expect(await repo.list(session('viewer','manager-a'))).toEqual([]);expect(await repo.get('training',session('viewer','manager-a'))).toBeNull();expect(await repo.get('training',{...session('editor','manager-a','training'),training_id:'training'})).toMatchObject({id:'training'});
});

it('write snapshots retain the exact persisted JSON and never inherit current display metadata',async()=>{
 const state={id:'a',managerId:'stored-manager',managerName:'historic-name'},row={state,id:'a',manager_id:'manager-a',manager:{name:'Current display name'},status:'running'};
 mock.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,neq:()=>q,maybeSingle:async()=>({data:row,error:null})};return q;});
 const s=session('editor','manager-a','a');expect(await repo.get('a',s)).toMatchObject({managerId:'manager-a',managerName:'Current display name'});expect(await repo.get('a',s,{stateOnly:true})).toEqual(state);
 expect(await repo.get('b',s,{stateOnly:true})).toBeNull();expect(await repo.get('a',null,{stateOnly:true})).toBeNull();
});
