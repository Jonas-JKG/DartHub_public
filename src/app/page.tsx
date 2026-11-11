import App from '../components/App';
import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<{live?:string}>}){const {live}=await searchParams;if(live&&/^[A-Za-z0-9_-]{30,100}$/.test(live))redirect('/watch/'+live);return <App view="home"/>;}
