import { defaultRules, type Rules } from './scoring';
export type Role = 'owner' | 'admin' | 'editor' | 'viewer' | 'guest';
export type TournamentStatus = 'planned' | 'running' | 'completed' | 'archived';
export type MatchStatus = 'pending' | 'running' | 'finished';
export type Participant = { id: string; name: string };
export type Source = { kind: 'participant'; id: string } | { kind: 'winner'; id: string } | { kind: 'bye' };
export type Match = {
  id: string; phase: 'group' | 'knockout'; groupId?: string; round: number; position: number;
  sources: [Source, Source]; players: [string | null, string | null, ...(string|null)[]];
  legs: [number | null, number | null]; status: MatchStatus;
  winner: string | null; forfeited: string | null; automatic: boolean;
};
export type Group = { id: string; name: string; participants: string[]; decisions: Record<string, string[]> };
export type Tournament = {
  id: string; setupPhase?:'lobby'|'drawn'; kind?:'training'; trainingMode?:import('./scoring').TrainingMode; practiceSettings?:import('./scoring').PracticeSettings; viewerOnly?:boolean; linkedParticipantIds?:string[]; managerId?: string; managerName?:string; createdByName?:string; name: string; mode: 'knockout' | 'groups'; status: TournamentStatus;
  scoring?: Rules; participants: Participant[]; groups: Group[]; matches: Match[]; advancePerGroup: number;
  groupSize: number; knockoutSeeds: string[]; version: number;
  createdAt: string; updatedAt: string; startedAt: string | null; winner: string | null;
};
/** Existing tournaments without per-phase settings retain their original goal. */
export function rulesForMatch(t:Pick<Tournament,'scoring'>,match:Pick<Match,'phase'>):Rules {
 const rules=t.scoring??defaultRules;
 return {...rules,legsToWin:match.phase==='group'?rules.groupLegsToWin??rules.legsToWin:rules.legsToWin};
}
export type Standing = { id: string; played: number; wins: number; losses: number; wonLegs: number; lostLegs: number; points: number; rank: number; unresolved: boolean };
export type MatchInput = { legs: [number | null, number | null]; status: MatchStatus; forfeited: string | null };
export class DomainError extends Error {}

export function can(role: Role, scope: string | null, tournamentId: string, action: 'score' | 'manage' | 'delete' | 'archive' | 'create' | 'access'): boolean {
  if (role === 'owner') return true;
  if (scope !== tournamentId) return false;
  return role === 'editor' && action === 'score';
}

export function shuffle<T>(values: T[], randomInt: (max: number) => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (j < 0 || j > i || !Number.isInteger(j)) throw new DomainError('Ungültige Zufallsquelle.');
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function emptyMatch(id: string, phase: Match['phase'], round: number, position: number, sources: [Source, Source], groupId?: string): Match {
  return { id, phase, round, position, sources, groupId, players: [null, null], legs: [null, null], status: 'pending', winner: null, forfeited: null, automatic: false };
}

export function knockout(ids: string[]): Match[] {
  if (ids.length < 2) throw new DomainError('Die K.-o.-Phase benötigt mindestens zwei Teilnehmer.');
  const size = 2 ** Math.ceil(Math.log2(ids.length));
  const byeCount = size - ids.length;
  const firstMatches = size / 2;
  // Spread byes across the round; random seed order makes each participant equally likely to receive one.
  const byes = new Set(Array.from({ length: byeCount }, (_, i) => Math.floor(i * firstMatches / byeCount)));
  let cursor = 0;
  const matches: Match[] = [];
  for (let p = 0; p < firstMatches; p++) {
    const a: Source = { kind: 'participant', id: ids[cursor++] };
    const b: Source = byes.has(p) ? { kind: 'bye' } : { kind: 'participant', id: ids[cursor++] };
    matches.push(emptyMatch(`ko-1-${p}`, 'knockout', 1, p, [a, b]));
  }
  for (let r = 2; r <= Math.log2(size); r++) {
    for (let p = 0; p < size / 2 ** r; p++) {
      matches.push(emptyMatch(`ko-${r}-${p}`, 'knockout', r, p, [{ kind: 'winner', id: `ko-${r - 1}-${p * 2}` }, { kind: 'winner', id: `ko-${r - 1}-${p * 2 + 1}` }]));
    }
  }
  propagate(matches);
  return matches;
}

function resetResult(m: Match) {
  m.legs = [null, null]; m.status = 'pending'; m.winner = null; m.forfeited = null; m.automatic = false;
}

function propagate(matches: Match[]): string[] {
  const changed: string[] = [];
  const byId = new Map(matches.map(m => [m.id, m]));
  for (const m of matches.filter(m => m.phase === 'knockout').sort((a, b) => a.round - b.round || a.position - b.position)) {
    const resolved = m.sources.map(s => {
      if (s.kind === 'participant') return { id: s.id, known: true };
      if (s.kind === 'bye') return { id: null, known: true };
      const previous = byId.get(s.id);
      return { id: previous?.winner ?? null, known: previous?.status === 'finished' };
    });
    const players: Match['players'] = [resolved[0].id, resolved[1].id];
    if (m.players[0] !== players[0] || m.players[1] !== players[1]) {
      if (m.status !== 'pending' || m.legs.some(x => x !== null)) changed.push(m.id);
      resetResult(m); m.players = players;
    }
    if (resolved.every(x => x.known) && players.filter(Boolean).length === 1) {
      m.automatic = true; m.status = 'finished'; m.winner = players.find(Boolean)!;
    }
  }
  return changed;
}

export function createTournament(input: { id: string; kind?:'training'; name: string; names: string[]; mode: Tournament['mode']; groupSize: number; advancePerGroup: number; scoring?: Rules }, randomInt: (max: number) => number, makeId: () => string): Tournament {
  const names = input.names.map(x => x.trim());
  if (names.length < (input.kind==='training'?2:3) || (input.kind==='training'&&names.length!==2) || names.length > 20 || names.some(x => !x || x.length > 80)) throw new DomainError('Bitte 3 bis 20 Namen mit höchstens 80 Zeichen eingeben.');
  if (new Set(names.map(x => x.toLocaleLowerCase('de'))).size !== names.length) throw new DomainError('Teilnehmernamen müssen im Turnier eindeutig sein.');
  if (!input.name.trim() || input.name.trim().length > 100) throw new DomainError('Bitte einen Turniernamen mit höchstens 100 Zeichen eingeben.');
  const participants = names.map(name => ({ id: makeId(), name }));
  const shuffled = shuffle(participants.map(p => p.id), randomInt);
  const now = new Date().toISOString();
  const t: Tournament = { ...(input.kind?{kind:input.kind}:{}), id: input.id, name: input.name.trim(), mode: input.mode, scoring: input.scoring??defaultRules, participants, groups: [], matches: [], advancePerGroup: input.advancePerGroup, groupSize: input.groupSize, knockoutSeeds: [], status: 'planned', winner: null, startedAt: null, version: 1, createdAt: now, updatedAt: now };
  if (input.mode === 'knockout') t.matches = knockout(shuffled);
  else {
    if (names.length < 4 || !Number.isInteger(input.groupSize) || input.groupSize < 2 || input.groupSize > 20) throw new DomainError('Gruppenphase: mindestens vier Teilnehmer und Gruppengröße 2–20.');
    const count = Math.ceil(names.length / input.groupSize);
    const minSize = Math.floor(names.length / count);
    if (minSize < 2 || !Number.isInteger(input.advancePerGroup) || input.advancePerGroup < 1 || input.advancePerGroup > minSize || input.advancePerGroup * count < 2) throw new DomainError('Diese Gruppengröße und Anzahl Weiterkommer ergeben keine gültige K.-o.-Phase.');
    t.groups = Array.from({ length: count }, (_, i) => ({ id: `group-${i}`, name: `Gruppe ${String.fromCharCode(65 + i)}`, participants: shuffled.filter((_, j) => j % count === i), decisions: {} }));
    for (const group of t.groups) {
      for (let a = 0; a < group.participants.length; a++) for (let b = a + 1; b < group.participants.length; b++) {
        const m = emptyMatch(`${group.id}-${a}-${b}`, 'group', 0, t.matches.length, [{ kind: 'participant', id: group.participants[a] }, { kind: 'participant', id: group.participants[b] }], group.id);
        m.players = [group.participants[a], group.participants[b]]; t.matches.push(m);
      }
    }
    // Interleave groups by placing rank 1 and rank 2 in opposite halves where possible.
    const order = shuffle(t.groups.map(g => g.id), randomInt);
    t.knockoutSeeds = Array.from({ length: input.advancePerGroup }, (_, rank) => (rank % 2 ? [...order].reverse() : order).map(g => `${g}:${rank + 1}`)).flat();
  }
  return t;
}

export type LobbyInput={id:string;name:string;names:string[];mode:Tournament['mode'];groupSize:number;advancePerGroup:number;scoring?:Rules};
export function createTournamentLobby(input:LobbyInput,makeId:()=>string):Tournament {
 const names=input.names.map(n=>n.trim());
 if(!input.name.trim()||input.name.trim().length>100||names.length>20||names.some(n=>!n||n.length>80)||new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw new DomainError('Bitte Turniername und eindeutige Spielerkonten prüfen.');
 const now=new Date().toISOString();
 return {id:input.id,name:input.name.trim(),setupPhase:'lobby',mode:input.mode,scoring:input.scoring??defaultRules,groupSize:input.groupSize,advancePerGroup:input.advancePerGroup,participants:names.map(name=>({id:makeId(),name})),groups:[],matches:[],knockoutSeeds:[],status:'planned',winner:null,startedAt:null,version:1,createdAt:now,updatedAt:now};
}
export function drawTournamentLobby(old:Tournament,randomInt:(max:number)=>number):Tournament {
 if(old.setupPhase!=='lobby'||old.status!=='planned')throw new DomainError('Dieses Turnier wurde bereits ausgelost.');
 let index=0;const next=createTournament({...old,names:old.participants.map(p=>p.name)},randomInt,()=>old.participants[index++].id);
 return {...next,setupPhase:'drawn',managerId:old.managerId,createdByName:old.createdByName,createdAt:old.createdAt,status:'running',startedAt:new Date().toISOString()};
}

export function standings(t: Tournament, group: Group): Standing[] {
  const matches = t.matches.filter(m => m.groupId === group.id && m.status === 'finished');
  const rows: Standing[] = group.participants.map(id => {
    const played = matches.filter(m => m.players.includes(id));
    const wins = played.filter(m => m.winner === id).length;
    return { id, played: played.length, wins, losses: played.length - wins, points: wins, wonLegs: played.reduce((n, m) => n + (m.legs[m.players[0] === id ? 0 : 1] ?? 0), 0), lostLegs: played.reduce((n, m) => n + (m.legs[m.players[0] === id ? 1 : 0] ?? 0), 0), rank: 0, unresolved: false };
  });
  const ranked: Standing[] = [];
  function rankBucket(bucket: Standing[], allowDecision: boolean): Standing[] {
    if (bucket.length < 2) return bucket;
    const ids = bucket.map(r => r.id);
    const key = [...ids].sort().join('|');
    const mini = matches.filter(m => m.players.every(id => id !== null && ids.includes(id)));
    const expected = ids.length * (ids.length - 1) / 2;
    if (mini.length !== expected) return bucket.map(r => ({ ...r, unresolved: true }));
    const points = new Map(ids.map(id => [id, mini.filter(m => m.winner === id).length]));
    const values = [...new Set(points.values())].sort((a, b) => b - a);
    if (values.length > 1) return values.flatMap(p => rankBucket(bucket.filter(r => points.get(r.id) === p), allowDecision));
    const decision = allowDecision ? group.decisions[key] : undefined;
    if (decision && decision.length === ids.length && ids.every(id => decision.includes(id))) return decision.map(id => bucket.find(r => r.id === id)!);
    return bucket.map(r => ({ ...r, unresolved: true }));
  }
  const values = [...new Set(rows.map(r => r.points))].sort((a, b) => b - a);
  for (const p of values) ranked.push(...rankBucket(rows.filter(r => r.points === p), true));
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

function qualification(t: Tournament): string[] | null {
  if (t.matches.filter(m => m.phase === 'group').some(m => m.status !== 'finished')) return null;
  const bySlot = new Map<string, string>();
  for (const g of t.groups) {
    const rows = standings(t, g);
    // Every qualifier's exact rank must be resolved, including any tie crossing the cutoff.
    if (rows.slice(0, t.advancePerGroup).some(r => r.unresolved)) return null;
    rows.slice(0, t.advancePerGroup).forEach((r, i) => bySlot.set(`${g.id}:${i + 1}`, r.id));
  }
  return t.knockoutSeeds.map(s => bySlot.get(s)!);
}

function synchronizeGroups(t: Tournament): string[] {
  if (t.mode !== 'groups') return [];
  const qualified = qualification(t);
  const old = t.matches.filter(m => m.phase === 'knockout');
  if (!qualified) { t.matches = t.matches.filter(m => m.phase === 'group'); return old.filter(m => !m.automatic && (m.status !== 'pending' || m.legs.some(x => x !== null))).map(m => m.id); }
  if (!old.length) { t.matches.push(...knockout(qualified)); return []; }
  const fresh = knockout(qualified);
  const resets: string[] = [];
  for (const m of fresh) {
    const previous = old.find(o => o.id === m.id);
    if (previous && JSON.stringify(previous.sources) === JSON.stringify(m.sources)) Object.assign(m, structuredClone(previous));
    else if (previous && !previous.automatic && (previous.status !== 'pending' || previous.legs.some(x => x !== null))) resets.push(previous.id);
  }
  resets.push(...propagate(fresh));
  t.matches = [...t.matches.filter(m => m.phase === 'group'), ...fresh];
  return [...new Set(resets)];
}

function updateCompletion(t: Tournament) {
  const final = t.matches.filter(m => m.phase === 'knockout').sort((a, b) => b.round - a.round)[0];
  t.winner = final?.winner ?? null;
  if (t.winner) t.status = 'completed';
  else if (t.status === 'completed') t.status = 'running';
}

export function updateMatch(original: Tournament, matchId: string, input: MatchInput): { tournament: Tournament; resets: string[] } {
  const t = structuredClone(original);
  if (t.status === 'archived' || t.status === 'planned') throw new DomainError('Das Turnier muss laufen, um Ergebnisse zu bearbeiten.');
  const m = t.matches.find(m => m.id === matchId);
  if (!m || m.automatic || m.players.some(p => !p)) throw new DomainError('Dieses Match ist noch nicht spielbar.');
  if (input.legs.some(x => x !== null && (!Number.isInteger(x) || x < 0 || x > 9999))) throw new DomainError('Legs müssen ganze Zahlen zwischen 0 und 9999 sein.');
  if (input.legs.filter(x => x !== null).length === 1) throw new DomainError('Bitte beide Leg-Zahlen eingeben oder beide leer lassen.');
  if (input.forfeited && !m.players.includes(input.forfeited)) throw new DomainError('Der aufgebende Spieler gehört nicht zu diesem Match.');
  if (input.forfeited) { m.status = 'finished'; m.winner = m.players.find(p => p !== input.forfeited)!; }
  else {
    m.status = input.status; m.winner = null;
    if (m.status === 'finished') {
      if (input.legs.some(x => x === null) || input.legs[0] === input.legs[1]) throw new DomainError('Ein beendetes Match benötigt einen eindeutigen Spielstand.');
      m.winner = m.players[input.legs[0]! > input.legs[1]! ? 0 : 1];
    }
  }
  const previous = original.matches.find(x => x.id === matchId)!;
  const rankingChanged = previous.status !== m.status || previous.winner !== m.winner;
  m.legs = input.legs; m.forfeited = input.forfeited;
  if (m.phase === 'group' && rankingChanged) t.groups.forEach(g => { if (g.id === m.groupId) g.decisions = {}; });
  const resets = m.phase === 'group' ? synchronizeGroups(t) : propagate(t.matches);
  updateCompletion(t);
  return { tournament: t, resets };
}

export function decideRanking(original: Tournament, groupId: string, ids: string[]): { tournament: Tournament; resets: string[] } {
  const t = structuredClone(original);
  const g = t.groups.find(g => g.id === groupId);
  if (!g || t.status === 'archived') throw new DomainError('Gruppe nicht verfügbar.');
  const rows = standings(t, g);
  if (ids.length < 2 || new Set(ids).size !== ids.length || !ids.every(id => rows.find(r => r.id === id)?.unresolved)) throw new DomainError('Bitte nur Teilnehmer eines ungeklärten Gleichstands auswählen.');
  const key = [...ids].sort().join('|');
  // Validate that the decision actually resolves exactly one tie bucket.
  g.decisions[key] = ids;
  const next = standings(t, g);
  if (ids.some(id => next.find(r => r.id === id)?.unresolved)) throw new DomainError('Die Reihenfolge muss genau alle Teilnehmer desselben Gleichstands enthalten.');
  const resets = synchronizeGroups(t); updateCompletion(t);
  return { tournament: t, resets };
}

export function selectLive(tournaments: Tournament[]): Tournament | undefined {
  const running = tournaments.filter(t => t.status === 'running').sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || a.id.localeCompare(b.id));
  return running[0] ?? tournaments.filter(t => t.status !== 'archived').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
}
