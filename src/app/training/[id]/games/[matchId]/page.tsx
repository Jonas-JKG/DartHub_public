import GameScreen from '../../../../../components/GameScreen';
export default async function Page({params}:{params:Promise<{id:string;matchId:string}>}){const {id,matchId}=await params;return <GameScreen key={id+':'+matchId} id={id} matchId={matchId} returnTo={'/training/'+id}/>;}
