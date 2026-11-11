import { beforeEach,describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),login:vi.fn(),refresh:vi.fn(),boards:vi.fn(),ticket:vi.fn(),image:vi.fn(),empty:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{session:mocks.session},rpc:mocks.rpc}));
vi.mock('../src/server/autodarts',()=>({AutodartsError:class extends Error{},loginAutodarts:mocks.login,refreshAutodarts:mocks.refresh,listAutodartsBoards:mocks.boards,autodartsTicket:mocks.ticket,autodartsImage:mocks.image,autodartsBoardEmpty:mocks.empty}));
import { GET,POST } from '../src/app/api/autodarts/route';
const session={role:'editor',participant_id:'player-a',tournament_id:'t',token_hash:'a'.repeat(64)};
function request(body:unknown,cookie='',origin='http://localhost:3000'){return new NextRequest('http://localhost:3000/api/autodarts',{method:'POST',headers:{origin,cookie:'dartbracket_session=test'+(cookie?'; '+cookie:''),'content-type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();process.env.APP_ORIGIN='http://localhost:3000';process.env.ACCESS_ENCRYPTION_KEY='1'.repeat(64);process.env.RATE_LIMIT_HMAC_KEY='2'.repeat(64);mocks.session.mockResolvedValue(session);mocks.rpc.mockResolvedValue(true);mocks.login.mockResolvedValue({access_token:'private-access',refresh_token:'private-refresh'});mocks.refresh.mockResolvedValue({access_token:'private-access-2',refresh_token:'rotated-refresh'});mocks.boards.mockResolvedValue([{id:'mine',name:'Meine Scheibe'}]);mocks.ticket.mockResolvedValue('wss://play.ws.autodarts.com/ms/v0/subscribe?code=test');mocks.empty.mockResolvedValue(true);});
async function loginCookie(){const r=await POST(request({operation:'login',username:'test@example.com',password:'private-password'}));expect(r.status).toBe(200);return {r,cookie:r.headers.get('set-cookie')!.split(';')[0]};}
describe('Autodarts-Anmeldung',()=>{
  it('fremde Origin und nicht ausgewählte Spieler erreichen Autodarts nicht',async()=>{
    expect((await POST(request({operation:'boards'},'','https://evil.example'))).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();
    for(const s of [null,{...session,participant_id:null},{...session,role:'admin'}]){mocks.session.mockResolvedValue(s);expect((await POST(request({operation:'login',username:'a',password:'p'}))).status).toBe(401);}expect(mocks.login).not.toHaveBeenCalled();
  });
  it('speichert kein Passwort, verbirgt Zugangstokens und setzt verschlüsseltes HttpOnly-Cookie',async()=>{
    const {r,cookie}=await loginCookie();const body=await r.text();expect(body).not.toMatch(/private-access|private-refresh|private-password/);expect(cookie).not.toMatch(/private/);expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/i);expect(r.headers.get('set-cookie')).toMatch(/SameSite=strict/i);expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await POST(request({operation:'ticket',boardId:'mine'},cookie))).status).toBe(200);expect(mocks.refresh).toHaveBeenCalledWith('private-refresh');
  });
  it('Anmeldung ist an genau die Sitzung und Spielerzuordnung gebunden',async()=>{
    const {cookie}=await loginCookie();for(const other of [{...session,participant_id:'b'},{...session,tournament_id:'other'},{...session,token_hash:'different'}]){mocks.session.mockResolvedValue(other);expect((await POST(request({operation:'boards'},cookie))).status).toBe(401);}expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('fremde Boards erhalten kein Ticket und Abmelden löscht die Anmeldung',async()=>{
    const {cookie}=await loginCookie();expect((await POST(request({operation:'ticket',boardId:'other'},cookie))).status).toBe(403);expect(mocks.ticket).not.toHaveBeenCalled();const r=await POST(request({operation:'disconnect'},cookie));expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
  it('begrenzte Anmeldung und Netzwerkfehler verraten keine Zugangsdaten',async()=>{
    mocks.rpc.mockResolvedValue(false);expect((await POST(request({operation:'login',username:'a',password:'p'}))).status).toBe(429);expect(mocks.login).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue(true);mocks.login.mockRejectedValue(new Error('private-password'));const r=await POST(request({operation:'login',username:'a',password:'p'}));expect(r.status).toBe(502);expect(await r.text()).not.toContain('private-password');
    expect((await GET(new NextRequest('http://localhost:3000/api/autodarts'))).headers.get('cache-control')).toBe('no-store');
  });
});

it('Scheibenbild erfordert die eigene Board-Zuordnung und verbirgt Zugangstokens',async()=>{
 const {cookie}=await loginCookie();mocks.image.mockResolvedValue('https://boards.ws.autodarts.com/image/frame.jpg');
 expect((await POST(request({operation:'image',boardId:'other',cam:0},cookie))).status).toBe(403);expect(mocks.image).not.toHaveBeenCalled();
 const r=await POST(request({operation:'image',boardId:'mine',cam:2},cookie));expect(r.status).toBe(200);expect(mocks.image).toHaveBeenCalledWith('private-access-2','mine',2);expect(await r.text()).not.toMatch(/private-access|private-refresh/);
 expect((await POST(request({operation:'image',boardId:'mine',cam:3},cookie))).status).toBe(400);
});

 it('Ticket prüft einmal die leere eigene Scheibe und fällt bei Fehlern sicher zurück',async()=>{
 const {cookie}=await loginCookie();
 const r=await POST(request({operation:'ticket',boardId:'mine'},cookie));
 expect(await r.json()).toMatchObject({boardEmpty:true});expect(mocks.empty).toHaveBeenCalledWith('private-access-2','mine');
 mocks.empty.mockRejectedValue(new Error('private-access'));
 const fallback=await POST(request({operation:'ticket',boardId:'mine'},cookie));expect(fallback.status).toBe(200);expect(await fallback.json()).toMatchObject({boardEmpty:false});
 });
