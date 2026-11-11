import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {encrypt,decrypt} from '../src/server/security';
const m=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),login:vi.fn(),refresh:vi.fn(),boards:vi.fn(),ticket:vi.fn(),image:vi.fn(),empty:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{session:m.session},rpc:m.rpc,DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
vi.mock('../src/server/autodarts',()=>({AutodartsError:class extends Error{},loginAutodarts:m.login,refreshAutodarts:m.refresh,listAutodartsBoards:m.boards,autodartsTicket:m.ticket,autodartsImage:m.image,autodartsBoardEmpty:m.empty}));
import {GET,POST} from '../src/app/api/autodarts/route';
const manager='00000000-0000-4000-8000-000000000002';
const session={role:'owner',manager_id:manager,participant_id:'player-a',playing_tournament_id:'t',token_hash:'session-hash'};
const request=(body:unknown)=>new NextRequest('http://localhost:3000/api/autodarts',{method:'POST',headers:{origin:'http://localhost:3000',cookie:'dartbracket_session=test','content-type':'application/json'},body:JSON.stringify(body)});
let linked=true;
beforeEach(()=>{
 vi.clearAllMocks();linked=true;process.env.APP_ORIGIN='http://localhost:3000';process.env.ACCESS_ENCRYPTION_KEY='1'.repeat(64);process.env.RATE_LIMIT_HMAC_KEY='2'.repeat(64);m.session.mockResolvedValue(session);
 m.login.mockResolvedValue({access_token:'private-access',refresh_token:'initial-refresh'});m.refresh.mockResolvedValue({access_token:'rotated-access',refresh_token:'rotated-refresh'});m.boards.mockResolvedValue([{id:'mine',name:'Meine Scheibe'}]);m.ticket.mockResolvedValue('wss://play.ws.autodarts.com/test');m.empty.mockResolvedValue(true);
 m.rpc.mockImplementation(async(name,args)=>{if(name==='consume_login_attempt')return true;switch(args.p_operation){case'read':return {accountKey:'manager:'+manager,linked,boardId:'mine',autoConnect:true};case'claim':return {accountKey:'manager:'+manager,secret:encrypt(JSON.stringify({accountKey:'manager:'+manager,refresh:'stored-refresh'}))};default:return {ok:true};}});
});
it('neue Sitzung stellt Scheibe ohne Cookie und Passwort wieder her und speichert Rotation',async()=>{
 const status=await GET(new NextRequest('http://localhost:3000/api/autodarts',{headers:{cookie:'dartbracket_session=new'}}));expect(await status.json()).toMatchObject({authenticated:true,linked:true,boardId:'mine',autoConnect:true});
 const r=await POST(request({operation:'ticket',boardId:'mine'}));expect(r.status).toBe(200);expect(m.refresh).toHaveBeenCalledWith('stored-refresh');expect(await r.text()).not.toMatch(/refresh|rotated-access/);
 const finished=m.rpc.mock.calls.find(([_,v])=>v.p_operation==='finish')![1];expect(JSON.parse(decrypt(finished.p_secret))).toEqual({accountKey:'manager:'+manager,refresh:'rotated-refresh'});
});
it('Owner und Manager dürfen vor der Spielerzuordnung verknüpfen, aber keine Würfe oder Bilder beziehen',async()=>{
 m.session.mockResolvedValue({...session,participant_id:null,playing_tournament_id:null});linked=false;
 const r=await POST(request({operation:'login',username:'a@example.test',password:'private-password',remember:true}));expect(r.status).toBe(200);expect(await r.text()).not.toMatch(/private-password|initial-refresh|private-access/);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
 expect((await POST(request({operation:'ticket',boardId:'mine'}))).status).toBe(401);expect(m.ticket).not.toHaveBeenCalled();
 const saved=m.rpc.mock.calls.find(([_,v])=>v.p_operation==='link')![1];expect(JSON.parse(decrypt(saved.p_secret))).toMatchObject({refresh:'initial-refresh'});
});
it('fremde Scheibe verweigert Ticket, aber erneuertes Token wird trotzdem gesichert',async()=>{
 expect((await POST(request({operation:'connect',boardId:'foreign'}))).status).toBe(403);expect(m.ticket).not.toHaveBeenCalled();expect(m.rpc.mock.calls.find(([_,v])=>v.p_operation==='finish')![1].p_board).toBeNull();
});
it('Entfernen während Refresh verhindert ein erfolgreiches Ticket und Token-Wiederherstellung',async()=>{
 const impl=m.rpc.getMockImplementation()!;m.rpc.mockImplementation(async(name,args)=>args.p_operation==='finish'?{ok:false}:impl(name,args));
 expect((await POST(request({operation:'ticket',boardId:'mine'}))).status).toBe(409);
});
it('Token eines anderen Kontos wird weder weitergegeben noch zum Anbieter geschickt',async()=>{
 const impl=m.rpc.getMockImplementation()!;m.rpc.mockImplementation(async(name,args)=>args.p_operation==='claim'?{accountKey:'manager:foreign',secret:encrypt(JSON.stringify({accountKey:'manager:foreign',refresh:'foreign-token'}))}:impl(name,args));
 const r=await POST(request({operation:'boards'}));expect(r.status).toBe(502);expect(m.refresh).not.toHaveBeenCalled();expect(await r.text()).not.toContain('foreign-token');
});
it('Abmelden entfernt die Verknüpfung, Pausieren erhält sie',async()=>{
 expect((await POST(request({operation:'pause'}))).status).toBe(200);expect(m.rpc.mock.calls.some(([_,v])=>v.p_operation==='unlink')).toBe(false);
 const r=await POST(request({operation:'disconnect'}));expect(r.status).toBe(200);expect(m.rpc.mock.calls.some(([_,v])=>v.p_operation==='unlink')).toBe(true);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
});

it('globaler Owner darf seine gespeicherte Scheibe auch ohne feste Spielerzuordnung für Vertretungen verbinden',async()=>{const key='manager:00000000-0000-4000-8000-000000000001';m.session.mockResolvedValue({...session,manager_id:null,participant_id:null,playing_tournament_id:null});m.rpc.mockImplementation(async(name,args)=>{if(name==='consume_login_attempt')return true;if(args.p_operation==='read')return {accountKey:key,linked:true,boardId:'mine',autoConnect:true};if(args.p_operation==='claim')return {accountKey:key,secret:encrypt(JSON.stringify({accountKey:key,refresh:'owner-refresh'}))};return {ok:true};});expect((await POST(request({operation:'ticket',boardId:'mine'}))).status).toBe(200);expect(m.refresh).toHaveBeenCalledWith('owner-refresh');expect((await POST(request({operation:'image',boardId:'foreign',cam:0}))).status).toBe(403);expect(m.image).not.toHaveBeenCalled();});
it('Spielerkonto erhält im Turnierkontext automatisch seine eigene Identität und behält sein Autodarts-Profil',async()=>{const tid='00000000-0000-4000-8000-000000000099';m.session.mockResolvedValue({...session,participant_id:null,playing_tournament_id:null});const impl=m.rpc.getMockImplementation()!;m.rpc.mockImplementation(async(name,args)=>name==='account_play_session'?{role:'editor',token_hash:'derived-child',account_session_hash:session.token_hash,account_manager_id:manager,manager_id:'foreign-creator',tournament_id:tid,participant_id:'my-player',participant_ids:['my-player']}:impl(name,args));const r=await POST(new NextRequest('http://localhost:3000/api/autodarts',{method:'POST',headers:{origin:'http://localhost:3000',cookie:'dartbracket_session=test','x-dartbracket-tournament':tid},body:JSON.stringify({operation:'ticket',boardId:'mine'})}));expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('account_play_session',{p_hash:session.token_hash,p_id:tid});expect(m.refresh).toHaveBeenCalledWith('stored-refresh');expect(m.rpc).toHaveBeenCalledWith('autodarts_profile',expect.objectContaining({p_hash:'derived-child',p_operation:'read'}));});
it('fremder oder ungültiger Turnierkontext verleiht keine Autodarts-Spielrechte',async()=>{m.session.mockResolvedValue({...session,participant_id:null,playing_tournament_id:null});const impl=m.rpc.getMockImplementation()!;m.rpc.mockImplementation(async(name,args)=>name==='account_play_session'?null:impl(name,args));for(const context of ['invalid','00000000-0000-4000-8000-000000000088']){const r=await POST(new NextRequest('http://localhost:3000/api/autodarts',{method:'POST',headers:{origin:'http://localhost:3000',cookie:'dartbracket_session=test','x-dartbracket-tournament':context},body:JSON.stringify({operation:'ticket',boardId:'mine'})}));expect(r.status).toBe(401);}expect(m.ticket).not.toHaveBeenCalled();});
it('a temporary cross-device lease conflict advertises a bounded retry without changing login state',async()=>{
 m.rpc.mockImplementation(async(name,args)=>{if(name==='consume_login_attempt')return true;if(args.p_operation==='read')return {accountKey:'manager:'+manager,linked:true,boardId:'mine',autoConnect:true};if(args.p_operation==='claim')return {busy:true};return {ok:true};});const response=await POST(request({operation:'boards'}));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({retryAfter:1});expect(m.refresh).not.toHaveBeenCalled();expect(m.rpc.mock.calls.some(([_,args])=>args.p_operation==='unlink')).toBe(false);
});
it('reconnect state check is private, checks board ownership and issues no socket ticket',async()=>{const response=await POST(request({operation:'state',boardId:'mine'}));expect(response.status).toBe(200);expect(await response.json()).toEqual({boardEmpty:true});expect(m.ticket).not.toHaveBeenCalled();expect((await POST(request({operation:'state',boardId:'foreign'}))).status).toBe(403);});
