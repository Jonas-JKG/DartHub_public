import { expect,it } from 'vitest';
import { boardImageMessage,boardImageTopic,trustedBoardImageUrl } from '../src/domain/board-image';
it('verwendet den offiziellen entzerrten Bildkanal und trennt Boards und Kameras',()=>{
 const topic=boardImageTopic('mine',1);expect(topic).toBe('mine.live?cam=1&warp=true');
 const raw={channel:'autodarts.boards.images',topic,data:{url:'/image/example.jpg?ticket=frame-only'}};
 expect(boardImageMessage(raw,'mine',1)).toBe('https://boards.ws.autodarts.com/image/example.jpg?ticket=frame-only');
 expect(boardImageMessage(raw,'other',1)).toBeNull();expect(boardImageMessage(raw,'mine',0)).toBeNull();
 expect(boardImageMessage({...raw,channel:'autodarts.boards'},'mine',1)).toBeNull();
});
it('Bildlinks können keine fremden Server, lokale Dienste oder Zugangsdaten ansteuern',()=>{
 for(const u of ['http://boards.ws.autodarts.com/a','https://boards.ws.autodarts.com.evil.test/a','//evil.test/a','http://localhost/a','https://user:pass@boards.ws.autodarts.com/a','https://boards.ws.autodarts.com:8443/a','data:image/jpeg;base64,AAA','javascript:alert(1)'])expect(trustedBoardImageUrl(u)).toBeNull();
});
