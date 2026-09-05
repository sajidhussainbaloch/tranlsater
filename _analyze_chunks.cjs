const fs = require('fs');
const path = require('path');
const md = require('minecraft-data')('bedrock_1.26.40');
const names = md.blockStates.map(b => (b.name || '').replace(/^minecraft:/, ''));

const dir = 'D:/tranlsater/chunk_capture';
const files = fs.readdirSync(dir).filter(f => f.startsWith('chunk_') && f.endsWith('.bin'));
console.log('captures:', files.length);

function parse(buf) {
  const subchunks = [];
  let pos = 0;
  while (pos < buf.length) {
    const header = buf[pos];
    if (header === 0x01) {
      if (pos + 2 > buf.length) break;
      subchunks.push({ header, bpb: 0, palette: [buf[pos + 1]] });
      pos += 2;
      continue;
    }
    const bpb = header >> 1;
    if (bpb < 1 || bpb > 6) break;
    const wordBytes = (4096 * bpb) / 8;
    if (pos + 1 + wordBytes + 1 > buf.length) break;
    const count = buf[pos + 1 + wordBytes];
    const entries = count / 2;
    if (!Number.isInteger(entries) || entries < 1) break;
    const palette = [...buf.subarray(pos + 1 + wordBytes + 1, pos + 1 + wordBytes + 1 + entries)];
    subchunks.push({ header, bpb, palette });
    pos = pos + 1 + wordBytes + 1 + entries;
  }
  return subchunks;
}

const idUsage = new Map(); // runtime id -> {name, count}
const subchunkByIndex = new Map(); // index -> Map name -> count of subchunks
const chunksWithMulti = [];
let totalSubchunks = 0;

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  let subchunks;
  try { subchunks = parse(buf); } catch { continue; }
  totalSubchunks += subchunks.length;
  const kinds = new Set();
  subchunks.forEach((s, i) => {
    for (const id of s.palette) {
      idUsage.set(id, (idUsage.get(id) || 0) + 1);
      let m = subchunkByIndex.get(i);
      if (!m) { m = new Map(); subchunkByIndex.set(i, m); }
      m.set(id, (m.get(id) || 0) + 1);
      kinds.add(id);
    }
  });
  if (subchunks.length > 0 && subchunks.some(s => s.bpb > 0)) chunksWithMulti.push({ f, n: subchunks.length, palettes: subchunks.map(s => s.palette.join(',')).join(' | ') });
}

console.log('total subchunks:', totalSubchunks);
console.log('\n--- runtime id usage (id: name x count) ---');
for (const [id, c] of [...idUsage.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(String(id).padStart(4), (names[id] || '?').padEnd(32), 'x', c);
}

console.log('\n--- subchunk index (0 = y -64..-48) → palette ids x subchunk-count ---');
for (const [i, m] of [...subchunkByIndex.entries()].sort((a, b) => a[0] - b[0])) {
  const parts = [];
  for (const [id, c] of m) parts.push(`${id}:${names[id] || '?'}(x${c})`);
  console.log('idx', i, 'y', -64 + i * 16, '..', -64 + i * 16 + 16, '->', parts.join('  '));
}

console.log('\n--- chunks containing non-flat subchunks (first 10) ---');
for (const c of chunksWithMulti.slice(0, 10)) console.log(c.f, 'N=' + c.n, c.palettes.slice(0, 200));
console.log('non-flat chunk count:', chunksWithMulti.length);
