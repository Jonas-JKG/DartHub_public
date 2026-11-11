import 'server-only';
import {managerAccountsEnabled} from '../tenant';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Tournament } from '../../domain/tournament';
import { hashToken } from '../security';
import type { Credentials, Session, TournamentRepository } from './interface';

export function configured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.OWNER_PASSWORD_HASH && process.env.ACCESS_ENCRYPTION_KEY && process.env.RATE_LIMIT_HMAC_KEY);
}
let client: SupabaseClient | undefined;
export function db(): SupabaseClient {
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Supabase ist noch nicht eingerichtet. Bitte den neuen Secret Key lokal eintragen.');
  return client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export class DatabaseError extends Error { constructor(message: string, public code: string) { super(message); } }
export async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new DatabaseError(error.message, error.code);
  return data;
}
let scopedSchemaKnown=false;
export async function managerSchemaReady():Promise<boolean>{
 if(scopedSchemaKnown)return true;
 const {data,error}=await db().rpc('manager_schema_ready',{});
 if(error){if(['PGRST202','42883'].includes(error.code)){if(managerAccountsEnabled())throw new DatabaseError('Bitte 011_manager_accounts.sql vollständig ausführen.','MANAGER_SCHEMA');return false;}throw new DatabaseError(error.message,error.code);}
 if(data!==true)throw new DatabaseError('Manager-Schema konnte nicht bestätigt werden. Bitte 011_manager_accounts.sql prüfen.','MANAGER_SCHEMA');
 scopedSchemaKnown=true;return true;
}
function managerName(value:unknown){const m=Array.isArray(value)?value[0]:value;return m&&typeof m==='object'&&'name' in m&&typeof m.name==='string'?m.name:undefined;}
export class SupabaseRepository implements TournamentRepository {
  async list(session?: Session | null): Promise<Tournament[]> {
    if(session?.manager_id||session?.player_access_id||await managerSchemaReady()) {
      if(!session)return [];
      if(!['owner','editor'].includes(session.role))return [];
      let q=db().from('tournaments').select('state,manager_id,manager:managers!tournaments_manager_id_fkey(name)').order('updated_at',{ascending:false});
      if(session.role==='editor')q=q.eq('id',session.tournament_id!);
      else if(session.manager_id)q=q.eq('manager_id',session.manager_id);
      else if(session.role!=='owner')return [];
      if(session.role!=='owner')q=q.neq('status','archived');
      const {data,error}=await q;if(error)throw new DatabaseError(error.message,error.code);
      const own=(data??[]).filter(row=>row.state.kind!=='training').map(row=>({...row.state,managerId:row.manager_id,managerName:managerName(row.manager)} as Tournament));
      if(session.role==='owner'){const linked=await this.linked(session);own.push(...linked.filter(t=>!own.some(o=>o.id===t.id)));}return own;
    }
    throw new DatabaseError('Bitte die Kontomigrationen bis 017 ausführen.','MANAGER_SCHEMA');
  }
  async get(id: string, session?: Session | null, options?: {stateOnly?:boolean}): Promise<Tournament | null> {
    if(session?.manager_id||session?.player_access_id||await managerSchemaReady()) {
      if(session&&!['owner','editor'].includes(session.role))return null;
      if(!session||session.role==='editor'&&session.tournament_id!==id||session.role!=='owner'&&!session.manager_id)return null;
      let q=db().from('tournaments').select('state,status,manager_id,manager:managers!tournaments_manager_id_fkey(name)').eq('id',id);
      if(session.manager_id)q=q.eq('manager_id',session.manager_id);
      if(session.training_id)q=q.eq('id',session.training_id);
      if(session.role!=='owner')q=q.neq('status','archived');
      const {data,error}=await q.maybeSingle();if(!data&&!error&&session.role==='owner'&&!options?.stateOnly){const linked=await this.linked(session);return linked.find(t=>t.id===id)??null;}if(error)throw new DatabaseError(error.message,error.code);
      if(data?.state.kind==='training'&&session.role!=='owner'&&session.training_id!==id)return null;
      return data?(options?.stateOnly?data.state:{...data.state,managerId:data.manager_id,managerName:managerName(data.manager)}) as Tournament:null;
    }
    throw new DatabaseError('Bitte die Kontomigrationen bis 017 ausführen.','MANAGER_SCHEMA');
  }
  async linked(session:Session):Promise<Tournament[]>{try{return await rpc('account_linked_tournaments',{p_hash:session.token_hash}) as Tournament[];}catch(e){if(e instanceof DatabaseError&&['PGRST202','42883'].includes(e.code))return [];throw e;}}
  async create(t: Tournament, credentials: Credentials, session: Session) {
    await rpc('create_tournament', { p_state: t, p_credentials: credentials, p_session_hash: session.token_hash });
  }
  async save(t: Tournament, expectedVersion: number, session: Session, action: string, detail: unknown = null) {
    await rpc(session.acting_id?'save_device_tournament':'save_tournament', { ...(session.acting_id?{p_actor:session.acting_id}:{}),p_state: t, p_expected: expectedVersion, p_session_hash: session.token_hash, p_action: action, p_detail: detail });
  }
  async remove(id: string, expectedVersion: number, session: Session) {
    await rpc('delete_tournament', { p_id: id, p_expected: expectedVersion, p_session_hash: session.token_hash });
  }
  async session(rawToken: string): Promise<Session | null> {
    return await rpc('read_session', { p_hash: hashToken(rawToken) }) as Session | null;
  }
}
export const repository: TournamentRepository = new SupabaseRepository();
