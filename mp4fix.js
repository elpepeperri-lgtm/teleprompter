/* Corrige la duración escrita en el encabezado de un MP4 grabado con MediaRecorder.
   Safari deja un valor de relleno (miles de horas) porque no conoce la duración al empezar a grabar.
   Solo se reescriben los campos de duración del inicio del archivo; el resto del video no se toca. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mp4Fix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONTAINERS = { moov: 1, trak: 1, mdia: 1, edts: 1, mvex: 1 };
  var HEAD = 4 * 1024 * 1024;   // el moov de un MP4 fragmentado está al principio

  function u64(v, o) { return v.getUint32(o) * 4294967296 + v.getUint32(o + 4); }
  function put64(v, o, n) { v.setUint32(o, Math.floor(n / 4294967296)); v.setUint32(o + 4, n >>> 0); }

  // bytes: Uint8Array con el inicio del archivo; seconds: duración real. Devuelve cuántos campos cambió.
  function patch(bytes, seconds) {
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), changed = 0, mvTs = 0, mdTs = 0;

    function bad(cur, ts) { return cur === 0 || cur > (seconds + 10) * ts; }
    function setDur(o, big, ts, force) {
      var cur = big ? u64(v, o) : v.getUint32(o), want = Math.round(seconds * ts);
      if (!(force || bad(cur, ts))) return;
      if (big) put64(v, o, want); else v.setUint32(o, Math.min(want, 4294967295));
      changed++;
    }

    function walk(start, end) {
      var o = start;
      while (o + 8 <= end) {
        var size = v.getUint32(o), type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]), hdr = 8;
        if (size === 1) { size = u64(v, o + 8); hdr = 16; } else if (size === 0) size = end - o;
        if (size < hdr || o + size > end) return;
        var b = o + hdr, ver = v.getUint8(b), big = ver === 1;
        if (CONTAINERS[type]) walk(b, o + size);
        else if (type === 'mvhd') { mvTs = v.getUint32(b + (big ? 20 : 12)); if (mvTs) setDur(b + (big ? 24 : 16), big, mvTs); }
        else if (type === 'tkhd') { if (mvTs) setDur(b + (big ? 28 : 20), big, mvTs); }
        else if (type === 'mdhd') { mdTs = v.getUint32(b + (big ? 20 : 12)); if (mdTs) setDur(b + (big ? 24 : 16), big, mdTs); }
        else if (type === 'mehd') { if (mvTs) setDur(b + 4, big, mvTs); }
        else if (type === 'elst' && mvTs) {
          var n = v.getUint32(b + 4), step = big ? 20 : 12;
          for (var i = 0; i < n && b + 8 + (i + 1) * step <= o + size; i++) setDur(b + 8 + i * step, big, mvTs);
        }
        o += size;
      }
    }
    walk(0, bytes.length);
    return changed;
  }

  // blob: video/mp4 grabado; ms: duración real en milisegundos. Devuelve el blob corregido (o el mismo si no hace falta).
  async function fix(blob, ms) {
    try {
      if (!blob || !/mp4/.test(blob.type) || !(ms > 500)) return blob;
      var n = Math.min(blob.size, HEAD), head = new Uint8Array(await blob.slice(0, n).arrayBuffer());
      if (!patch(head, ms / 1000)) return blob;
      return new Blob([head, blob.slice(n)], { type: blob.type });
    } catch (e) { return blob; }
  }

  return { fix: fix, patch: patch };
});
