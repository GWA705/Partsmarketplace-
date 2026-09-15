/**
 * Import the merged parts catalogue workbook.
 *
 *   npm run import:catalogue -- data/Full_Merged_Water_Parts_Catalogue_1.xlsx
 *   npm run import:catalogue -- <file> --commit
 *
 * Dry-run by default: it reads, validates and reports, and writes nothing. Pass
 * --commit once the report looks right.
 */
import { importCatalogue } from '../src/lib/importCatalogue';

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: npm run import:catalogue -- <file.xlsx> [--commit]');
    process.exit(1);
  }

  const report = await importCatalogue({ filePath, commit, actorName: 'cli' });

  console.log(`\n  ${report.dryRun ? 'DRY RUN — nothing written' : 'IMPORTED'}  ${report.fileName}`);
  console.log(`  rows read    ${report.rowsRead}`);
  console.log(`  created      ${report.created}`);
  console.log(`  updated      ${report.updated}`);
  console.log(`  skipped      ${report.skipped}`);
  if (report.merged) {
    console.log(`  merged       ${report.merged}  (same part number on more than one row)`);
  }

  if (report.newCategories.length) {
    console.log(`\n  new categories (${report.newCategories.length}):`);
    for (const c of report.newCategories) console.log(`    · ${c}`);
  }
  if (report.newSegments.length) {
    console.log(`\n  new code segments (${report.newSegments.length}) — name these in admin:`);
    console.log(`    ${report.newSegments.join('  ')}`);
  }
  if (report.problems.length) {
    console.log(`\n  problems (${report.problems.length}):`);
    for (const p of report.problems.slice(0, 40)) console.log(`    · ${p}`);
    if (report.problems.length > 40) console.log(`    … and ${report.problems.length - 40} more`);
  }
  console.log('');

  if (report.dryRun) console.log('  Re-run with --commit to write.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../src/lib/db');
    await prisma.$disconnect();
  });
