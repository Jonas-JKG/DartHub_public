import {it,expect,vi,afterEach} from 'vitest';
import {downloadBoardFrame} from '../src/server/board-frame';
afterEach(()=>vi.unstubAllGlobals());
it('rejects private destinations before fetching and never follows image redirects',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 for(const address of ['http://localhost/secret','https://boards.ws.autodarts.com.evil.test/image','https://user:pass@boards.ws.autodarts.com/image','data:image/png;base64,anything'])await expect(downloadBoardFrame(address)).rejects.toMatchObject({status:400});expect(fetcher).not.toHaveBeenCalled();
 fetcher.mockResolvedValue(new Response(null,{status:302,headers:{location:'http://localhost/secret'}}));await expect(downloadBoardFrame('https://boards.ws.autodarts.com/image/test')).rejects.toMatchObject({status:502});expect(fetcher).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:'error',cache:'no-store'}));
});
it('rejects oversized streamed bodies and mismatched image signatures',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response(new Uint8Array(1000001),{headers:{'content-type':'image/png'}}))));await expect(downloadBoardFrame('https://boards.ws.autodarts.com/image/test')).rejects.toMatchObject({status:413});
 vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response('<svg onload="alert(1)"/>',{headers:{'content-type':'image/png'}}))));await expect(downloadBoardFrame('https://boards.ws.autodarts.com/image/test')).rejects.toMatchObject({status:502});
});
