import {afterEach,it,expect,vi} from 'vitest';
import {rememberLoginDestination,loginDestination} from '../src/client/post-login';
afterEach(()=>vi.unstubAllGlobals());
it('Login erhält Kontoseiten, lehnt fremde Redirect-Ziele aber ab',()=>{
 const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)});
 for(const next of ['/training/00000000-0000-4000-8000-000000000001','/friends','/account/setup']){vi.stubGlobal('window',{location:{search:'?next='+encodeURIComponent(next)}});rememberLoginDestination();vi.stubGlobal('window',{location:{search:''}});expect(loginDestination('/')).toBe(next);expect(store.size).toBe(0);}
 for(const next of ['https://evil.test','//evil.test','/join?code=ABCD1234','/training/00000000-0000-4000-8000-000000000001#invite='+'x'.repeat(43),'/friends?friend='+'x'.repeat(43)]){vi.stubGlobal('window',{location:{search:'?next='+encodeURIComponent(next)}});rememberLoginDestination();expect(loginDestination('/')).toBe('/');}
});
