import { afterEach,describe,it,expect,vi } from 'vitest';
import { loginAutodarts,refreshAutodarts,listAutodartsBoards,autodartsTicket,autodartsImage,autodartsBoardEmpty } from '../src/server/autodarts';
afterEach(()=>vi.unstubAllGlobals());
describe('Autodarts Cloud-HTTP',()=>{
  it('verwendet feste Anbieteradressen, keinen Cache und nur das nötige Anmelde-Payload',async()=>{
    const mock=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({access_token:'access',refresh_token:'refresh'})));vi.stubGlobal('fetch',mock);
    await loginAutodarts('user@example.com','test-password');expect(mock.mock.calls[0][0]).toBe('https://api.autodarts.com/auth/v1/login');expect(mock.mock.calls[0][1].cache).toBe('no-store');expect(mock.mock.calls[0][1].redirect).toBe('error');expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({username:'user@example.com',password:'test-password',client_id:'autodarts-play'});
    await refreshAutodarts('refresh');expect(mock.mock.calls[1][0]).toBe('https://api.autodarts.com/auth/v1/refresh');
  });
  it('gibt nur Boardnamen und IDs aus und codiert kurzlebige Tickets',async()=>{
    const mock=vi.fn().mockResolvedValueOnce(Response.json([{id:'own',name:'Meine Scheibe',secret:'hidden'},{invalid:true}])).mockResolvedValueOnce(Response.json({code:'short/ticket'}));vi.stubGlobal('fetch',mock);
    expect(await listAutodartsBoards('access')).toEqual([{id:'own',name:'Meine Scheibe'}]);expect(await autodartsTicket('access')).toBe('wss://play.ws.autodarts.com/ms/v0/subscribe?code=short%2Fticket');
    expect(mock.mock.calls[1][1].headers.Authorization).toBe('Bearer access');
  });
  it('reicht Fehlermeldungen und unbekannte Antworten des Anbieters nicht ungeprüft durch',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({password:'secret',error:'internal'},{status:403})));await expect(loginAutodarts('user','secret')).rejects.toThrow('Autodarts hat die Anmeldung');
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(Response.json({unknown:1}))));await expect(listAutodartsBoards('access')).rejects.toThrow('unbekanntes Format');await expect(loginAutodarts('user','secret')).rejects.toThrow('noch nicht unterstützt');
  });
});

it('fragt ein einzelnes entzerrtes Kamerabild ohne Streaming-Start ab',async()=>{
 const mock=vi.fn().mockResolvedValue(Response.json({url:'/image/live.jpg?ticket=frame'}));vi.stubGlobal('fetch',mock);
 expect(await autodartsImage('access','own/board',2)).toBe('https://boards.ws.autodarts.com/image/live.jpg?ticket=frame');
 expect(mock.mock.calls[0][0]).toBe('https://api.autodarts.com/bs/v0/boards/own%2Fboard/img/live?cam=2&warp=true');
 expect(mock.mock.calls[0][1].headers.Authorization).toBe('Bearer access');
});

it('Startzustand bestätigt nur eine tatsächlich leere verbundene Scheibe',async()=>{
 const mock=vi.fn();vi.stubGlobal('fetch',mock);
 for(const [state,empty] of [[{numThrows:0,connected:true},true],[{numThrows:1},false],[{numThrows:0,connected:false},false],[{numThrows:0,throws:[{}]},false],[{numThrows:'0'},false],[{},false]] as const){
 mock.mockResolvedValueOnce(Response.json(state));expect(await autodartsBoardEmpty('access','own/board')).toBe(empty);
 }
 expect(mock.mock.calls[0][0]).toBe('https://api.autodarts.com/bs/v0/boards/own%2Fboard/state');
 expect(mock.mock.calls[0][1].headers.Authorization).toBe('Bearer access');
});
