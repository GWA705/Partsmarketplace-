import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.kind === 'DEALER' ? '/catalogue' : '/staff');

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Georgian Water &amp; Air</h1>
          <p className="text-sm text-muted mt-1">Parts catalogue &amp; ordering</p>
        </div>
        <div className="card p-6">
          <LoginForm />
        </div>
        <p className="text-xs text-muted text-center mt-6">
          Trouble signing in? Call the parts desk and we will sort it out.
        </p>
      </div>
    </main>
  );
}
