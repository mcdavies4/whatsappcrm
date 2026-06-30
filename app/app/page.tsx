import { redirect } from 'next/navigation';
import { currentRep } from '@/lib/session';
import Recorder from './Recorder';

export const dynamic = 'force-dynamic';

export default async function AppPage() {
  const rep = await currentRep();
  if (!rep) redirect('/signin');
  return <Recorder repName={rep.name ?? 'there'} />;
}
