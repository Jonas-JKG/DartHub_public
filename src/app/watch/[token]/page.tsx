import Spectator from '../../../components/Spectator';
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <Spectator token={token}/>;}
