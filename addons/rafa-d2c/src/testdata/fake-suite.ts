/**
 * A stand-in for a project's visual suite, for the `run` tests. It reads
 * `fake-suite.json` in its working folder (the package folder): the PNGs
 * to write into the snapshot folder, the snapshot counts of the report,
 * whether to write the report at all, and the exit code. It records the
 * words it was given in `fake-suite-argv.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface FakeSpec {
  shots: Record<string, string>;
  counts: Record<string, number>;
  writeReport: boolean;
  exitCode: number;
}

const spec = JSON.parse(await Bun.file('fake-suite.json').text()) as FakeSpec;
writeFileSync('fake-suite-argv.json', JSON.stringify(process.argv.slice(2)));
const snapshots = join('visual', '__image_snapshots__');
mkdirSync(snapshots, { recursive: true });
for (const [name, text] of Object.entries(spec.shots)) writeFileSync(join(snapshots, name), text);
if (spec.writeReport) {
  const snapshot = { matched: 0, added: 0, updated: 0, unmatched: 0, total: 0, ...spec.counts };
  writeFileSync('visual-report.json', JSON.stringify({ snapshot, testResults: [] }));
}
process.exit(spec.exitCode);
