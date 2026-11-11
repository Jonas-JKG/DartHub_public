import { describe, expect, it } from 'vitest';
import { randomInt, randomUUID } from 'node:crypto';
import { can, createTournament, decideRanking, knockout, selectLive, shuffle, standings, updateMatch, type Tournament } from '../src/domain/tournament';
import { decrypt, encrypt, hashPassword, hashToken, verifyPassword } from '../src/server/security';

const make = (n=8, mode: Tournament['mode']='knockout', groupSize=4, advancePerGroup=2) => createTournament({ id:randomUUID(),name:'Testturnier',names:Array.from({length:n},(_,i)=>`Spieler ${i+1}`),mode,groupSize,advancePerGroup },randomInt,randomUUID);
const running = (t:Tournament):Tournament => ({...t,status:'running',startedAt:new Date().toISOString()});
function playAll(original:Tournament):Tournament {
  let t=running(original),guard=0;
  while(!t.winner&&guard++<1000){
    const m=t.matches.find(m=>!m.automatic&&m.status!=='finished'&&m.players.every(Boolean));
    if(!m)break;
    const a=t.participants.findIndex(p=>p.id===m.players[0]), b=t.participants.findIndex(p=>p.id===m.players[1]);
    t=updateMatch(t,m.id,{legs:a<b?[3,1]:[1,3],status:'finished',forfeited:null}).tournament;
  }
  return t;
}

describe('K.-o. für alle Teilnehmerzahlen',()=>{
  for(let n=3;n<=20;n++)it(`${n} Teilnehmer: gültiger Baum und genau ${n-1} echte Matches`,()=>{
    const t=make(n),size=2**Math.ceil(Math.log2(n));
    const first=t.matches.filter(m=>m.round===1);
    expect(first.flatMap(m=>m.players).filter(Boolean).sort()).toEqual(t.participants.map(p=>p.id).sort());
    expect(t.matches.filter(m=>m.automatic)).toHaveLength(size-n);
    expect(t.matches).toHaveLength(size-1);
    for(const m of t.matches.filter(m=>m.automatic)){expect(m.legs).toEqual([null,null]);expect(m.winner).toBeTruthy();}
    const done=playAll(t);
    expect(done.winner).toBe(t.participants[0].id);
    expect(done.status).toBe('completed');
    expect(done.matches.filter(m=>!m.automatic&&m.status==='finished')).toHaveLength(n-1);
  });
  it('unbekannter Gegner wird nicht als Freilos behandelt',()=>{
    let t=running(make(4));const m=t.matches.find(m=>m.round===1)!;
    t=updateMatch(t,m.id,{legs:[1,0],status:'finished',forfeited:null}).tournament;
    expect(t.matches.find(m=>m.round===2)?.status).toBe('pending');expect(t.winner).toBeNull();
  });
  it('Fisher–Yates erhält alle Teilnehmer und kann unterschiedliche Auslosungen erzeugen',()=>{
    const values=Array.from({length:20},(_,i)=>i);
    expect(shuffle(values,()=>0).sort((a,b)=>a-b)).toEqual(values);
    expect(shuffle(values,()=>0)).not.toEqual(shuffle(values,max=>max-1));
    expect(values).toEqual(Array.from({length:20},(_,i)=>i));
  });
});

describe('Ergebnisse, Aufgaben und Korrekturen',()=>{
  it('laufender 3:1-Stand schiebt noch keinen Gewinner weiter',()=>{
    const t=running(make(4)),m=t.matches[0];
    const result=updateMatch(t,m.id,{legs:[3,1],status:'running',forfeited:null}).tournament;
    expect(result.matches[0].winner).toBeNull();expect(result.matches.find(m=>m.round===2)?.players).toEqual([null,null]);
  });
  it('beendeter Gleichstand und negative Legs werden abgelehnt',()=>{
    const t=running(make(4)),m=t.matches[0];
    expect(()=>updateMatch(t,m.id,{legs:[2,2],status:'finished',forfeited:null})).toThrow();
    expect(()=>updateMatch(t,m.id,{legs:[-1,2],status:'running',forfeited:null})).toThrow();
  });
  it('Aufgabe gewinnt unabhängig vom Stand und erfindet keine Legs',()=>{
    const t=running(make(4)),m=t.matches[0];
    for(const legs of [[null,null],[4,0]] as [number|null,number|null][]){
      const next=updateMatch(t,m.id,{legs,status:'running',forfeited:m.players[0]}).tournament.matches[0];
      expect(next.winner).toBe(m.players[1]);expect(next.legs).toEqual(legs);expect(next.status).toBe('finished');
    }
  });
  it('Aufgabe eines fremden Spielers wird abgelehnt',()=>{
    const t=running(make(4));expect(()=>updateMatch(t,t.matches[0].id,{legs:[null,null],status:'pending',forfeited:randomUUID()})).toThrow();
  });
  it('geänderter Sieger setzt das erfasste Finale zurück und öffnet das Turnier',()=>{
    const t=playAll(make(4)),m=t.matches[0];
    const result=updateMatch(t,m.id,{legs:m.winner===m.players[0]?[0,3]:[3,0],status:'finished',forfeited:null});
    expect(result.resets).toEqual(['ko-2-0']);expect(result.tournament.winner).toBeNull();expect(result.tournament.status).toBe('running');
    expect(result.tournament.matches.at(-1)?.legs).toEqual([null,null]);
    expect(t.matches.at(-1)?.status).toBe('finished'); // original is immutable
  });
  it('gleicher Sieger behält Folgeergebnisse',()=>{
    const t=playAll(make(8)),m=t.matches[0];
    const result=updateMatch(t,m.id,{legs:m.winner===m.players[0]?[8,2]:[2,8],status:'finished',forfeited:null});
    expect(result.resets).toEqual([]);expect(result.tournament.winner).toBe(t.winner);
  });
  it('archivierte und geplante Turniere sind für Scores geschlossen',()=>{
    const t=make(4);for(const status of ['planned','archived'] as const)expect(()=>updateMatch({...t,status},t.matches[0].id,{legs:[1,0],status:'finished',forfeited:null})).toThrow();
  });
});

describe('Gruppen und Ranglisten',()=>{
  for(const n of [4,5,6,7,8,10,13,16,20])it(`${n} Spieler: ausgeglichene Gruppen, jeder einmal gegen jeden und Qualifikation`,()=>{
    const t=make(n,'groups',4,2),sizes=t.groups.map(g=>g.participants.length);
    expect(Math.max(...sizes)-Math.min(...sizes)).toBeLessThanOrEqual(1);
    for(const g of t.groups){
      const matches=t.matches.filter(m=>m.groupId===g.id);expect(matches).toHaveLength(g.participants.length*(g.participants.length-1)/2);
      expect(new Set(matches.map(m=>[...m.players].sort().join('|'))).size).toBe(matches.length);
    }
    const done=playAll(t);expect(done.winner).toBeTruthy();expect(done.status).toBe('completed');
    for(const g of done.groups){const rows=standings(done,g);expect(rows[0].points).toBe(g.participants.length-1);expect(rows.every(r=>!r.unresolved)).toBe(true);}
  });
  it('ungültige Gruppenparameter werden abgelehnt',()=>{
    expect(()=>make(3,'groups')).toThrow();expect(()=>make(5,'groups',2,2)).toThrow();expect(()=>make(4,'groups',4,1)).toThrow();
  });
  it('zyklischer Dreiergleichstand bleibt unabhängig von Legs offen und wird manuell entschieden',()=>{
    let t=running(make(4,'groups',4,2));const g=t.groups[0];const [a,b,c,d]=g.participants;
    const winnerFor=(x:string,y:string)=>x===d?y:y===d?x:([a,b].includes(x)&&[a,b].includes(y))?a:([b,c].includes(x)&&[b,c].includes(y))?b:c;
    for(const m of [...t.matches]){const winner=winnerFor(m.players[0]!,m.players[1]!);t=updateMatch(t,m.id,{legs:winner===m.players[0]?[9,0]:[0,1],status:'finished',forfeited:null}).tournament;}
    const rows=standings(t,t.groups[0]);expect(rows.filter(r=>r.unresolved).map(r=>r.id).sort()).toEqual([a,b,c].sort());
    expect(t.matches.some(m=>m.phase==='knockout')).toBe(false);
    const decided=decideRanking(t,g.id,[b,c,a]).tournament;
    expect(standings(decided,decided.groups[0]).map(r=>r.id)).toEqual([b,c,a,d]);expect(decided.matches.some(m=>m.phase==='knockout')).toBe(true);
    const sameWinner=decided.matches.find(m=>m.phase==='group')!;
    const onlyLegs=updateMatch(decided,sameWinner.id,{legs:sameWinner.winner===sameWinner.players[0]?[12,3]:[3,12],status:'finished',forfeited:null});
    expect(onlyLegs.resets).toEqual([]);expect(onlyLegs.tournament.groups[0].decisions).toEqual(decided.groups[0].decisions);
    expect(()=>decideRanking(t,g.id,[b,a])).toThrow();
    const changed=t.matches.find(m=>m.players.includes(a)&&m.players.includes(b))!;
    const corrected=updateMatch(decided,changed.id,{legs:[2,2],status:'running',forfeited:null});
    expect(corrected.tournament.groups[0].decisions).toEqual({});expect(corrected.tournament.matches.some(m=>m.phase==='knockout')).toBe(false);
  });
  it('direkter Vergleich entscheidet einen Zweiergleichstand',()=>{
    const t=running(make(4,'groups',4,2));const [a,b,c,d]=t.groups[0].participants;
    // Unfinished other fixtures do not affect the completed direct comparison.
    const ab=t.matches.find(m=>m.players.includes(a)&&m.players.includes(b))!;
    const ac=t.matches.find(m=>m.players.includes(a)&&m.players.includes(c))!;
    const bc=t.matches.find(m=>m.players.includes(b)&&m.players.includes(c))!;
    const ad=t.matches.find(m=>m.players.includes(a)&&m.players.includes(d))!;
    const bd=t.matches.find(m=>m.players.includes(b)&&m.players.includes(d))!;
    // A beats B/D, loses C; B beats C/D. Both 2 points, direct winner A.
    let next=t;
    for(const [m,winner] of [[ab,a],[ac,c],[bc,b],[ad,a],[bd,b]] as const)next=updateMatch(next,m.id,{legs:m.players[0]===winner?[1,0]:[0,1],status:'finished',forfeited:null}).tournament;
    const rows=standings(next,next.groups[0]);expect(rows[0].id).toBe(a);expect(rows[1].id).toBe(b);expect(rows[0].unresolved).toBe(false);
  });
});

describe('Berechtigungsmatrix',()=>{
  const id=randomUUID(),other=randomUUID();
  for(const action of ['score','manage','delete','archive','create','access'] as const){
    it(`Owner darf ${action}`,()=>expect(can('owner',null,id,action)).toBe(true));
    it(`Zuschauer darf kein ${action}`,()=>expect(can('viewer',null,id,action)).toBe(false));
    it(`Editor ${action}: nur Scores im eigenen Turnier`,()=>{expect(can('editor',id,id,action)).toBe(action==='score');expect(can('editor',id,other,action)).toBe(false);});
    it(`Admin ${action}: eigener Verwaltungsbereich`,()=>{expect(can('admin',id,id,action)).toBe(false);expect(can('admin',id,other,action)).toBe(false);});
  }
  it('Editor darf sämtliche spielbaren Matches des eigenen Turniers bearbeiten',()=>{
    const t=running(make(20));for(const m of t.matches.filter(m=>!m.automatic&&m.players.every(Boolean))){expect(can('editor',t.id,t.id,'score')).toBe(true);expect(()=>updateMatch(t,m.id,{legs:[1,0],status:'finished',forfeited:null})).not.toThrow();}
  });
});

describe('Zugänge und Live-Auswahl',()=>{
  it('Hashes prüfen Passwörter und PINs; kein Klartext im Hash',async()=>{
    const hash=await hashPassword('sicheres-test-passwort');expect(hash).not.toContain('sicheres-test-passwort');expect(await verifyPassword('sicheres-test-passwort',hash)).toBe(true);expect(await verifyPassword('falsch',hash)).toBe(false);
    const pin=await hashPassword('000012');expect(await verifyPassword('12',pin)).toBe(false);expect(await verifyPassword('000012',pin)).toBe(true);
  });
  it('Zugangsdaten sind verschlüsselt und Manipulation schlägt fehl',()=>{
    process.env.ACCESS_ENCRYPTION_KEY='a'.repeat(64);const encoded=encrypt('123456');expect(decrypt(encoded)).toBe('123456');expect(encoded).not.toContain('123456');expect(()=>decrypt(encoded.slice(0,-2)+'00')).toThrow();
  });
  it('Tokens werden gehasht',()=>{expect(hashToken('link')).toHaveLength(64);});
  it('neuestes gestartetes laufendes Turnier hat Vorrang vor zuletzt geändertem',()=>{
    const older=running(make(4)),newer=running(make(4));older.startedAt='2026-01-01T12:00:00Z';older.updatedAt='2026-10-09T12:00:00Z';newer.startedAt='2026-01-02T12:00:00Z';
    const archived={...make(4),status:'archived' as const,updatedAt:'2027-01-01T00:00:00Z'};
    expect(selectLive([older,newer,archived])?.id).toBe(newer.id);expect(selectLive([{...older,status:'completed'},archived])?.id).toBe(older.id);expect(selectLive([archived])).toBeUndefined();
  });
});
