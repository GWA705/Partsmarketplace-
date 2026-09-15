import Link from 'next/link';
import type { SessionUser } from '@/lib/session';

/** The page frame: who you are, where you can go, and what is in the cart. */
export default function Shell({
  user,
  cartCount,
  children,
}: {
  user: SessionUser;
  cartCount?: number;
  children: React.ReactNode;
}) {
  const dealer = user.kind === 'DEALER';
  const nav = dealer
    ? [
        { href: '/catalogue', label: 'Catalogue' },
        { href: '/orders', label: 'My orders' },
      ]
    : [
        { href: '/staff', label: 'Catalogue' },
        { href: '/staff/orders', label: 'Orders' },
        ...(user.staffRole === 'ADMIN' ? [{ href: '/admin', label: 'Admin' }] : []),
      ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center gap-6">
          <Link href={dealer ? '/catalogue' : '/staff'} className="font-bold tracking-tight shrink-0">
            GWA Parts
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="px-3 py-1.5 rounded hover:bg-canvas">
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            {dealer ? (
              <Link href="/cart" className="btn">
                Cart
                {cartCount ? (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded text-xs font-bold"
                    style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                  >
                    {cartCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <span className="hidden sm:inline text-muted">
              {user.dealerName ?? user.name}
            </span>
            <form action="/api/logout" method="post">
              <button className="text-muted hover:text-ink underline underline-offset-2">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
