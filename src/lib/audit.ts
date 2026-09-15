import 'server-only';
import { prisma } from '@/lib/db';

/**
 * Who changed what. Its own table in this database — the marketplace cannot
 * write into the booking portal's audit log, and should not want to.
 *
 * Never throws: an audit write failing must not take down the action it was
 * recording.
 */
export async function audit(entry: {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        detail: entry.detail ?? null,
      },
    });
  } catch (e) {
    console.error('audit write failed', e);
  }
}
