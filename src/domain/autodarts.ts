import { keypadHit, type Hit } from './scoring';
type RecordValue = Record<string, unknown>;
const record=(v:unknown):RecordValue|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:null;
/** Only board snapshots, never another board's or an Autodarts match's scores. */
export function boardSnapshot(message:unknown,boardId:string):unknown[]|null {
  const m=record(message);
  if(!m||m.channel!=='autodarts.boards'||![boardId+'.state',boardId+'.events'].includes(String(m.topic)))return null;
  const d=record(m.data);if(!d)return null;
  if(Array.isArray(d.throws))return d.throws;
  if(d.numThrows===0||d.event==='Takeout finished'||d.event==='Manual reset')return [];
  return null;
}
/** V2 state reports counts only; individual hits arrive on the board events channel. */
export class BoardStream {
  private slots:unknown[]=[];
  accept(message:unknown,boardId:string):unknown[]|null {
    const snapshot=boardSnapshot(message,boardId);
    if(snapshot!==null){this.slots=[...snapshot];return [...this.slots];}
    const m=record(message),d=record(m?.data);
    if(m?.channel!=='autodarts.boards'||m.topic!==boardId+'.events'||!d||d.event!=='Throw detected')return null;
    if(d.boardId!==undefined&&d.boardId!==boardId)return null;
    const n=d.throwNumber;
    if(typeof n!=='number'||!Number.isInteger(n)||n<1||n>3||!record(d.throw))return null;
    // Ignore duplicate/corrected slots: manual corrections in our game take precedence.
    if(n<=this.slots.length)return null;
    while(this.slots.length<n-1)this.slots.push(null);
    this.slots.push(d.throw);
    // A missing earlier event makes the cursor block this visit, rather than guess.
    return [...this.slots];
  }
}
export function autodartsHit(value:unknown):Hit|null {
  const s=record(record(value)?.segment);if(!s)return null;
  const n=s.number,m=s.multiplier;
  if(typeof n!=='number'||typeof m!=='number'||!Number.isInteger(n)||!Number.isInteger(m)||m<0||m>3)return null;
  try {
    const hit=m===0?keypadHit(0,1):keypadHit(n,m as 1|2|3);
    const raw=record(value),coords=record(raw?.coords);
    if(raw?.coords!==undefined){
      if(!coords||typeof coords.x!=='number'||typeof coords.y!=='number'||!Number.isFinite(coords.x)||!Number.isFinite(coords.y)||Math.abs(coords.x)>2||Math.abs(coords.y)>2)return null;
      // Autodarts: outer double radius = 1, positive Y points up. Our SVG Y points down.
      // Preserve the measured point separately: near a wire, detector field and
      // ideal mathematical geometry can differ. Never move it to a field centre.
      hit.position={x:coords.x,y:-coords.y};
    }
    return hit;
  }catch{return null;}
}
/** Require an empty board after each connection. Consume off-turn throws as well,
 * so they can never arrive later on the next player's visit. Manual corrections
 * win: a board slot is imported only once, and never overwrites an occupied slot.
 */
export class BoardCursor {
  private ready=false;
  private count=0;
  private blocked=false;
  accept(snapshot:unknown[],eligible:boolean):{index:number;hit:Hit}[] {
    if(snapshot.length===0){this.ready=true;this.count=0;this.blocked=false;return [];}
    if(!this.ready||snapshot.length>3)return [];
    if(snapshot.length<this.count){this.blocked=true;return [];}
    const start=this.count;this.count=snapshot.length;
    if(!eligible||this.blocked)return [];
    const result:{index:number;hit:Hit}[]=[];
    for(let index=start;index<snapshot.length;index++){
      const hit=autodartsHit(snapshot[index]);if(!hit){this.blocked=true;return [];}
      result.push({index,hit});
    }
    return result;
  }
}

/** Only confirmed completion, never a zero count during hand movement or calibration. */
export function takeoutFinished(message:unknown,boardId:string):boolean {
  const m=record(message),d=record(m?.data);
  return !!m&&m.channel==='autodarts.boards'&&[boardId+'.state',boardId+'.events'].includes(String(m.topic))&&d?.event==='Takeout finished'&&(d.boardId===undefined||d.boardId===boardId);
}

export function boardInterrupted(message:unknown,boardId:string):boolean {
 const m=record(message),d=record(m?.data);
 return !!m&&m.channel==='autodarts.boards'&&[boardId+'.state',boardId+'.events'].includes(String(m.topic))&&['Manual reset','Calibration started','Stopped','Stopping'].includes(String(d?.event))&&(d?.boardId===undefined||d.boardId===boardId);
}

/** Provider slots include off-turn/removed detections. Append new eligible hits
 * without inventing missing darts or overwriting manual/previously filled slots. */
export function autodartsSlot(index:number,currentLength:number):number|null {
 if(!Number.isInteger(index)||index<0||index>2||!Number.isInteger(currentLength)||currentLength<0||currentLength>=3||index<currentLength)return null;
 return currentLength;
}
