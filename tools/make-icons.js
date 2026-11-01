// Genera los íconos PNG sin dependencias. Uso: node tools/make-icons.js
const fs = require('fs'), zlib = require('zlib'), path = require('path');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x / w, y / h);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Distancia con signo a un rectángulo redondeado (coordenadas 0..1)
function rr(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function pixel(u, v, size) {
  const aa = 1.5 / size;
  let c = mix([22, 22, 30], [6, 6, 10], v);                 // fondo degradado oscuro
  const cov = (d) => Math.max(0, Math.min(1, 0.5 - d / aa));
  // líneas de texto (barras redondeadas): la tercera, resaltada en rojo
  const bars = [[0.2, 0.22, 0.8, 0.30, [235, 235, 245]], [0.2, 0.36, 0.7, 0.44, [235, 235, 245]],
    [0.2, 0.50, 0.8, 0.58, [255, 69, 58]], [0.2, 0.64, 0.62, 0.72, [120, 120, 132]]];
  for (const [x0, y0, x1, y1, col] of bars) c = mix(c, col, cov(rr(u, v, x0, y0, x1, y1, 0.04)));
  // punto de grabación
  const d = Math.hypot(u - 0.5, v - 0.86) - 0.04;
  c = mix(c, [255, 69, 58], cov(d));
  return c;
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(out, name), png(size, size, (u, v) => pixel(u, v, size)));
  console.log('icons/' + name);
}
// Ícono de la app nativa de iPhone (iOS pide uno de 1024×1024)
const ios = path.join(__dirname, '..', 'ios', 'Sources', 'Assets.xcassets', 'AppIcon.appiconset');
fs.mkdirSync(ios, { recursive: true });
fs.writeFileSync(path.join(ios, 'icon-1024.png'), png(1024, 1024, (u, v) => pixel(u, v, 1024)));
console.log('ios/.../icon-1024.png');
