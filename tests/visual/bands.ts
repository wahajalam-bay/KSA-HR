/* ─────────────────────────────────────────────────────────────────────────────
   Where a capture differs, as bands of rows.

   The percentage says how much differs; this says where. Run compare.ts with
   --write first, then point this at one of the diff images: it prints the rows
   that carry changed pixels, collapsed into bands and ranked by how much of
   each band changed, with the horizontal extent so a column can be recognised.

     npx tsx tests/visual/bands.ts tests/visual/diff/settings-approvals--390--dark.png
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import { PNG } from 'pngjs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('  Usage: npx tsx tests/visual/bands.ts <diff.png> [more.png …]');
  process.exit(1);
}

for (const file of files) {
  if (!fs.existsSync(file)) { console.error(`  ${file} — not found`); continue; }
  const p = PNG.sync.read(fs.readFileSync(file));
  const rows: Array<[number, number, number, number]> = [];
  for (let y = 0; y < p.height; y++) {
    let n = 0; let min = p.width; let max = -1;
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      /* compare.ts paints a changed pixel red. */
      if (p.data[i] > 200 && p.data[i + 1] < 120 && p.data[i + 2] < 120) {
        n++; if (x < min) min = x; if (x > max) max = x;
      }
    }
    if (n) rows.push([y, n, min, max]);
  }

  type Band = { from: number; to: number; n: number; a: number; b: number };
  const bands: Band[] = [];
  for (const [y, n, a, b] of rows) {
    const last = bands[bands.length - 1];
    if (last && y - last.to <= 8) {
      last.to = y; last.n += n; last.a = Math.min(last.a, a); last.b = Math.max(last.b, b);
    } else bands.push({ from: y, to: y, n, a, b });
  }

  console.log(`\n  ${file}`);
  console.log(`  ${p.width}×${p.height} · ${rows.length} rows carry a difference · ${bands.length} bands`);
  for (const b of bands.sort((x, y) => y.n - x.n).slice(0, 12)) {
    console.log(`    y ${String(b.from).padStart(5)}–${String(b.to).padEnd(5)} x ${String(b.a).padStart(4)}–${String(b.b).padEnd(4)} ${String(b.n).padStart(7)} px`);
  }
}
