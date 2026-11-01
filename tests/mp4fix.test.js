const assert = require('node:assert/strict');
const M = require('../mp4fix.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Utilidades para armar cajas MP4 mínimas.
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function i32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; }
function box(type, ...parts) { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]); }
function full(type, ver, ...parts) { return box(type, u32(ver << 24), ...parts); }

const mvTs = 1000, mdTs = 48000;
// elst v0: entradas [duración, inicio (media_time), velocidad]
function moov(entries, mvDur) {
  const elst = full('elst', 0, u32(entries.length), ...entries.map(([d, t]) => Buffer.concat([u32(d), i32(t), u32(0x00010000)])));
  return box('moov',
    full('mvhd', 0, u32(0), u32(0), u32(mvTs), u32(mvDur), Buffer.alloc(80)),
    box('trak',
      full('tkhd', 0, u32(0), u32(0), u32(1), u32(0), u32(mvDur), Buffer.alloc(60)),
      box('edts', elst),
      box('mdia', full('mdhd', 0, u32(0), u32(0), u32(mdTs), u32(0xffffffff), u32(0)))));
}
function read(u) {
  const b = Buffer.from(u), at = (t) => b.indexOf(t) + 4;
  const e = at('elst'), n = b.readUInt32BE(e + 4), entries = [];
  for (let i = 0; i < n; i++) entries.push([b.readUInt32BE(e + 8 + i * 12), b.readInt32BE(e + 12 + i * 12)]);
  return { mvhd: b.readUInt32BE(at('mvhd') + 16), tkhd: b.readUInt32BE(at('tkhd') + 20), mdhd: b.readUInt32BE(at('mdhd') + 16), entries };
}

test('la espera vacía del inicio no se alarga (el video no se duplica)', () => {
  const u = new Uint8Array(moov([[0, -1], [0, 0]], 0));   // como Safari: espera vacía + video
  M.patch(u, 180, true, true);
  const r = read(u);
  assert.equal(r.entries[0][0], 0, 'la espera vacía queda en 0');
  assert.equal(r.entries[1][0], 180 * mvTs, 'la parte con video dura 180 s');
  assert.equal(r.mvhd, 180 * mvTs);
  assert.equal(r.mdhd, 180 * mdTs);
});

test('una espera vacía con valor de relleno se anula', () => {
  const u = new Uint8Array(moov([[0xffffffff, -1], [0xffffffff, 0]], 0xffffffff));
  M.patch(u, 95);
  const r = read(u);
  assert.equal(r.entries[0][0], 0);
  assert.equal(r.entries[1][0], 95 * mvTs);
  assert.equal(r.mvhd, 95 * mvTs);
  assert.equal(r.tkhd, 95 * mvTs);
});

test('el relleno inicial del audio (inicio pequeño) se respeta', () => {
  const u = new Uint8Array(moov([[0, 2112]], 0));
  M.patch(u, 60, true, true);
  assert.deepEqual(read(u).entries[0], [60 * mvTs, 2112]);
});

test('un inicio muy desplazado se anula al mover los tiempos a 0', () => {
  const u = new Uint8Array(moov([[0, 180 * mdTs]], 0));
  M.patch(u, 60, true, true);
  assert.deepEqual(read(u).entries[0], [60 * mvTs, 0]);
});

console.log(`\n${passed} pruebas pasaron`);
