import '../globals.css';

/**
 * Chrome-less frame for the portal iframe: no nav, no header, nothing that
 * would look wrong sitting inside another app's page.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-transparent">{children}</body>
    </html>
  );
}
