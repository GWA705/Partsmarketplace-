import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GWA Parts',
  description: 'Parts catalogue and ordering for GWA dealers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased font-sans">{children}</body>
    </html>
  );
}
