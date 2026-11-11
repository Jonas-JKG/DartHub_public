import type { Role, Tournament } from '../../domain/tournament';
export type Session = { role: Role; guest_id?:string|null; guest_name?:string|null; training_id?:string|null; account_session_hash?:string|null; account_manager_id?:string|null; manager_id?:string|null; player_access_id?:string|null; tournament_id: string | null; token_hash: string; expires_at: string; credential_version: number; participant_id?: string | null; participant_ids?:string[]; authorized_participant_ids?:string[]; acting_id?:string; remembered_participant_ids?:string[]; remembered_tournament_id?:string|null; playing_tournament_id?: string | null };
export type ParticipantAccess = {participant_id:string;code_hash:string;code_secret:string};
export type Credentials = { player_codes?:ParticipantAccess[]; tournament_id: string; admin_hash: string; admin_version: number; editor_link_hash: string; editor_pin_hash: string; editor_code_hash?: string | null; editor_secret: string; editor_enabled: boolean; editor_version: number };
export interface TournamentRepository {
  list(session?: Session | null): Promise<Tournament[]>;
  get(id: string, session?: Session | null, options?: {stateOnly?:boolean}): Promise<Tournament | null>;
  create(tournament: Tournament, credentials: Credentials, session: Session): Promise<void>;
  save(tournament: Tournament, expectedVersion: number, session: Session, action: string, detail?: unknown): Promise<void>;
  remove(id: string, expectedVersion: number, session: Session): Promise<void>;
  session(rawToken: string): Promise<Session | null>;
}
