import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import RepsManager from './RepsManager';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  if (!isAuthed()) redirect('/login');
  return (
    <div className="wrap">
      <header className="masthead">
        <div>
          <h1>Reps</h1>
          <div className="sub">Who can log to this CRM over WhatsApp</div>
        </div>
        <a className="signout" href="/dashboard">← Pipeline</a>
      </header>
      <RepsManager />
    </div>
  );
}
