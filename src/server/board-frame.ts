import {trustedBoardImageUrl} from '../domain/board-image';
export class BoardFrameError extends Error{constructor(message:string,public status:number){super(message);}}
/** Same strict downloader for tournament and DartDeck images; URLs never reach spectators. */
export async function downloadBoardFrame(raw:unknown){
 const url=trustedBoardImageUrl(raw);if(!url)throw new BoardFrameError('Ungültige Bildadresse.',400);
 const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
 if(!response.ok||!mime||!['image/jpeg','image/jpg','image/png','image/webp'].includes(mime))throw new BoardFrameError('Autodarts hat noch kein Scheibenbild geliefert.',502);
 if(Number(response.headers.get('content-length')??0)>1000000)throw new BoardFrameError('Scheibenbild zu groß.',413);
 const reader=response.body?.getReader();if(!reader)throw new BoardFrameError('Scheibenbild fehlt.',502);
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw new BoardFrameError('Scheibenbild zu groß.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!((mime==='image/jpeg'||mime==='image/jpg')&&jpeg||mime==='image/png'&&png||mime==='image/webp'&&webp))throw new BoardFrameError('Unbekanntes Bildformat.',502);
 return 'data:'+(mime==='image/jpg'?'image/jpeg':mime)+';base64,'+bytes.toString('base64');
}
