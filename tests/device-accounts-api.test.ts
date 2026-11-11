import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
const m=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),db:vi.fn(),remove:vi.fn(),profile:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({configured:()=>true,managerSchemaReady:async()=>true,repository:{session:m.session},rpc:m.rpc,db:m.db}));
vi.mock('../src/server/manager-access',()=>({managerProfile:m.profile,managerId:(s:any)=>s.manager_id??'admin'}));
import {GET,POST} from '../src/app/api/device-accounts/route';
import {encrypt,hashToken} from '../src/server/security';
const extraRaw='private-extra-token'.repeat(2),root={role:'owner',manager_id:randomUUID(),token_hash:hashToken('root'),expires_at:'2099-01-01'},extra={...root,manager_id:randomUUID(),token_hash:hashToken(extraRaw)};
function request(body?:unknown,origin='https://example.test'){return new NextRequest('https://example.test/api/device-accounts',{method:body?'POST':'GET',headers:{origin,cookie:'dartbracket_session=root; dartbracket_device_accounts='+encrypt(JSON.stringify({parent:root.token_hash,tokens:[extraRaw]}))},...(body?{body:JSON.stringify(body)}:{})});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('MANAGER_AUTH_ENABLED','true');vi.stubEnv('APP_ORIGIN','https://example.test');vi.stubEnv('ACCESS_ENCRYPTION_KEY','2'.repeat(64));vi.stubEnv('RATE_LIMIT_HMAC_KEY','1'.repeat(64));m.rpc.mockResolvedValue(true);m.remove.mockResolvedValue({error:null});m.db.mockReturnValue({from:()=>({delete:()=>({eq:m.remove})})});m.session.mockImplementation(async raw=>raw==='root'?root:raw===extraRaw?extra:null);m.profile.mockResolvedValue({public_handle:'player',name:'private-name',email:'secret@example.test',live_secret:'secret-live-token'});});
it('the list exposes only public account labels, never sessions, email or profile secrets',async()=>{const r=await GET(request());expect(r.status).toBe(200);expect(await r.json()).toEqual({accounts:[{id:root.manager_id,name:'player',primary:true},{id:extra.manager_id,name:'player',primary:false}]});});
it('removal revokes just the attached session; primary and unrelated accounts cannot be removed',async()=>{
 for(const id of [root.manager_id,randomUUID()])expect((await POST(request({id}))).status).toBe(403);expect(m.remove).not.toHaveBeenCalled();
 const r=await POST(request({id:extra.manager_id}));expect(r.status).toBe(200);expect(m.remove).toHaveBeenCalledExactlyOnceWith('token_hash',extra.token_hash);expect(r.headers.get('set-cookie')).toContain('dartbracket_device_accounts=;');expect(r.headers.get('set-cookie')).not.toContain('dartbracket_session=');
});
it('foreign origin, rate limiting and missing primary sessions block removal',async()=>{expect((await POST(request({id:extra.manager_id},'https://evil.test'))).status).toBe(403);m.rpc.mockResolvedValue(false);expect((await POST(request({id:extra.manager_id}))).status).toBe(429);m.rpc.mockResolvedValue(true);m.session.mockResolvedValue(null);expect((await POST(request({id:extra.manager_id}))).status).toBe(401);expect(m.remove).not.toHaveBeenCalled();});
