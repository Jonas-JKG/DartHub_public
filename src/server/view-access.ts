import {NextRequest} from 'next/server';
import {repository} from './repositories/supabase';
import type {Session} from './repositories/interface';
export async function viewTournament(_r:NextRequest,id:string,active:Session|null){return {tournament:await repository.get(id,active),session:active};}
