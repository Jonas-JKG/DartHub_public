import App from '../../../components/App';
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <App view="tournament" tournamentId={id} />; }
