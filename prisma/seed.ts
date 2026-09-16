/**
 * Development seed: enough to sign in and place an order.
 * Safe to re-run — everything upserts.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SEED_REGIONS } from '../src/lib/tax';

const prisma = new PrismaClient();

async function main() {
  await prisma.pricingSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const dealer = await prisma.dealer.upsert({
    where: { name: 'Demo Dealer Co.' },
    update: {},
    create: {
      name: 'Demo Dealer Co.',
      code: 'DEMO-01',
      contactEmail: 'orders@demo-dealer.test',
      phone: '705-555-0100',
      shipAttn: 'Parts Desk',
      shipLine1: '12 Bayfield St',
      shipCity: 'Barrie',
      shipProvince: 'ON',
      shipPostal: 'L4M 3A1',
    },
  });

  const hash = await bcrypt.hash('demo-password-1234', 12);

  await prisma.user.upsert({
    where: { email: 'dealer@demo-dealer.test' },
    update: {},
    create: {
      email: 'dealer@demo-dealer.test',
      name: 'Demo Dealer',
      kind: 'DEALER',
      dealerId: dealer.id,
      passwordHash: hash,
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@ghsbarrie.ca' },
    update: { staffRole: 'ADMIN' },
    create: {
      email: 'admin@ghsbarrie.ca',
      name: 'GWA Admin',
      kind: 'STAFF',
      staffRole: 'ADMIN',
      passwordHash: hash,
    },
  });

  await prisma.fulfillmentContact.upsert({
    where: { party: 'HEAD_OFFICE' },
    update: {},
    create: { party: 'HEAD_OFFICE', email: 'parts@ghsbarrie.ca' },
  });

  // Rates as of this build. Upserted so a re-seed never overwrites a
  // correction somebody made in admin — only the untouched fields are filled.
  for (const r of SEED_REGIONS) {
    await prisma.taxRegion.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code,
        label: r.label,
        hstThou: r.hstThou,
        gstThou: r.gstThou,
        provincialThou: r.provincialThou,
        provincialLabel: r.provincialLabel,
        collectProvincial: r.collectProvincial,
        note: r.note ?? null,
      },
    });
  }

  console.log(`seeded: dealer + staff admin (password: demo-password-1234), ${SEED_REGIONS.length} tax regions`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
