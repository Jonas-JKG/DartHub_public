import DartDeck from '../../../components/DartDeck';
export default async function Page({params}:{params:Promise<{id:string}>}){return <DartDeck id={(await params).id}/>;}
