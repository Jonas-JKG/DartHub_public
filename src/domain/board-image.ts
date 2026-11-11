// Official Autodarts uses the message broker for warped image URLs.
export function boardImageTopic(boardId:string,cam=0){return boardId+'.live?cam='+cam+'&warp=true';}
export function trustedBoardImageUrl(raw:unknown):string|null {
  if(typeof raw!=='string'||raw.length>4096)return null;
  try{const u=new URL(raw,'https://boards.ws.autodarts.com');return u.protocol==='https:'&&u.hostname==='boards.ws.autodarts.com'&&!u.port&&!u.username&&!u.password&&u.pathname!=='/'?u.href:null;}catch{return null;}
}
export function boardImageMessage(raw:unknown,boardId:string,cam=0):string|null {
  if(!raw||typeof raw!=='object')return null;
  const m=raw as {channel?:unknown;topic?:unknown;data?:{url?:unknown}};
  return m.channel==='autodarts.boards.images'&&m.topic===boardImageTopic(boardId,cam)?trustedBoardImageUrl(m.data?.url):null;
}
