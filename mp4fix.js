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
  // rebase: los tiempos ya se movieron a 0, así que un inicio positivo en la lista de ediciones (elst) se anula.
  function patch(bytes, seconds, force, rebase) {
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
          for (var i = 0; i < n && b + 8 + (i + 1) * step <= o + size; i++) {
            var e = b + 8 + i * step, mt = big ? v.getInt32(e + 8) * 4294967296 + v.getUint32(e + 12) : v.getInt32(e + 4);
            if (mt === -1) {
              // Edición vacía = espera antes de que empiece el video (se ve congelado). Darle la duración total
              // duplicaba el video, así que se anula.
              if ((big ? u64(v, e) : v.getUint32(e)) !== 0) { if (big) put64(v, e, 0); else v.setUint32(e, 0); changed++; }
              continue;
            }
            setDur(e, big, mvTs);
            // Inicio muy desplazado (> 5 s en cualquier escala): ya se movieron los tiempos a 0. Uno pequeño
            // (el relleno inicial del audio) se respeta para no desincronizar.
            if (rebase && mt > 480000) { if (big) put64(v, e + 8, 0); else v.setInt32(e + 4, 0); changed++; }
          }
        }
        o += size;
      }
    }
    walk(0, bytes.length);
    return changed;
  }

  // blob: video/mp4 grabado; ms: duración real en milisegundos. Devuelve el blob corregido (o el mismo si no hace falta).
  // Si es fragmentado (lo normal en MediaRecorder) también mueve los tiempos para que empiece en 0.
  async function fix(blob, ms) {
    try {
      if (!blob || !/mp4/.test(blob.type) || !(ms > 500)) return blob;
      try { var rm = await remux(blob); if (rm && rm.seconds > 0.3) return rm.blob; } catch (e) {}
      try { var nb = await normalize(blob, ms); if (nb) return nb; } catch (e) {}
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
      cb(typeAt(u, o), o + hdr, o + size, o);
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

  // Encabezado: escalas de tiempo, tipo de pista, valores por defecto (trex) y las cajas que se copian tal cual
  // al reconstruir (tkhd, mdhd, hdlr, vmhd/smhd, dinf, stsd con la configuración del códec).
  function parseInit(u) {
    var v = dv(u), info = { tracks: {}, mvTs: 0, order: [] };
    function track(id) { return info.tracks[id] || (info.tracks[id] = { boxes: {} }); }
    function grab(o, e) { return u.slice(o, e); }
    children(u, v, 0, u.length, function (t, b, e) {
      if (t !== 'moov') return;
      children(u, v, b, e, function (t2, b2, e2, o2) {
        if (t2 === 'mvhd') { info.mvTs = v.getUint32(b2 + (u[b2] === 1 ? 20 : 12)); info.mvhd = grab(o2, e2); }
        else if (t2 === 'trak') {
          var tr = { boxes: {} };
          children(u, v, b2, e2, function (t3, b3, e3, o3) {
            if (t3 === 'tkhd') { tr.id = v.getUint32(b3 + (u[b3] === 1 ? 20 : 12)); tr.boxes.tkhd = grab(o3, e3); }
            else if (t3 === 'edts') children(u, v, b3, e3, function (t4, b4) {
              if (t4 !== 'elst' || tr.elstMt !== undefined) return;
              var bb = u[b4] === 1, n = v.getUint32(b4 + 4), st = bb ? 20 : 12;
              for (var i = 0; i < n; i++) {                 // primer tramo con imagen/sonido (no la espera vacía)
                var o = b4 + 8 + i * st, mt = bb ? v.getInt32(o + 8) * 4294967296 + v.getUint32(o + 12) : v.getInt32(o + 4);
                if (mt >= 0) { tr.elstMt = mt; break; }
              }
            });
            else if (t3 === 'mdia') children(u, v, b3, e3, function (t4, b4, e4, o4) {
              if (t4 === 'mdhd') { tr.ts = v.getUint32(b4 + (u[b4] === 1 ? 20 : 12)); tr.lang = v.getUint16(b4 + (u[b4] === 1 ? 32 : 20)); }
              else if (t4 === 'hdlr') { tr.kind = typeAt(u, b4 + 4); tr.boxes.hdlr = grab(o4, e4); }
              else if (t4 === 'minf') children(u, v, b4, e4, function (t5, b5, e5, o5) {
                if (/^(vmhd|smhd|sthd|nmhd)$/.test(t5)) tr.boxes.mhd = grab(o5, e5);
                else if (t5 === 'dinf') tr.boxes.dinf = grab(o5, e5);
                else if (t5 === 'stbl') children(u, v, b5, e5, function (t6, b6, e6, o6) { if (t6 === 'stsd') tr.boxes.stsd = grab(o6, e6); });
              });
            });
          });
          if (tr.id) { var tk = track(tr.id); Object.assign(tk.boxes, tr.boxes); delete tr.boxes; Object.assign(tk, tr); info.order.push(tr.id); }
        } else if (t2 === 'mvex') children(u, v, b2, e2, function (t3, b3) {
          if (t3 !== 'trex') return;
          var tk = track(v.getUint32(b3 + 4));
          tk.dDur = v.getUint32(b3 + 12); tk.dSize = v.getUint32(b3 + 16); tk.defFlags = v.getUint32(b3 + 20);
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

  // Lee el encabezado y la cabecera (moof) de cada fragmento; el contenido (mdat) no se carga.
  async function analyze(blob) {
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

    // Primer tiempo de cada pista. Safari puede numerar desde que se encendió la cámara (no desde que empezó
    // la grabación); por eso cada pista se mueve para que empiece en 0.
    var trackBase = {};
    for (i = 0; i < frags.length; i++) {
      var f = frags[i];
      f.bytes = await readBytes(blob, f.o, f.o + f.moof);
      f.trafs = parseMoof(f.bytes);
      f.trafs.forEach(function (t) { if (t.t !== undefined && trackBase[t.id] === undefined) trackBase[t.id] = t.t; });
      var tv = f.trafs.filter(function (t) { return t.id === vid; })[0], fl;
      if (tv) fl = tv.first !== undefined ? tv.first : tv.defFlags !== undefined ? tv.defFlags : info.tracks[vid].defFlags;
      f.sync = vid === null ? true : !tv ? false : fl === undefined ? true : !((fl >> 16) & 1);
    }
    frags.forEach(function (fr) {   // inicio relativo del fragmento, en segundos
      fr.time = null;
      fr.trafs.forEach(function (t) {
        var ts = (info.tracks[t.id] || {}).ts;
        if (t.t !== undefined && ts) { var s = (t.t - trackBase[t.id]) / ts; if (fr.time === null || s < fr.time) fr.time = s; }
      });
      if (fr.time === null) fr.time = 0;
    });
    return { init: init, info: info, frags: frags, trackBase: trackBase };
  }

  // Arma un archivo con un grupo de fragmentos que empieza en el segundo 0 y dura `secs`.
  function build(blob, a, frags, secs) {
    var base = frags[0].time, pos = a.init.length, head = a.init.slice(), pieces = [head];
    if (secs) patch(head, secs, true, true);
    frags.forEach(function (fr) {
      var m = fr.bytes.slice(), mv = dv(m);
      fr.trafs.forEach(function (t) {
        var ts = (a.info.tracks[t.id] || {}).ts;
        if (t.tPos !== undefined && ts) {
          var nt = Math.max(0, t.t - a.trackBase[t.id] - Math.round(base * ts));
          if (t.big) put64(mv, t.tPos, nt); else mv.setUint32(t.tPos, nt);
        }
        if (t.bdoPos !== undefined) put64(mv, t.bdoPos, u64(mv, t.bdoPos) - (fr.o - pos));
      });
      pieces.push(m);
      fr.rest.forEach(function (b) { pieces.push(blob.slice(b.o, b.o + b.size)); });
      pos += fr.size;
    });
    return new Blob(pieces, { type: blob.type });
  }

  // Video completo con los tiempos empezando en 0 y la duración real. null si no es un MP4 fragmentado.
  async function normalize(blob, ms) {
    var a = await analyze(blob);
    if (!a) return null;
    return build(blob, a, a.frags, ms > 500 ? ms / 1000 : null);
  }

  // blob: MP4 completo; maxBytes: tamaño máximo de cada parte; totalMs: duración total.
  // Devuelve [{blob, seconds}] o null si el archivo no es un MP4 fragmentado.
  async function split(blob, maxBytes, totalMs) {
    var a = await analyze(blob);
    if (!a) return null;
    var groups = [], cur = null;
    a.frags.forEach(function (fr) {
      if (!cur || (cur.size + fr.size > maxBytes && fr.sync && cur.frags.length)) { cur = { frags: [], size: a.init.length }; groups.push(cur); }
      cur.frags.push(fr); cur.size += fr.size;
    });
    var total = totalMs ? totalMs / 1000 : null;
    return groups.map(function (gr, g) {
      var start = gr.frags[0].time, next = groups[g + 1] ? groups[g + 1].frags[0].time : total;
      var secs = next != null ? Math.max(0.5, next - start) : null;
      return { blob: build(blob, a, gr.frags, secs), seconds: secs };
    });
  }
  /* ---------- reconstrucción a MP4 normal ----------
     Safari entrega un MP4 fragmentado con tiempos poco fiables (inicio desplazado, duraciones de relleno).
     Aquí se lee cada muestra (cuadro de video o paquete de audio) con su tamaño, duración y posición, se
     calculan tiempos limpios desde 0 y se escribe un MP4 normal (tablas de muestras + datos), igual al que
     guarda la app Cámara. Los datos de imagen y sonido no se tocan: la calidad es idéntica. */

  // Muestras de cada traf de un moof, con su posición absoluta en el archivo.
  function readTrafs(u, moofOff, info) {
    var v = dv(u), out = [];
    children(u, v, 0, u.length, function (t, b, e) {
      if (t !== 'moof') return;
      var prevEnd = null;
      children(u, v, b, e, function (t2, b2, e2) {
        if (t2 !== 'traf') return;
        var tf = { truns: [] };
        children(u, v, b2, e2, function (t3, b3) {
          var fl = v.getUint32(b3) & 0xffffff;
          if (t3 === 'tfhd') {
            tf.id = v.getUint32(b3 + 4);
            var p = b3 + 8;
            if (fl & 1) { tf.bdo = u64(v, p); p += 8; }
            if (fl & 2) p += 4;
            if (fl & 8) { tf.dDur = v.getUint32(p); p += 4; }
            if (fl & 0x10) { tf.dSize = v.getUint32(p); p += 4; }
            if (fl & 0x20) tf.dFlags = v.getUint32(p);
            tf.baseIsMoof = !!(fl & 0x20000);
          } else if (t3 === 'tfdt') tf.t = u[b3] === 1 ? u64(v, b3 + 4) : v.getUint32(b3 + 4);
          else if (t3 === 'trun') {
            var ver = u[b3], n = v.getUint32(b3 + 4), q = b3 + 8, tr = { s: [] }, ff;
            if (fl & 1) { tr.off = v.getInt32(q); q += 4; }
            if (fl & 4) { ff = v.getUint32(q); q += 4; }
            for (var i = 0; i < n; i++) {
              var s = {};
              if (fl & 0x100) { s.d = v.getUint32(q); q += 4; }
              if (fl & 0x200) { s.z = v.getUint32(q); q += 4; }
              if (fl & 0x400) { s.f = v.getUint32(q); q += 4; } else if (i === 0 && ff !== undefined) s.f = ff;
              if (fl & 0x800) { s.c = ver === 0 ? v.getUint32(q) : v.getInt32(q); q += 4; }
              tr.s.push(s);
            }
            tf.truns.push(tr);
          }
        });
        var tk = info.tracks[tf.id] || {};
        var base = tf.bdo !== undefined ? tf.bdo : (tf.baseIsMoof || prevEnd === null) ? moofOff : prevEnd, pos = null;
        tf.truns.forEach(function (tr) {
          pos = tr.off !== undefined ? base + tr.off : (pos === null ? base : pos);
          tr.pos = pos;
          tr.s.forEach(function (s) {
            if (s.d === undefined) s.d = tf.dDur !== undefined ? tf.dDur : tk.dDur;
            if (s.z === undefined) s.z = tf.dSize !== undefined ? tf.dSize : tk.dSize;
            if (s.f === undefined) s.f = tf.dFlags !== undefined ? tf.dFlags : tk.defFlags;
            if (s.c === undefined) s.c = 0;
            pos += s.z || 0;
          });
          tr.end = pos;
        });
        if (pos !== null) prevEnd = pos;
        out.push(tf);
      });
    });
    return out;
  }

  // Escritura de cajas
  function wbox(type, parts) {
    var len = 8, i, o = 8;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len), v = dv(out);
    v.setUint32(0, len); for (i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }
  function wfull(type, ver, flags, parts) { var h = new Uint8Array(4); dv(h).setUint32(0, ((ver << 24) | flags) >>> 0); return wbox(type, [h].concat(parts)); }
  function wu32(list) { var a = new Uint8Array(list.length * 4), v = dv(a); for (var i = 0; i < list.length; i++) v.setUint32(i * 4, list[i] >>> 0); return a; }
  function wi32(list) { var a = new Uint8Array(list.length * 4), v = dv(a); for (var i = 0; i < list.length; i++) v.setInt32(i * 4, list[i]); return a; }
  function median(list) { var b = list.filter(function (x) { return x > 0; }).sort(function (x, y) { return x - y; }); return b.length ? b[b.length >> 1] : 0; }
  function runs(list) {   // [valor, valor, …] -> [[cuántos, valor], …]
    var out = [];
    list.forEach(function (x) { var l = out[out.length - 1]; if (l && l[1] === x) l[0]++; else out.push([1, x]); });
    return out;
  }

  // Tiempos limpios de una pista: duraciones de cada muestra (en la escala de la pista) empezando en 0.
  function timeline(T, ts, isVideo) {
    var S = T.samples, n = S.length, med = median(S.map(function (s) { return s.d || 0; }));
    if (!med || med > ts) med = Math.round(ts / (isVideo ? 30 : 46.875));   // sin dato fiable: 30 fps / paquetes AAC de 48 kHz
    var maxDur = Math.max(10 * med, 5 * ts);   // una muestra de más de 5 s es un valor de relleno, no tiempo real
    var base = S[0].t, times = new Array(n), run = 0;
    for (var k = 0; k < n; k++) {
      var s = S[k], est = run;
      if (s.t !== undefined && base !== undefined) {            // el tfdt corrige la deriva si es razonable
        var tt = s.t - base;
        if (tt >= 0 && Math.abs(tt - run) < 5 * ts) est = tt;
      }
      times[k] = est;
      run = est + (s.d > 0 && s.d <= maxDur ? s.d : med);
    }
    var durs = new Array(n);
    for (k = 0; k < n; k++) {
      var d = k + 1 < n ? times[k + 1] - times[k] : S[k].d;
      durs[k] = d > 0 && d <= maxDur ? d : med;
    }
    return durs;
  }

  async function remux(blob) {
    var boxes = await topBoxes(blob), first = -1, i;
    for (i = 0; i < boxes.length; i++) if (boxes[i].type === 'moof') { first = i; break; }
    if (first < 0) return null;
    var init = await readBytes(blob, 0, boxes[first].o), info = parseInit(init);
    if (!info.mvTs || !info.mvhd || !info.order.length) return null;
    var tracks = {};
    info.order.forEach(function (id) { tracks[id] = { id: id, samples: [], chunks: [] }; });

    for (i = first; i < boxes.length; i++) {
      var bx = boxes[i];
      if (bx.type !== 'moof') continue;
      if (bx.o + bx.size > blob.size) break;
      var trafs = readTrafs(await readBytes(blob, bx.o, bx.o + bx.size), bx.o, info), cut = false;
      trafs.forEach(function (tf) {
        var T = tracks[tf.id]; if (!T) return;
        var t = tf.t;
        tf.truns.forEach(function (tr) {
          if (!tr.s.length) return;
          if (tr.end > blob.size || tr.s.some(function (s) { return !s.z; })) { cut = true; return; }   // final incompleto
          T.chunks.push({ pos: tr.pos, size: tr.end - tr.pos, n: tr.s.length });
          tr.s.forEach(function (s, k) { T.samples.push({ z: s.z, d: s.d, f: s.f, c: s.c, t: k === 0 ? t : undefined }); });
          t = undefined;
        });
      });
      if (cut) break;
    }

    var mvTs = info.mvTs, built = [], movieDur = 0, allChunks = [];
    info.order.forEach(function (id) {
      var T = tracks[id], tk = info.tracks[id];
      if (!T.samples.length || !tk.boxes.stsd || !tk.ts) return;
      var isVideo = tk.kind === 'vide', durs = timeline(T, tk.ts, isVideo), total = 0;
      durs.forEach(function (d) { total += d; });
      // Desfase de composición (cuadros B): que la imagen empiece en 0.
      var cts = T.samples.map(function (s) { return s.c || 0; }), minPts = Infinity, acc = 0;
      for (var k = 0; k < Math.min(cts.length, 120); k++) { minPts = Math.min(minPts, acc + cts[k]); acc += durs[k]; }
      if (!isFinite(minPts)) minPts = 0;
      if (minPts < 0) { cts = cts.map(function (c) { return c - minPts; }); minPts = 0; }
      // Relleno inicial del códec (p. ej. 2112 muestras de AAC) que traía el original: se respeta si es pequeño.
      if (!minPts && tk.elstMt > 0 && tk.elstMt < tk.ts) minPts = tk.elstMt;
      var hasCts = cts.some(function (c) { return c !== 0; });
      var syncKnown = T.samples.some(function (s) { return s.f !== undefined; });
      var sync = [];
      if (isVideo && syncKnown) T.samples.forEach(function (s, k) { if (s.f === undefined || !((s.f >> 16) & 1)) sync.push(k + 1); });
      var mvDur = Math.round(total / tk.ts * mvTs);
      if (mvDur > movieDur) movieDur = mvDur;
      T.chunks.forEach(function (c) { allChunks.push(c); });
      built.push({ T: T, tk: tk, durs: durs, cts: cts, hasCts: hasCts, sync: sync, total: total, mvDur: mvDur, minPts: minPts, isVideo: isVideo });
    });
    if (!built.length) return null;

    // Datos en el mismo orden que en el original (audio y video intercalados).
    allChunks.sort(function (a, b) { return a.pos - b.pos; });

    function makeMoov(dataStart) {
      var cum = 0;
      allChunks.forEach(function (c) { c.out = dataStart + cum; cum += c.size; });
      var traks = built.map(function (B) {
        var T = B.T, tk = B.tk, n = T.samples.length;
        var stts = runs(B.durs), stsc = [], co = new Uint8Array(4 + T.chunks.length * 8), cv = dv(co);
        cv.setUint32(0, T.chunks.length);
        T.chunks.forEach(function (c, k) {
          put64(cv, 4 + k * 8, c.out);
          var l = stsc[stsc.length - 1];
          if (!l || l[1] !== c.n) stsc.push([k + 1, c.n]);
        });
        var stbl = [
          tk.boxes.stsd,
          wfull('stts', 0, 0, [wu32([stts.length]), wu32([].concat.apply([], stts))]),
          wfull('stsc', 0, 0, [wu32([stsc.length]), wu32([].concat.apply([], stsc.map(function (r) { return [r[0], r[1], 1]; })))]),
          wfull('stsz', 0, 0, [wu32([0, n]), wu32(T.samples.map(function (s) { return s.z; }))]),
          wfull('co64', 0, 0, [co])
        ];
        if (B.hasCts) { var cr = runs(B.cts); stbl.splice(2, 0, wfull('ctts', 1, 0, [wu32([cr.length]), wi32([].concat.apply([], cr))])); }
        if (B.isVideo && B.sync.length && B.sync.length < n) stbl.splice(2, 0, wfull('stss', 0, 0, [wu32([B.sync.length]), wu32(B.sync)]));
        var dinf = tk.boxes.dinf || wbox('dinf', [wfull('dref', 0, 0, [wu32([1]), wfull('url ', 0, 1, [])])]);
        var minf = wbox('minf', (tk.boxes.mhd ? [tk.boxes.mhd] : []).concat([dinf, wbox('stbl', stbl)]));
        var big = B.total > 0xffffffff, mdhd = big
          ? wfull('mdhd', 1, 0, [new Uint8Array(16), wu32([tk.ts, Math.floor(B.total / 4294967296), B.total >>> 0]), new Uint8Array([tk.lang >> 8 & 255, tk.lang & 255, 0, 0])])
          : wfull('mdhd', 0, 0, [new Uint8Array(8), wu32([tk.ts, B.total]), new Uint8Array([tk.lang >> 8 & 255, tk.lang & 255, 0, 0])]);
        var mdia = wbox('mdia', [mdhd, tk.boxes.hdlr || wfull('hdlr', 0, 0, [wu32([0]), new Uint8Array([118, 105, 100, 101]), new Uint8Array(13)]), minf]);
        var tkhd = tk.boxes.tkhd.slice(), hv = dv(tkhd), tv1 = tkhd[8] === 1;
        tkhd[11] |= 3;                                                            // pista activa y en la película
        if (tv1) put64(hv, 8 + 28, B.mvDur); else hv.setUint32(8 + 20, Math.min(B.mvDur, 0xffffffff));
        var parts = [tkhd];
        if (B.minPts > 0) parts.push(wbox('edts', [wfull('elst', 0, 0, [wu32([1, Math.min(B.mvDur, 0xffffffff), B.minPts, 0x00010000])])]));
        parts.push(mdia);
        return wbox('trak', parts);
      });
      var mvhd = info.mvhd.slice(), mv = dv(mvhd);
      if (mvhd[8] === 1) put64(mv, 8 + 24, movieDur); else mv.setUint32(8 + 16, Math.min(movieDur, 0xffffffff));
      return wbox('moov', [mvhd].concat(traks));
    }

    var ftyp = wbox('ftyp', [new Uint8Array([105, 115, 111, 109]), wu32([512]), new Uint8Array([105, 115, 111, 109, 105, 115, 111, 50, 109, 112, 52, 49])]);
    var moovLen = makeMoov(0).length, dataStart = ftyp.length + moovLen + 16, moov = makeMoov(dataStart);
    var payload = 0; allChunks.forEach(function (c) { payload += c.size; });
    var mdatHdr = new Uint8Array(16), mh = dv(mdatHdr);
    mh.setUint32(0, 1); mdatHdr.set([109, 100, 97, 116], 4); put64(mh, 8, 16 + payload);
    var pieces = [ftyp, moov, mdatHdr];
    allChunks.forEach(function (c) { pieces.push(blob.slice(c.pos, c.pos + c.size)); });
    var tracksInfo = built.map(function (B) {
      var tk = B.tk, w = 0, h = 0, tb = tk.boxes.tkhd, tv = dv(tb), off = tb[8] === 1 ? 8 + 88 : 8 + 76;
      if (B.isVideo && tb.length >= off + 8) { w = tv.getUint32(off) >>> 16; h = tv.getUint32(off + 4) >>> 16; }
      return { kind: B.isVideo ? 'video' : tk.kind === 'soun' ? 'audio' : tk.kind, seconds: B.total / tk.ts, samples: B.T.samples.length, w: w, h: h,
        codec: typeAt(tk.boxes.stsd, 16) };   // tipo de la primera entrada de stsd (hvc1, avc1, mp4a…)
    });
    return { blob: new Blob(pieces, { type: blob.type || 'video/mp4' }), seconds: movieDur / mvTs, tracks: tracksInfo };
  }

  // Resumen técnico del archivo (pistas, escalas, duraciones, lista de ediciones y tiempos de los fragmentos).
  async function describe(blob) {
    var lines = [], init, a = null;
    try { a = await analyze(blob); } catch (e) {}
    if (a) init = a.init; else init = await readBytes(blob, 0, Math.min(blob.size, HEAD));
    var u = init, v = dv(u);
    function dur(b, big, off0, off1) { return big ? u64(v, b + off1) : v.getUint32(b + off0); }
    children(u, v, 0, u.length, function (t, b, e) {
      if (t === 'ftyp') lines.push('ftyp ' + typeAt(u, b - 4));   // marca principal
      if (t !== 'moov') return;
      children(u, v, b, e, function (t2, b2, e2) {
        var big = u[b2] === 1;
        if (t2 === 'mvhd') lines.push('mvhd v' + u[b2] + ' ts=' + v.getUint32(b2 + (big ? 20 : 12)) + ' dur=' + dur(b2, big, 16, 24));
        else if (t2 === 'mvex') children(u, v, b2, e2, function (t3, b3) { if (t3 === 'mehd') lines.push('mehd dur=' + dur(b3, u[b3] === 1, 4, 4)); });
        else if (t2 === 'trak') {
          var parts = [];
          children(u, v, b2, e2, function (t3, b3, e3) {
            var bg = u[b3] === 1;
            if (t3 === 'tkhd') parts.push('id=' + v.getUint32(b3 + (bg ? 20 : 12)) + ' tkhd.dur=' + dur(b3, bg, 20, 28));
            else if (t3 === 'edts') children(u, v, b3, e3, function (t4, b4) {
              if (t4 !== 'elst') return;
              var bb = u[b4] === 1, n = v.getUint32(b4 + 4), st = bb ? 20 : 12, en = [];
              for (var i = 0; i < n && i < 4; i++) {
                var o = b4 + 8 + i * st;
                en.push((bb ? u64(v, o) : v.getUint32(o)) + '@' + (bb ? v.getInt32(o + 8) * 4294967296 + v.getUint32(o + 12) : v.getInt32(o + 4)));
              }
              parts.push('elst[' + en.join(', ') + ']');
            });
            else if (t3 === 'mdia') children(u, v, b3, e3, function (t4, b4) {
              var b5 = u[b4] === 1;
              if (t4 === 'mdhd') parts.push('mdhd ts=' + v.getUint32(b4 + (b5 ? 20 : 12)) + ' dur=' + dur(b4, b5, 16, 24));
              else if (t4 === 'hdlr') parts.push(typeAt(u, b4 + 4));
            });
          });
          lines.push('trak ' + parts.join(' '));
        }
      });
    });
    if (a) {
      var f0 = a.frags[0], fl = a.frags[a.frags.length - 1], syncs = a.frags.filter(function (f) { return f.sync; }).length;
      lines.push('fragmentos=' + a.frags.length + ' clave=' + syncs);
      [f0, fl].forEach(function (f, k) {
        lines.push((k ? 'último' : 'primero') + ': ' + f.trafs.map(function (t) { return 'pista' + t.id + ' tfdt=' + t.t; }).join(' '));
      });
      try {   // duración real de cada pista, calculada desde sus muestras
        var rm = await remux(blob);
        if (rm) lines.push('pistas: ' + rm.tracks.map(function (t) {
          return t.kind + ' ' + t.codec + ' ' + (t.w ? t.w + '×' + t.h + ' ' : '') + t.seconds.toFixed(1) + ' s (' + t.samples + ' muestras)';
        }).join(' · '));
      } catch (e) {}
    } else lines.push('MP4 normal (no fragmentado)');
    lines.push('tamaño=' + Math.round(blob.size / 1048576) + ' MB');
    return lines.join('\n');
  }

  return { fix: fix, patch: patch, split: split, normalize: normalize, remux: remux, describe: describe };
});
