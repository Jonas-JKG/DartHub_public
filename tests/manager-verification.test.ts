import {it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({db:mock.db,DatabaseError:class extends Error{},rpc:vi.fn()}));
import {createManagerSession} from '../src/server/manager-access';
it('unbestätigte E-Mail erstellt weder Managerprofil noch Sitzung',async()=>{
 await expect(createManagerSession({id:'forged-user',email:'x@example.test'})).rejects.toThrow('bestätige zuerst');expect(mock.db).not.toHaveBeenCalled();
});

it('verified players get revocable server sessions without a fixed expiration',async()=>{
 vi.stubEnv('ACCESS_ENCRYPTION_KEY','3'.repeat(64));const {encrypt}=await import('../src/server/security');
 const profile={enabled:true,approved:true,public_handle:'test_player',onboarding_completed_at:'2026-11-12',live_secret:encrypt(JSON.stringify({link:'test-link'})),email_verified_at:'2026-11-12',email_verified_address:'player@example.test',email_verification_version:1,email_verification_required:false};
 const insert=vi.fn(async()=>({error:null}));const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:profile,error:null}),single:async()=>({data:profile,error:null}),upsert:async()=>({error:null}),insert};mock.db.mockReturnValue({from:()=>q});
 const session=await createManagerSession({id:'verified-player',email:'player@example.test',email_confirmed_at:'2026-11-12'});
 expect(insert).toHaveBeenCalledWith(expect.objectContaining({manager_id:'verified-player',expires_at:'infinity'}));expect(session.expires.getTime()).toBeGreaterThan(Date.now()+364*86400000);vi.unstubAllEnvs();
});
