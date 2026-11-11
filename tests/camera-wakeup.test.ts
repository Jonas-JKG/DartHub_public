import {it,expect,vi,afterEach} from 'vitest';
const m=vi.hoisted(()=>({channel:vi.fn(),send:vi.fn(),remove:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({db:()=>({channel:m.channel,removeChannel:m.remove})}));
import {cameraWakeTopic,wakeCamera} from '../src/server/camera-wakeup';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('uses rotating opaque capability topics and broadcasts only an empty wake-up, never camera data',async()=>{vi.stubEnv('RATE_LIMIT_HMAC_KEY','a'.repeat(64));const t=cameraWakeTopic('one',240001);expect(t).not.toContain('one');expect(t).not.toBe(cameraWakeTopic('two',240001));expect(t).not.toBe(cameraWakeTopic('one',360001));m.channel.mockReturnValue({httpSend:m.send});m.send.mockResolvedValue({success:true});await wakeCamera('one');expect(m.send.mock.calls).toHaveLength(2);for(const c of m.send.mock.calls)expect(c.slice(0,2)).toEqual(['changed',{}]);expect(m.remove).toHaveBeenCalledTimes(2);});
