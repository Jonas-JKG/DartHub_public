import { createClient } from '@supabase/supabase-js';
if (!process.env.SUPABASE_SECRET_KEY) { console.error('Bitte zuerst den neuen Secret Key in .env.local eintragen.'); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const tables = await db.from('public_tournament_snapshots').select('id').limit(0);
if (tables.error || tables.status >= 400) {
  if (tables.error?.code === 'PGRST205') console.error('Das Datenbankschema ist noch nicht eingerichtet. Bitte supabase/migrations/003_setup_complete.sql vollständig im Supabase SQL Editor ausführen.');
  else console.error('Datenbankzugriff nicht bereit:', tables.error?.message ?? `HTTP ${tables.status}`);
  process.exit(1);
}
const { data, error } = await db.rpc('installation_health');
if (error) { console.error('Verbindung/Migration nicht bereit:', error.message); process.exit(1); }
console.log('Supabase-Verbindung und Migration bereit:', data);
