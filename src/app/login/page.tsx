import AccountLogin from '../../components/AccountLogin';
import AdminLogin from '../../components/AdminLogin';
export default function Page(){return <main className="access-screen"><AccountLogin player={<AdminLogin/>}/></main>;}
