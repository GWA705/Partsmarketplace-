import { jwtVerify } from 'jose';
import { prisma } from '@/lib/db';
import { searchParts } from '@/lib/search';
import { dealerPartSelect } from '@/lib/partSelect';

export const dynamic = 'force-dynamic';

/**
 * The booking portal's window into the catalogue.
 *
 * Rendered chrome-less for an iframe on a customer profile or a service job, so
 * a tech looking at a job sees the parts that fit the equipment actually in
 * that home — which is exactly what the portal's CustomerProduct table already
 * knows and this app does not.
 *
 *   /embed/parts?token=<signed>&fits=WHCCF,UV12
 *
 * The token is minted by the portal with the shared link secret and lives five
 * minutes. No session is started: this is a view, not a way in.
 */
export default async function EmbedParts({
  searchParams,
}: {
  searchParams: { token?: string; fits?: string; q?: string };
}) {
  const secret = process.env.PARTS_LINK_SECRET;
  let allowed = false;

  if (secret && secret.length >= 32 && searchParams.token) {
    try {
      await jwtVerify(searchParams.token, new TextEncoder().encode(secret));
      allowed = true;
    } catch {
      allowed = false;
    }
  }

  if (!allowed) {
    return (
      <div className="p-4 text-sm text-muted">
        This view needs a valid link from the portal.
      </div>
    );
  }

  const fits = (searchParams.fits ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const result = await searchParts({
    q: searchParams.q,
    fitsSkus: fits.length ? fits : undefined,
    pageSize: 40,
  });

  const parts = await prisma.part.findMany({
    where: { id: { in: result.ids } },
    select: dealerPartSelect,
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const rows = result.ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <div className="p-3">
      <h1 className="text-sm font-semibold mb-2">
        {fits.length ? `Parts that fit ${fits.join(', ')}` : 'Parts'}
        <span className="font-normal text-muted"> · {result.total}</span>
      </h1>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          {fits.length
            ? 'No parts are linked to this equipment yet.'
            : 'Nothing matched.'}
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 tabular font-semibold w-36">{p.code ?? '—'}</td>
                <td className="py-1.5 pr-3">{p.catalogueName || p.name}</td>
                <td className="py-1.5 text-muted text-xs w-28">{p.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
