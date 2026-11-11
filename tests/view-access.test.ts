import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),get:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:mock}));
import {viewTournament} from '../src/server/view-access';
beforeEach(()=>vi.clearAllMocks());
it('alte Zuschauer-Cookies geben auf Konto-Seiten keinen Zugriff mehr',async()=>{mock.get.mockResolvedValue(null);const r=new NextRequest('https://example.test',{headers:{cookie:'dartbracket_spectator=read-token'}});expect(await viewTournament(r,'room',null)).toEqual({tournament:null,session:null});expect(mock.session).not.toHaveBeenCalled();});
it('Spieler- und Gastcookies werden nicht als Zuschauerfreigabe akzeptiert',async()=>{
 mock.get.mockResolvedValue(null);for(const s of [{role:'editor'},{role:'owner'},{role:'viewer',guest_id:'g'}]){mock.session.mockResolvedValue(s);expect((await viewTournament(new NextRequest('https://example.test',{headers:{cookie:'dartbracket_spectator=fake'}}),'room',null)).session).toBeNull();}expect(mock.get).toHaveBeenCalledTimes(3);
});
