import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({profile:{} as Record<string,any>,sessions:[] as any[],updates:[] as any[],db:vi.fn(),rpc:vi.fn(),login:vi.fn(),getUser:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{signInWithPassword:m.login,getUser:m.getUser}})}));
vi.mock('../src/server/repositories/supabase',()=>({db:m.db,rpc:m.rpc,configured:()=>true,managerSchemaReady:async()=>true,repository:{},DatabaseError:class extends Error{}}));
import {POST} from '../src/app/api/account/route';
import {encrypt} from '../src/server/security';
const user={id:'same-account',email:'player@example.test',email_confirmed_at:'2026-10-15T12:00:00Z',confirmation_sent_at:'2026-10-15T11:00:00Z'};
const request=(body:unknown)=>new NextRequest('https://darts.example/api/account',{method:'POST',headers:{origin:'https://darts.example',cookie:'dartbracket_session=old-owner-cookie'},body:JSON.stringify(body)});
const token=(method:string)=>'header.'+Buffer.from(JSON.stringify({email:user.email,amr:[{method}]})).toString('base64url')+'.signature';
beforeEach(()=>{
 vi.stubEnv('MANAGER_AUTH_ENABLED','true');vi.stubEnv('APP_ORIGIN','https://darts.example');vi.stubEnv('RATE_LIMIT_HMAC_KEY','1'.repeat(64));vi.stubEnv('ACCESS_ENCRYPTION_KEY','2'.repeat(64));
 m.profile={...user,name:'player',enabled:true,approved:true,public_handle:'player',onboarding_completed_at:'2026-10-15',live_secret:encrypt(JSON.stringify({link:'watch-link'})),email_verified_at:'2026-10-15',email_verified_address:user.email,email_verification_required:false,email_verification_version:0};m.sessions=[];m.updates=[];
 m.rpc.mockResolvedValue(true);m.login.mockResolvedValue({error:null,data:{user}});m.getUser.mockResolvedValue({error:null,data:{user}});
 m.db.mockReturnValue({from:(table:string)=>{
  if(table==='sessions')return {insert:async(row:unknown)=>{m.sessions.push(row);return {error:null};}};
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{...m.profile},error:null}),single:async()=>({data:{...m.profile},error:null}),upsert:async()=>({error:null}),update:(row:unknown)=>({eq:async()=>{m.updates.push(row);Object.assign(m.profile,row);return {error:null};}})};return q;
 }});vi.clearAllMocks();
});
afterEach(()=>vi.unstubAllEnvs());
it('real route and session helper reject legacy timestamps; a validated email callback enables only that same account',async()=>{
 const denied=await POST(request({operation:'login',email:user.email,password:'password'}));expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({confirmationRequired:true});expect(denied.headers.get('set-cookie')).toContain('dartbracket_session=;');expect(m.sessions).toHaveLength(0);expect(m.updates).toHaveLength(0);
 const confirmed=await POST(request({operation:'session',accessToken:token('otp')}));expect(confirmed.status).toBe(200);expect(m.getUser).toHaveBeenCalledWith(token('otp'));expect(m.profile).toMatchObject({id:user.id,email_verification_version:1,email_verification_required:false,email_verified_address:user.email});expect(m.sessions).toHaveLength(1);expect(m.sessions[0]).toMatchObject({manager_id:user.id,role:'owner'});
 const proof=m.profile.email_verified_at;m.updates=[];const signedIn=await POST(request({operation:'login',email:user.email.toUpperCase(),password:'password'}));expect(signedIn.status).toBe(200);expect(m.sessions).toHaveLength(2);expect(m.updates).toHaveLength(0);expect(m.profile.email_verified_at).toBe(proof);
});
it('a caller cannot upgrade a password token into email proof, even with emailProof=true',async()=>{const r=await POST(request({operation:'session',accessToken:token('password'),emailProof:true}));expect(r.status).toBe(403);expect(m.updates).toHaveLength(0);expect(m.sessions).toHaveLength(0);});
it('provider-confirmed flags and sent dates cannot re-enable a revoked app email proof',async()=>{m.profile.email_verification_version=1;m.profile.email_verification_required=true;const r=await POST(request({operation:'login',email:user.email,password:'password'}));expect(r.status).toBe(403);expect(m.sessions).toHaveLength(0);});
it('an existing proof for a previous email does not authorize the new address',async()=>{m.profile.email_verification_version=1;m.getUser.mockResolvedValue({error:null,data:{user:{...user,email:'changed@example.test'}}});const r=await POST(request({operation:'session',accessToken:token('otp')}));expect(r.status).toBe(403);expect(m.sessions).toHaveLength(0);});
it('a disabled account remains disabled after a genuine email confirmation',async()=>{m.profile.enabled=false;const r=await POST(request({operation:'session',accessToken:token('otp')}));expect(r.status).toBe(403);expect(m.sessions).toHaveLength(0);expect(m.profile.enabled).toBe(false);});
