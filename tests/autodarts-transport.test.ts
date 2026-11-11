import {it,expect,vi,afterEach} from 'vitest';
import {decodeAutodartsMessage,autodartsRequest} from '../src/client/autodarts-transport';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('decodes the same board JSON from text, Blob and ArrayBuffer without changing its fields',async()=>{
 const frame={channel:'autodarts.boards',topic:'board.events',data:{event:'Throw detected',throwNumber:1,throw:{segment:{number:20,multiplier:3}}}},text=JSON.stringify(frame);
 for(const raw of [text,new Blob([text]),new TextEncoder().encode(text).buffer])expect(await decodeAutodartsMessage(raw)).toEqual(frame);
 for(const raw of ['not-json',new Uint8Array([255,255]).buffer,new Blob(['x'.repeat(100001)]),null,'x'.repeat(100001)])expect(await decodeAutodartsMessage(raw)).toBeNull();
});
it('waits for an explicit temporary cross-device refresh conflict and then returns the refreshed result',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'busy',retryAfter:1},{status:409})).mockResolvedValueOnce(Response.json({boards:[{id:'own',name:'Board'}]}));vi.stubGlobal('fetch',fetcher);const wait=vi.fn(),request=autodartsRequest({operation:'boards'},{'X-Dartbracket-Dartdeck':'room'},wait);await vi.advanceTimersByTimeAsync(1000);expect(await request).toEqual({boards:[{id:'own',name:'Board'}]});expect(wait).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].headers['X-Dartbracket-Dartdeck']).toBe('room');
});
it('does not retry authentication errors or unrelated conflicts, and bounds retries of a busy lease',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({error:'Sign in again'},{status:401}));vi.stubGlobal('fetch',fetcher);await expect(autodartsRequest({operation:'boards'},{})).rejects.toThrow('Sign in again');expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockClear().mockResolvedValue(Response.json({error:'Profile changed'},{status:409}));await expect(autodartsRequest({operation:'ticket'},{})).rejects.toThrow('Profile changed');expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockClear().mockResolvedValue(Response.json({error:'Login failed',retryAfter:1},{status:409}));await expect(autodartsRequest({operation:'login'},{})).rejects.toThrow('Login failed');expect(fetcher).toHaveBeenCalledTimes(1);
 vi.useFakeTimers();fetcher.mockClear().mockImplementation(()=>Promise.resolve(Response.json({error:'Still busy',retryAfter:1},{status:409})));const result=autodartsRequest({operation:'boards'},{}).catch(e=>e.message);await vi.runAllTimersAsync();expect(await result).toBe('Still busy');expect(fetcher).toHaveBeenCalledTimes(5);
});
