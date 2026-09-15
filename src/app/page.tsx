import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(user.kind === 'DEALER' ? '/catalogue' : '/staff');
}
