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
  // force: reescribir aunque el valor actual parezca válido (al dividir en partes).
  function patch(bytes, seconds, force) {
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), changed = 0, mvTs = 0, mdTs = 0;

    function bad(cur, ts) { return force || cur === 0 || cur > (seconds + 10) * ts; }
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

  /* ---------- división en partes ----------
     El MP4 de MediaRecorder es fragmentado: encabezado (ftyp+moov) y luego fragmentos moof+mdat de ~1 s.
     Cada parte = el mismo encabezado + un grupo de fragmentos que empieza en un cuadro clave, con los tiempos
     (tfdt) movidos para que empiece en 0. No se recomprime nada: la calidad es idéntica al original. */
  function dv(u) { return new DataView(u.buffer, u.byteOffset, u.byteLength); }
  function typeAt(u, o) { return String.fromCharCode(u[o + 4], u[o + 5], u[o + 6], u[o + 7]); }
  async function readBytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }

  function children(u, v, start, end, cb) {
    var o = start;
    while (o + 8 <= end) {
      var size = v.getUint32(o), hdr = 8;
      if (size === 1) { size = u64(v, o + 8); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) return;
      cb(typeAt(u, o), o + hdr, o + size);
      o += size;
    }
  }

  // Cajas de primer nivel, leyendo solo sus cabeceras (el video no se carga en memoria).
  async function topBoxes(blob) {
    var out = [], o = 0;
    while (o + 8 <= blob.size) {
      var h = await readBytes(blob, o, Math.min(blob.size, o + 16)), v = dv(h), size = v.getUint32(0), hdr = 8;
      if (size === 1) { if (h.length < 16) break; size = u64(v, 8); hdr = 16; } else if (size === 0) size = blob.size - o;
      if (size < hdr) break;
      out.push({ type: typeAt(h, 0), o: o, size: size });
      o += size;
    }
    return out;
  }

  function parseInit(u) {
    var v = dv(u), info = { tracks: {}, mvTs: 0 };
    function track(id) { return info.tracks[id] || (info.tracks[id] = {}); }
    children(u, v, 0, u.length, function (t, b, e) {
      if (t !== 'moov') return;
      children(u, v, b, e, function (t2, b2, e2) {
        if (t2 === 'mvhd') info.mvTs = v.getUint32(b2 + (u[b2] === 1 ? 20 : 12));
        else if (t2 === 'trak') {
          var tr = {};
          children(u, v, b2, e2, function (t3, b3, e3) {
            if (t3 === 'tkhd') tr.id = v.getUint32(b3 + (u[b3] === 1 ? 20 : 12));
            else if (t3 === 'mdia') children(u, v, b3, e3, function (t4, b4) {
              if (t4 === 'mdhd') tr.ts = v.getUint32(b4 + (u[b4] === 1 ? 20 : 12));
              else if (t4 === 'hdlr') tr.kind = typeAt(u, b4 + 4);
            });
          });
          if (tr.id) Object.assign(track(tr.id), tr);
        } else if (t2 === 'mvex') children(u, v, b2, e2, function (t3, b3) {
          if (t3 === 'trex') track(v.getUint32(b3 + 4)).defFlags = v.getUint32(b3 + 20);
        });
      });
    });
    return info;
  }

  function parseMoof(u) {
    var v = dv(u), trafs = [];
    children(u, v, 0, u.length, function (t, b, e) {
      if (t !== 'moof') return;
      children(u, v, b, e, function (t2, b2, e2) {
        if (t2 !== 'traf') return;
        var tf = {};
        children(u, v, b2, e2, function (t3, b3) {
          var fl = v.getUint32(b3) & 0xffffff;
          if (t3 === 'tfhd') {
            tf.id = v.getUint32(b3 + 4);
            var p = b3 + 8;
            if (fl & 1) { tf.bdoPos = p; p += 8; }
            if (fl & 2) p += 4;
            if (fl & 8) p += 4;
            if (fl & 0x10) p += 4;
            if (fl & 0x20) tf.defFlags = v.getUint32(p);
          } else if (t3 === 'tfdt') {
            tf.big = u[b3] === 1; tf.tPos = b3 + 4; tf.t = tf.big ? u64(v, b3 + 4) : v.getUint32(b3 + 4);
          } else if (t3 === 'trun' && tf.first === undefined) {
            var n = v.getUint32(b3 + 4), q = b3 + 8;
            if (fl & 1) q += 4;
            if (fl & 4) tf.first = v.getUint32(q);
            else if (n && (fl & 0x400)) tf.first = v.getUint32(q + (fl & 0x100 ? 4 : 0) + (fl & 0x200 ? 4 : 0));
          }
        });
        trafs.push(tf);
      });
    });
    return trafs;
  }

  // blob: MP4 completo; maxBytes: tamaño máximo de cada parte; totalMs: duración total.
  // Devuelve [{blob, seconds}] o null si el archivo no es un MP4 fragmentado.
  async function split(blob, maxBytes, totalMs) {
    var boxes = await topBoxes(blob), first = -1, i;
    for (i = 0; i < boxes.length; i++) if (boxes[i].type === 'moof') { first = i; break; }
    if (first < 0) return null;
    var init = await readBytes(blob, 0, boxes[first].o), info = parseInit(init), vid = null;
    if (!info.mvTs) return null;
    Object.keys(info.tracks).forEach(function (id) { if (info.tracks[id].kind === 'vide') vid = +id; });

    var frags = [];
    for (i = first; i < boxes.length; i++) {
      var bx = boxes[i];
      if (bx.o + bx.size > blob.size) break;                       // final incompleto (grabación interrumpida)
      if (bx.type === 'moof') frags.push({ o: bx.o, moof: bx.size, size: bx.size, rest: [] });
      else if (frags.length && bx.type !== 'sidx' && bx.type !== 'mfra') { var lf = frags[frags.length - 1]; lf.rest.push(bx); lf.size += bx.size; }
    }
    while (frags.length && !frags[frags.length - 1].rest.some(function (b) { return b.type === 'mdat'; })) frags.pop();
    if (!frags.length) return null;

    for (i = 0; i < frags.length; i++) {
      var f = frags[i];
      f.bytes = await readBytes(blob, f.o, f.o + f.moof);
      f.trafs = parseMoof(f.bytes);
      var tv = f.trafs.filter(function (t) { return t.id === vid; })[0], fl;
      if (tv) fl = tv.first !== undefined ? tv.first : tv.defFlags !== undefined ? tv.defFlags : info.tracks[vid].defFlags;
      f.sync = vid === null ? true : !tv ? false : fl === undefined ? true : !((fl >> 16) & 1);
      f.time = null;   // inicio del fragmento en segundos (el más temprano de sus pistas)
      f.trafs.forEach(function (t) {
        var ts = (info.tracks[t.id] || {}).ts;
        if (t.t !== undefined && ts) { var s = t.t / ts; if (f.time === null || s < f.time) f.time = s; }
      });
    }

    var groups = [], cur = null;
    frags.forEach(function (fr) {
      if (!cur || (cur.size + fr.size > maxBytes && fr.sync && cur.frags.length)) { cur = { frags: [], size: init.length }; groups.push(cur); }
      cur.frags.push(fr); cur.size += fr.size;
    });

    var out = [], total = totalMs ? totalMs / 1000 : null;
    for (var g = 0; g < groups.length; g++) {
      var gr = groups[g], base = gr.frags[0].time || 0, pos = init.length, pieces = [];
      var nextT = groups[g + 1] ? groups[g + 1].frags[0].time : total;
      var secs = nextT != null ? Math.max(0.5, nextT - base) : null;
      var head = init.slice(); if (secs) patch(head, secs, true);
      pieces.push(head);
      gr.frags.forEach(function (fr) {
        var m = fr.bytes.slice(), mv = dv(m);
        fr.trafs.forEach(function (t) {
          var ts = (info.tracks[t.id] || {}).ts;
          if (t.tPos !== undefined && ts) {                         // mismo desplazamiento para todas las pistas: audio y video siguen sincronizados
            var nt = Math.max(0, t.t - Math.round(base * ts));
            if (t.big) put64(mv, t.tPos, nt); else mv.setUint32(t.tPos, nt);
          }
          if (t.bdoPos !== undefined) put64(mv, t.bdoPos, u64(mv, t.bdoPos) - (fr.o - pos));
        });
        pieces.push(m);
        fr.rest.forEach(function (b) { pieces.push(blob.slice(b.o, b.o + b.size)); });
        pos += fr.size;
      });
      out.push({ blob: new Blob(pieces, { type: blob.type }), seconds: secs });
    }
    return out;
  }

  return { fix: fix, patch: patch, split: split };
});
