import type {NextRequest,NextResponse} from 'next/server';
import type {Session} from './repositories/interface';
export const ADMIN_SESSION_MS=7*86400000;
export const PERSISTENT_SESSION_EXPIRY='infinity';
// Browsers cap cookie lifetimes. Refresh persistent cookies during verified use;
// the server session itself remains valid until it is explicitly revoked.
export function sessionCookieExpiry(expiresAt:string){return expiresAt===PERSISTENT_SESSION_EXPIRY?new Date(Date.now()+365*86400000):new Date(expiresAt);}
export function refreshPersistentCookies(response:NextResponse,request:NextRequest,session:Session){
 if(session.role!=='owner'||!session.manager_id||session.expires_at!==PERSISTENT_SESSION_EXPIRY)return response;
 const expires=sessionCookieExpiry(session.expires_at);
 for(const name of ['dartbracket_session','dartbracket_device_accounts']){
  const raw=request.cookies.get(name)?.value;
  if(raw)response.cookies.set(name,raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',expires});
 }
 return response;
}
