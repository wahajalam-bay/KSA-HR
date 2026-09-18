import { PNG } from 'pngjs';
import fs from 'node:fs';
const [id, y0s, hs, vp = '1440', th = 'light'] = process.argv.slice(2);
const y0 = Number(y0s), h = Number(hs);
for (const f of ['baseline', 'out']) {
  const src = PNG.sync.read(fs.readFileSync(`tests/visual/${f}/${id}--${vp}--${th}.png`));
  const hh = Math.min(h, src.height - y0);
  const out = new PNG({ width: src.width, height: hh });
  for (let y = 0; y < hh; y++) for (let x = 0; x < src.width; x++) {
    const s = ((y + y0) * src.width + x) * 4, d = (y * src.width + x) * 4;
    out.data[d] = src.data[s]; out.data[d+1] = src.data[s+1]; out.data[d+2] = src.data[s+2]; out.data[d+3] = 255;
  }
  fs.writeFileSync(`tests/visual/out/crop-${f}.png`, PNG.sync.write(out));
  console.log(f, src.width + 'x' + src.height);
}
