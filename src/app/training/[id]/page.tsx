import Training from '../../../components/Training';
export default async function Page({params}:{params:Promise<{id:string}>}){return <Training id={(await params).id}/>;}
