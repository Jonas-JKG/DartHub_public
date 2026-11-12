import {afterEach,it,expect,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
import {ADMIN_SESSION_MS,PERSISTENT_SESSION_EXPIRY,sessionCookieExpiry,refreshPersistentCookies} from '../src/server/session-lifetime';
import type {Session} from '../src/server/repositories/interface';
afterEach(()=>vi.useRealTimers());
it('uses seven days for Admin and a renewable browser cookie for non-expiring player sessions',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
 expect(ADMIN_SESSION_MS).toBe(7*86400000);expect(PERSISTENT_SESSION_EXPIRY).toBe('infinity');
 expect(sessionCookieExpiry('infinity').getTime()).toBe(Date.now()+365*86400000);
 expect(sessionCookieExpiry('2026-11-15T10:00:00Z').toISOString()).toBe('2026-11-15T10:00:00.000Z');
 const request=new NextRequest('https://example.test/api/identity',{headers:{cookie:'dartbracket_session=opaque; dartbracket_device_accounts=encrypted'}});
 const player={role:'owner',manager_id:'player',expires_at:'infinity'} as Session;
 const response=refreshPersistentCookies(NextResponse.json({ok:true}),request,player);
 expect(response.cookies.get('dartbracket_session')?.value).toBe('opaque');expect(response.cookies.get('dartbracket_device_accounts')?.value).toBe('encrypted');
 expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);expect(response.headers.get('set-cookie')).toMatch(/SameSite=strict/i);
 for(const session of [{...player,manager_id:null},{...player,expires_at:'2026-11-15T10:00:00Z'}])expect(refreshPersistentCookies(NextResponse.json({ok:true}),request,session).headers.get('set-cookie')).toBeNull();
});
