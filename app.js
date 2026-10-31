(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var S = Store.settings;
  var DEMO = /[?&]demo=1/.test(location.search);

  var FONTS = ['Open Sans', 'Roboto', 'Lato', 'Montserrat', 'Merriweather', 'Atkinson Hyperlegible'];
  var FILTERS = [['none', 'Ninguno'], ['bw', 'Blanco y negro'], ['warm', 'Cálido'], ['cool', 'Frío'], ['bright', 'Más brillo']];
  var LANG_NAMES = { 'es-CO': 'Colombia', 'es-ES': 'España', 'es-MX': 'México', 'es-US': 'EE. UU.' };

  function fold(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ================= UI helpers ================= */
  var UI = {
    toast: function (msg, ms) {
      var t = $('#toast'); t.textContent = msg; t.hidden = false;
      clearTimeout(UI._tt); UI._tt = setTimeout(function () { t.hidden = true; }, ms || 2400);
    },
    dialog: function (o) {   // {title, message, input, value, ok, danger, cancel} -> Promise(value|true|null)
      return new Promise(function (res) {
        var m = $('#modal'), inp = $('#mInput'), ok = $('#mOk'), cancel = $('#mCancel');
        $('#mTitle').textContent = o.title || ''; $('#mMsg').textContent = o.message || '';
        $('#mMsg').hidden = !o.message;
        inp.hidden = !o.input; inp.value = o.value || ''; inp.placeholder = o.placeholder || '';
        ok.textContent = o.ok || 'Aceptar'; ok.classList.toggle('destructive', !!o.danger);
        cancel.hidden = o.cancel === false;
        m.hidden = false;
        if (o.input) setTimeout(function () { inp.focus(); inp.select(); }, 60);
        function done(v) { m.hidden = true; ok.onclick = cancel.onclick = null; inp.onkeydown = null; res(v); }
        ok.onclick = function () { done(o.input ? inp.value : true); };
        cancel.onclick = function () { done(null); };
        inp.onkeydown = function (e) { if (e.key === 'Enter') ok.onclick(); };
      });
    },
    confirm: function (title, message, okText) { return UI.dialog({ title: title, message: message, ok: okText || 'Aceptar', danger: true }); },
    info: function (title, message) { return UI.dialog({ title: title, message: message, cancel: false, ok: 'Entendido' }); },
    actions: function (title, items) {
      var box = $('#actions'), list = $('#aItems');
      $('#aTitle').textContent = title; list.innerHTML = '';
      function close() { box.hidden = true; }
      items.forEach(function (it) {
        var b = document.createElement('button'); b.textContent = it.label;
        if (it.danger) b.className = 'danger-i';
        b.onclick = function () { close(); it.fn(); };
        list.appendChild(b);
      });
      $('#aCancel').onclick = close;
      box.onclick = function (e) { if (e.target === box) close(); };
      box.hidden = false;
    },
    sheet: function (id) {
      var sh = $(id), bd = $('#backdrop');
      function close() { sh.hidden = true; bd.hidden = true; bd.onclick = null; }
      sh.hidden = false; bd.hidden = false; bd.onclick = close;
      $('[data-close]', sh).onclick = close;
    }
  };

  /* ================= navegación ================= */
  var current = 'lib';
  function show(name) {
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === name); });
    current = name;
  }

  /* ================= biblioteca ================= */
  var listEl = $('#list'), qEl = $('#q');
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return new Date(ts).toLocaleDateString(); }
  }
  function preview(text) { return text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 14).join(' '); }

  function renderList() {
    var q = fold(qEl.value.trim());
    var items = Store.list().filter(function (s) { return !q || fold(s.title + ' ' + s.text).indexOf(q) >= 0; });
    listEl.innerHTML = '';
    var empty = $('#empty');
    empty.hidden = items.length > 0;
    if (!items.length) empty.innerHTML = q ? 'No hay guiones que coincidan con “' + esc(qEl.value.trim()) + '”.' : 'Aún no tienes guiones.<br>Toca “+ Nuevo guion” para crear el primero.';
    items.forEach(function (s) {
      var li = document.createElement('li'); li.className = 'row-item';
      li.innerHTML = '<button class="row-main"><b>' + esc(s.title || 'Sin título') + '</b><small>' + fmtDate(s.updated) +
        '</small><span>' + esc(preview(s.text) || 'Guion vacío') + '</span></button>' +
        '<button class="row-more" aria-label="Opciones"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>';
      var main = $('.row-main', li), pressed = false, timer, sx = 0, sy = 0;
      function menu() { pressed = true; li.classList.remove('press'); if (navigator.vibrate) navigator.vibrate(10); scriptMenu(s); }
      main.addEventListener('touchstart', function (e) {
        pressed = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        li.classList.add('press'); timer = setTimeout(menu, 480);
      }, { passive: true });
      main.addEventListener('touchmove', function (e) {
        if (Math.abs(e.touches[0].clientX - sx) > 8 || Math.abs(e.touches[0].clientY - sy) > 8) { clearTimeout(timer); li.classList.remove('press'); }
      }, { passive: true });
      ['touchend', 'touchcancel'].forEach(function (ev) { main.addEventListener(ev, function () { clearTimeout(timer); li.classList.remove('press'); }); });
      main.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      main.addEventListener('click', function () { if (pressed) { pressed = false; return; } openTele(s.id); });
      $('.row-more', li).addEventListener('click', function () { scriptMenu(s); });
      listEl.appendChild(li);
    });
  }

  function scriptMenu(s) {
    UI.actions(s.title || 'Sin título', [
      { label: 'Abrir en teleprompter', fn: function () { openTele(s.id); } },
      { label: 'Editar', fn: function () { openEditor(s.id, 'lib'); } },
      { label: 'Renombrar', fn: function () { renameScript(s.id); } },
      { label: 'Duplicar', fn: function () { Store.duplicate(s.id); renderList(); UI.toast('Guion duplicado'); } },
      { label: 'Eliminar', danger: true, fn: function () { deleteScript(s.id); } }
    ]);
  }
  function renameScript(id) {
    var s = Store.get(id);
    UI.dialog({ title: 'Renombrar guion', input: true, value: s.title, placeholder: 'Título', ok: 'Guardar' }).then(function (v) {
      if (v === null) return;
      Store.update(id, { title: v.trim() }, false); renderList();
    });
  }
  function deleteScript(id) {
    var s = Store.get(id);
    UI.confirm('¿Eliminar guion?', '“' + (s.title || 'Sin título') + '” se borrará de este dispositivo. No se puede deshacer.', 'Eliminar').then(function (ok) {
      if (ok) { Store.remove(id); renderList(); UI.toast('Guion eliminado'); }
    });
  }

  qEl.addEventListener('input', renderList);
  $('#btnNew').addEventListener('click', function () { var s = Store.create('', ''); openEditor(s.id, 'lib', true); });

  // Respaldo
  $('#btnBackup').addEventListener('click', function () {
    UI.actions('Respaldo de guiones', [
      { label: 'Exportar todos los guiones', fn: exportAll },
      { label: 'Importar desde un archivo', fn: function () { $('#fileIn').click(); } }
    ]);
  });
  async function exportAll() {
    var json = Store.exportAll();
    var name = 'guiones-teleprompter-' + new Date().toISOString().slice(0, 10) + '.json';
    var file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Guiones' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    downloadBlob(new Blob([json], { type: 'application/json' }), name);
    UI.toast('Respaldo exportado');
  }
  $('#fileIn').addEventListener('change', function (e) {
    var f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then(function (txt) {
      var r = Store.importAll(txt); renderList();
      UI.info('Importación completa', r.added + ' guion(es) nuevo(s) y ' + r.updated + ' actualizado(s).');
    }).catch(function () { UI.info('No se pudo importar', 'El archivo no es un respaldo válido de guiones.'); });
  });
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  /* ================= editor ================= */
  var ed = { id: null, from: 'lib', isNew: false };
  var edTitle = $('#edTitle'), edText = $('#edText');
  function openEditor(id, from, isNew) {
    var s = Store.get(id);
    ed = { id: id, from: from, isNew: !!isNew };
    edTitle.value = s.title; edText.value = s.text; updateCount();
    show('editor');
    if (isNew) setTimeout(function () { edTitle.focus(); }, 80);
  }
  function updateCount() {
    var n = Tracker.scriptWords(edText.value).length;
    $('#edCount').textContent = n + (n === 1 ? ' palabra' : ' palabras') + ' · ~' + Math.max(1, Math.round(n / 150)) + ' min';
  }
  var saveEd = debounce(function () {
    Store.update(ed.id, { title: edTitle.value, text: edText.value, pos: 0 });
    $('#edSaved').textContent = 'Guardado';
  }, 350);
  function onEdInput() { $('#edSaved').textContent = 'Guardando…'; updateCount(); saveEd(); }
  edTitle.addEventListener('input', onEdInput);
  edText.addEventListener('input', onEdInput);
  function closeEditor() {
    var s = Store.get(ed.id);
    if (s) {
      var changed = s.title !== edTitle.value || s.text !== edText.value;
      if (changed) Store.update(ed.id, { title: edTitle.value, text: edText.value, pos: 0 });
      if (!edTitle.value.trim() && !edText.value.trim()) Store.remove(ed.id);   // nuevo guion vacío: se descarta
      else if (!edTitle.value.trim()) Store.update(ed.id, { title: preview(edText.value).split(' ').slice(0, 5).join(' ') }, false);
    }
    if (ed.from === 'tele' && Store.get(ed.id)) { openTele(ed.id, true); } else { renderList(); show('lib'); }
  }
  $('#edBack').addEventListener('click', closeEditor);
  $('#edDone').addEventListener('click', closeEditor);

  /* ================= teleprompter ================= */
  var T = {
    id: null, tokens: [], norms: [], spans: [], tracker: null, pos: 0, lastScrollTop: -1,
    recording: false, rehearsing: false, t0: 0, timerId: 0, lastVideo: null, camInfo: null, camOk: false, wake: null,
    rec: null, speechWanted: false, speechFails: 0, audio: null
  };
  var sbox = $('#sbox'), stext = $('#stext'), frame = $('#frame'), wrap = $('#boxwrap');

  Cam.init($('#cv'), $('#vid'));

  function openTele(id, keepCam) {
    if (T.id !== id) { stopSpeech(); T.rehearsing = false; }
    T.id = id;
    var s = Store.get(id);
    buildScript(s);
    show('tele');
    applyAll();
    if (!keepCam || !T.camOk) bootCamera();
  }

  function buildScript(s) {
    T.tokens = Tracker.tokenize(s.text);
    T.norms = T.tokens.filter(function (t) { return t.index >= 0; }).map(function (t) { return t.norm; });
    stext.textContent = '';
    T.spans = [];
    var frag = document.createDocumentFragment();
    T.tokens.forEach(function (t) {
      if (t.index < 0) { frag.appendChild(document.createTextNode(t.text)); return; }
      var sp = document.createElement('span'); sp.className = 'w'; sp.dataset.i = t.index; sp.textContent = t.text;
      T.spans[t.index] = sp; frag.appendChild(sp);
    });
    stext.appendChild(frag);
    if (!T.norms.length) stext.innerHTML = '<span style="opacity:.6">Este guion está vacío. Toca el ícono de documento para escribirlo.</span>';
    var start = clamp(s.pos || 0, 0, T.norms.length);
    T.tracker = Tracker.create(T.norms, { start: start });
    T.pos = -1; T.lastScrollTop = -1;
    setPos(start, false);
    sbox.scrollTop = 0;
    requestAnimationFrame(function () { scrollToPos(false); });
  }

  var savePos = debounce(function () { if (T.id) Store.setPos(T.id, T.pos); }, 600);

  function setPos(p, scroll) {
    p = clamp(p, 0, T.norms.length);
    var old = T.pos;
    if (old === p) return;
    T.pos = p;
    var a = old < 0 ? 0 : Math.min(old, p) - 1, b = old < 0 ? T.spans.length : Math.max(old, p) + 1;
    for (var i = Math.max(0, a); i < Math.min(T.spans.length, b); i++) {
      var sp = T.spans[i]; if (!sp) continue;
      sp.classList.toggle('read', i < p);
      sp.classList.toggle('cur', i === p);
    }
    if (scroll !== false) scrollToPos(true);
    savePos();
  }

  function scrollToPos(smooth) {
    var sp = T.spans[Math.min(T.pos, T.spans.length - 1)];
    if (!sp) return;
    var lh = parseFloat(getComputedStyle(stext).lineHeight) || 40;
    var target = Math.max(0, sp.offsetTop - lh * 0.15);
    if (Math.abs(target - T.lastScrollTop) < 2) return;
    T.lastScrollTop = target;
    if (smooth) animScroll(target); else { cancelAnimationFrame(T.scrollAnim); sbox.scrollTop = target; }
  }

  function animScroll(target) {   // desplazamiento rápido (~180 ms), más ágil que el 'smooth' nativo
    cancelAnimationFrame(T.scrollAnim);
    var from = sbox.scrollTop, t0 = performance.now(), dur = 180;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur); k = 1 - Math.pow(1 - k, 3);
      sbox.scrollTop = from + (target - from) * k;
      if (k < 1) T.scrollAnim = requestAnimationFrame(step);
    })(t0);
  }

  stext.addEventListener('click', function (e) {
    var sp = e.target.closest && e.target.closest('.w');
    if (!sp) return;
    var i = +sp.dataset.i;
    T.tracker.setPos(i); T.pos = -1; setPos(i, false); T.lastScrollTop = -1; scrollToPos(true);
  });

  /* ---------- aplicar ajustes ---------- */
  function applyText() {
    var t = S.text, root = document.documentElement.style;
    stext.style.fontFamily = '"' + t.font + '", "Open Sans", sans-serif';
    stext.style.fontSize = t.size + 'px';
    stext.style.textAlign = t.align;
    root.setProperty('--mx', t.mirrorH ? -1 : 1);
    root.setProperty('--my', t.mirrorV ? -1 : 1);
    root.setProperty('--boxbg', t.bg);
    T.lastScrollTop = -1; if (T.id) setTimeout(function () { scrollToPos(false); }, 60);
  }
  function applyBox() {
    var b = S.box, vw = window.innerWidth, vh = window.innerHeight;
    var st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
    var minTop = 8 + 46 + 8 + (st || safeTop());
    b.width = clamp(b.width, 0.5, 1);
    b.left = clamp(b.left, 0, 1 - b.width);
    b.height = clamp(b.height, 120, vh - minTop - 120);
    b.top = clamp(b.top, minTop, vh - b.height - 60);
    wrap.style.top = b.top + 'px';
    wrap.style.left = (b.left * vw) + 'px';
    wrap.style.width = (b.width * vw) + 'px';
    frame.style.height = b.height + 'px';
  }
  function safeTop() {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden';
    document.body.appendChild(d); var h = d.offsetHeight; d.remove(); return h;
  }
  function applyCamera() {
    var c = S.camera;
    Cam.params.mirror = c.mirror; Cam.params.zoom = c.zoom; Cam.params.filter = c.filter; Cam.params.blur = c.blur; Cam.params.hdr = c.hdr;
    $('#gridOv').hidden = !c.grid;
  }
  function applyVoiceUI() {
    var v = S.voice;
    $$('#segScroll button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === v.mode); });
    $('#rowVoice').hidden = v.mode !== 'voice'; $('#rowSpeed').hidden = v.mode !== 'auto';
    $('#selLang').value = v.lang; $('#rngSpeed').value = v.speed; $('#speedVal').textContent = v.speed + ' px/s';
  }
  function applyAll() { applyText(); applyBox(); applyCamera(); applyVoiceUI(); }
  window.addEventListener('resize', function () { if (current === 'tele') applyBox(); });

  /* ---------- cámara ---------- */
  async function bootCamera() {
    var ov = $('#startOv');
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && !DEMO) {
      $('#startMsg').textContent = 'Este navegador no permite usar la cámara. Abre la app en Safari con HTTPS.';
      $('#bStart').hidden = true; ov.hidden = false; return;
    }
    if (!S.started && !DEMO) { ov.hidden = false; return; }   // primera vez: pide un toque del usuario
    startCamera();
  }
  async function startCamera() {
    var ov = $('#startOv'), btn = $('#bStart');
    btn.disabled = true;
    try {
      T.camInfo = DEMO ? await Cam.startDemo() : await Cam.start({ facing: S.camera.facing, res: S.camera.res, micId: S.camera.micId });
      T.camOk = true; ov.hidden = true;
      if (!S.started) { S.started = true; Store.saveSettings(); }
      setupAudioMeter(); refreshCamUI(); refreshMics();
    } catch (e) {
      T.camOk = false; ov.hidden = false;
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      $('#startMsg').textContent = denied
        ? 'No hay permiso para usar la cámara o el micrófono. En el iPhone: Ajustes › Safari › Cámara y Micrófono → “Preguntar” o “Permitir”, y vuelve a intentarlo.'
        : (e && e.name === 'NotFoundError' ? 'No se encontró una cámara o micrófono en este dispositivo.' : 'No se pudo iniciar la cámara (' + (e && e.name || 'error') + ').');
      btn.textContent = 'Reintentar';
    }
    btn.disabled = false;
  }
  $('#bStart').addEventListener('click', startCamera);
  $('#bStartBack').addEventListener('click', leaveTele);

  async function restartCamera() {
    if (T.recording) { UI.toast('Detén la grabación para cambiar esto'); return false; }
    await startCamera(); return T.camOk;
  }

  $('#bFlip').addEventListener('click', async function () {
    if (T.recording) return UI.toast('No se puede cambiar de cámara grabando');
    var c = S.camera; c.facing = c.facing === 'user' ? 'environment' : 'user'; c.mirror = c.facing === 'user'; c.zoom = 1;
    Store.saveSettings(); applyCamera(); await restartCamera(); refreshCamUI();
  });

  /* ---------- medidor de micrófono ---------- */
  var bars = $$('#bars i');
  function setupAudioMeter() {
    if (T.audio) { try { T.audio.ctx.close(); } catch (e) {} T.audio = null; }
    var st = Cam.stream; if (!st || !st.getAudioTracks().length) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
      var src = ctx.createMediaStreamSource(new MediaStream(st.getAudioTracks())), an = ctx.createAnalyser();
      an.fftSize = 256; src.connect(an);
      T.audio = { ctx: ctx, an: an, buf: new Uint8Array(an.fftSize) };
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }
  (function meterLoop() {
    requestAnimationFrame(meterLoop);
    if (current !== 'tele') return;
    var lvl = 0;
    if (T.audio) {
      T.audio.an.getByteTimeDomainData(T.audio.buf);
      var sum = 0; for (var i = 0; i < T.audio.buf.length; i++) { var v = (T.audio.buf[i] - 128) / 128; sum += v * v; }
      lvl = Math.min(1, Math.sqrt(sum / T.audio.buf.length) * 5);
    }
    var t = performance.now() / 120;
    bars.forEach(function (b, i) {
      var k = 0.55 + 0.45 * Math.sin(t + i * 1.3);
      b.style.height = (4 + lvl * 18 * k) + 'px';
      b.style.opacity = lvl > 0.04 ? 1 : 0.4;
    });
  })();

  /* ---------- reconocimiento de voz ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function warn(msg, ms) {
    var w = $('#warn'); w.textContent = msg; w.hidden = false;
    clearTimeout(warn._t); warn._t = setTimeout(function () { w.hidden = true; }, ms || 6000);
  }
  function fallbackAuto(msg) {
    stopSpeech(); S.voice.mode = 'auto'; Store.saveSettings(); applyVoiceUI(); warn(msg); syncScrollEngines();
  }
  function startSpeech() {
    if (T.speechWanted) return;
    if (!SR) { fallbackAuto('El reconocimiento de voz no está disponible en este navegador. Se cambió a “Velocidad automática”.'); return; }
    T.speechWanted = true; T.speechFails = 0; launchRecognizer();
  }
  function launchRecognizer() {
    if (!T.speechWanted) return;
    var r = new SR();
    r.lang = S.voice.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    T.tracker.resetSession();
    r.onresult = function (e) {
      T.speechFails = 0;
      var words = [], isFinal = false;
      for (var i = 0; i < e.results.length; i++) {
        words = words.concat(Tracker.speechWords(e.results[i][0].transcript));
        isFinal = e.results[i].isFinal;
      }
      var p = T.tracker.update(words, isFinal);
      if (p > T.pos) setPos(p, true);
    };
    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        fallbackAuto('No hay permiso para el reconocimiento de voz. En Ajustes › Safari (o Ajustes › General › Teclado) activa “Dictado”. Se cambió a “Velocidad automática”.');
      } else if (e.error === 'language-not-supported') {
        fallbackAuto('Este idioma de voz no está disponible. Se cambió a “Velocidad automática”.');
      }
    };
    r.onend = function () {
      if (T.rec !== r) return;
      T.rec = null;
      if (!T.speechWanted) return;
      T.speechFails++;
      if (T.speechFails > 25) { fallbackAuto('El reconocimiento de voz dejó de responder. Se cambió a “Velocidad automática”.'); return; }
      setTimeout(launchRecognizer, 20);   // Safari corta la sesión cada cierto tiempo: reiniciar sin perder la posición
    };
    T.rec = r;
    try { r.start(); } catch (err) { setTimeout(launchRecognizer, 300); }
  }
  function stopSpeech() {
    T.speechWanted = false;
    var r = T.rec; T.rec = null;
    if (r) { r.onend = null; try { r.abort(); } catch (e) {} }
  }

  /* ---------- desplazamiento automático ---------- */
  var autoRaf = 0, autoLast = 0, autoAcc = 0;
  function autoLoop(ts) {
    if (!autoRaf) return;
    autoRaf = requestAnimationFrame(autoLoop);
    var dt = Math.min(0.1, (ts - autoLast) / 1000); autoLast = ts;
    autoAcc += S.voice.speed * dt;
    if (autoAcc >= 1) { var px = Math.floor(autoAcc); autoAcc -= px; sbox.scrollTop += px * (S.text.mirrorV ? 1 : 1); }
    // palabra actual = primera visible
    if (ts - (autoLoop.lastPos || 0) > 400) {
      autoLoop.lastPos = ts;
      var top = sbox.scrollTop + 4, lo = 0, hi = T.spans.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (T.spans[mid].offsetTop < top) lo = mid + 1; else hi = mid; }
      if (lo > T.pos) { T.tracker.setPos(lo); setPos(lo, false); }
    }
  }
  function startAuto() { if (autoRaf) return; autoLast = performance.now(); autoRaf = requestAnimationFrame(autoLoop); }
  function stopAuto() { cancelAnimationFrame(autoRaf); autoRaf = 0; }

  function syncScrollEngines() {
    var active = T.recording || T.rehearsing;
    if (active && S.voice.mode === 'voice') { stopAuto(); startSpeech(); }
    else if (active && S.voice.mode === 'auto') { stopSpeech(); startAuto(); }
    else { stopSpeech(); stopAuto(); }
    var b = $('#bRehearse'); b.textContent = T.rehearsing ? '■ Detener' : '▶ Probar'; b.classList.toggle('glass2', !T.rehearsing);
    b.style.background = T.rehearsing ? 'var(--accent)' : '';
  }

  $('#bRehearse').addEventListener('click', function () {
    if (T.recording) return UI.toast('Ya se está grabando');
    T.rehearsing = !T.rehearsing; syncScrollEngines();
  });
  $$('#segScroll button').forEach(function (b) {
    b.addEventListener('click', function () { S.voice.mode = b.dataset.m; Store.saveSettings(); applyVoiceUI(); syncScrollEngines(); });
  });
  $('#selLang').addEventListener('change', function (e) {
    S.voice.lang = e.target.value; Store.saveSettings();
    if (T.speechWanted) { stopSpeech(); syncScrollEngines(); }
    UI.toast('Voz: Español (' + LANG_NAMES[S.voice.lang] + ')');
  });
  $('#rngSpeed').addEventListener('input', function (e) { S.voice.speed = +e.target.value; $('#speedVal').textContent = S.voice.speed + ' px/s'; Store.saveSettings(); });

  /* ---------- grabación ---------- */
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return [h, m, s % 60].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
  }
  async function lockScreen() {
    try { if (navigator.wakeLock) T.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  function unlockScreen() { try { if (T.wake) T.wake.release(); } catch (e) {} T.wake = null; }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (T.recording || T.rehearsing)) lockScreen(); });

  $('#bRec').addEventListener('click', async function () {
    if (!T.camOk) { $('#startOv').hidden = false; return; }
    if (!T.recording) {
      try { Cam.startRecording(S.camera.res === '4k' ? 45e6 : S.camera.res === '720' ? 8e6 : 18e6); }
      catch (e) { return UI.info('No se puede grabar', 'Este navegador no admite grabación de video (MediaRecorder).'); }
      T.recording = true; T.t0 = Date.now();
      $('#bRec').classList.add('on'); $('#timer').classList.add('live');
      T.timerId = setInterval(function () { $('#timer').textContent = fmtTime(Date.now() - T.t0); }, 250);
      T.rehearsing = false; lockScreen(); syncScrollEngines();
      if (T.audio && T.audio.ctx.state === 'suspended') T.audio.ctx.resume();
    } else {
      await stopRecording();
    }
  });
  async function stopRecording() {
    if (!T.recording) return;
    clearInterval(T.timerId); T.recording = false;
    $('#bRec').classList.remove('on'); $('#timer').classList.remove('live');
    unlockScreen(); syncScrollEngines();
    try {
      var r = await Cam.stopRecording();
      if (T.lastVideo) URL.revokeObjectURL(T.lastVideo.url);
      T.lastVideo = { blob: r.blob, ext: r.ext, type: r.type, url: URL.createObjectURL(r.blob), dur: Date.now() - T.t0 };
      showPreview(false);
    } catch (e) { UI.toast('No se pudo guardar la grabación'); }
    $('#timer').textContent = '00:00:00';
  }

  function showPreview(isReview) {
    var v = T.lastVideo, pv = $('#preview'), el = $('#pvVid');
    el.src = v.url; pv.hidden = false;
    $('#pvDiscard').hidden = isReview; $('#pvClose').hidden = !isReview;
    disarmDiscard();
  }
  function closePreview() { var el = $('#pvVid'); el.pause(); el.removeAttribute('src'); el.load(); $('#preview').hidden = true; }
  $('#pvClose').addEventListener('click', closePreview);
  var discardTimer;
  function disarmDiscard() { clearTimeout(discardTimer); var b = $('#pvDiscard'); b.dataset.armed = ''; b.textContent = 'Descartar'; b.style.background = ''; b.style.color = ''; }
  $('#pvDiscard').addEventListener('click', function () {
    var b = this;
    if (b.dataset.armed !== '1') {   // primer toque: confirmar en el mismo botón (sin ventana aparte)
      b.dataset.armed = '1'; b.textContent = 'Toca otra vez para borrar'; b.style.background = '#ff453a'; b.style.color = '#fff';
      discardTimer = setTimeout(disarmDiscard, 4000);
      return;
    }
    disarmDiscard(); closePreview();
    if (T.lastVideo) URL.revokeObjectURL(T.lastVideo.url);
    T.lastVideo = null; UI.toast('Video descartado');
  });
  $('#pvSave').addEventListener('click', async function () {
    var v = T.lastVideo; if (!v) return;
    var d = new Date(), stamp = d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    var file = new File([v.blob], 'teleprompter-' + stamp + '.' + v.ext, { type: v.type });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    downloadBlob(v.blob, file.name); UI.toast('Video descargado');
  });
  $('#bDown').addEventListener('click', function () {
    if (!T.lastVideo) return UI.toast('Aún no hay ningún video grabado');
    showPreview(true);
  });

  /* ---------- salir / editar ---------- */
  async function leaveTele() {
    if (T.recording) {
      var ok = await UI.confirm('¿Salir y detener la grabación?', 'La grabación en curso se detendrá y se perderá.', 'Salir');
      if (!ok) return;
      clearInterval(T.timerId); T.recording = false;
      try { await Cam.stopRecording(); } catch (e) {}
      $('#bRec').classList.remove('on'); $('#timer').classList.remove('live'); $('#timer').textContent = '00:00:00'; unlockScreen();
    }
    T.rehearsing = false; syncScrollEngines();
    Cam.stop(); T.camOk = false;
    if (T.audio) { try { T.audio.ctx.close(); } catch (e) {} T.audio = null; }
    renderList(); show('lib');
  }
  $('#tClose').addEventListener('click', leaveTele);
  $('#tEdit').addEventListener('click', async function () {
    if (T.recording) return UI.toast('Detén la grabación para editar');
    T.rehearsing = false; syncScrollEngines();
    openEditor(T.id, 'tele');
  });

  /* ---------- mover / redimensionar el recuadro ---------- */
  function drag(handle, onMove) {
    var start = null;
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault(); handle.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, top: S.box.top, left: S.box.left, w: S.box.width, h: S.box.height };
    });
    handle.addEventListener('pointermove', function (e) {
      if (!start) return;
      onMove(e.clientX - start.x, e.clientY - start.y, start); applyBox();
    });
    function end() { if (start) { start = null; Store.saveSettings(); T.lastScrollTop = -1; scrollToPos(false); } }
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  drag($('#hMove'), function (dx, dy, s) { S.box.top = s.top + dy; });                                // solo vertical
  drag($('#hSize'), function (dx, dy, s) { S.box.height = s.h + dy; S.box.width = s.w + dx / window.innerWidth; });

  /* ---------- hojas: cámara ---------- */
  function segSet(sel, val) { $$(sel + ' button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === String(val)); }); }
  function refreshCamUI() {
    var c = S.camera;
    $('#cMirror').checked = c.mirror; $('#cGrid').checked = c.grid; $('#cHdr').checked = c.hdr;
    $('#rowHdr').hidden = !(window.matchMedia && matchMedia('(dynamic-range: high)').matches);
    segSet('#cRes', c.res); segSet('#cBlur', c.blur ? 1 : 0);
    $('#cZoom').value = c.zoom; $('#zoomVal').textContent = c.zoom.toFixed(1) + '×';
    var max = T.camInfo ? T.camInfo.max : 0;
    $('#cRes [data-v="4k"]').disabled = !DEMO && max > 0 && max < 3840;
    $('#cRes [data-v="4k"]').style.opacity = $('#cRes [data-v="4k"]').disabled ? .35 : 1;
    renderFilters();
  }
  function renderFilters() {
    ['#cFilters', '#filterStrip'].forEach(function (sel) {
      var box = $(sel); box.innerHTML = '';
      FILTERS.forEach(function (f) {
        var b = document.createElement('button'); b.className = 'chip' + (S.camera.filter === f[0] ? ' on' : ''); b.textContent = f[1];
        b.onclick = function () { S.camera.filter = f[0]; Store.saveSettings(); applyCamera(); renderFilters(); };
        box.appendChild(b);
      });
    });
  }
  async function refreshMics() {
    var sel = $('#cMic'), row = $('#rowMic');
    try {
      var devs = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'audioinput'; });
      var cur = Cam.stream && Cam.stream.getAudioTracks()[0], curId = cur && cur.getSettings && cur.getSettings().deviceId;
      row.hidden = devs.length < 2;
      sel.innerHTML = '';
      devs.forEach(function (d, i) {
        var o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('Micrófono ' + (i + 1));
        if (d.deviceId === (S.camera.micId || curId)) o.selected = true; sel.appendChild(o);
      });
    } catch (e) { row.hidden = true; }
  }
  $('#bCam').addEventListener('click', function () { refreshCamUI(); refreshMics(); UI.sheet('#shCam'); });
  $('#bFilter').addEventListener('click', function () { var f = $('#filterStrip'); f.hidden = !f.hidden; });
  $('#cMirror').addEventListener('change', function (e) { S.camera.mirror = e.target.checked; Store.saveSettings(); applyCamera(); });
  $('#cGrid').addEventListener('change', function (e) { S.camera.grid = e.target.checked; Store.saveSettings(); applyCamera(); });
  $('#cHdr').addEventListener('change', function (e) { S.camera.hdr = e.target.checked; Store.saveSettings(); applyCamera(); });
  $('#cZoom').addEventListener('input', function (e) { S.camera.zoom = +e.target.value; $('#zoomVal').textContent = S.camera.zoom.toFixed(1) + '×'; Store.saveSettings(); applyCamera(); });
  $$('#cBlur button').forEach(function (b) { b.addEventListener('click', function () { S.camera.blur = b.dataset.v === '1'; Store.saveSettings(); applyCamera(); segSet('#cBlur', b.dataset.v); }); });
  $$('#cRes button').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (b.disabled || S.camera.res === b.dataset.v) return;
      if (T.recording) return UI.toast('Detén la grabación para cambiar la resolución');
      S.camera.res = b.dataset.v; Store.saveSettings(); segSet('#cRes', b.dataset.v);
      await restartCamera(); refreshCamUI();
    });
  });
  $('#cMic').addEventListener('change', async function (e) {
    if (T.recording) { UI.toast('Detén la grabación para cambiar el micrófono'); return; }
    S.camera.micId = e.target.value; Store.saveSettings(); await restartCamera(); refreshMics();
  });

  /* ---------- hojas: texto ---------- */
  function refreshTextUI() {
    var t = S.text, box = $('#tFonts'); box.innerHTML = '';
    FONTS.forEach(function (f) {
      var b = document.createElement('button'); b.className = 'chip' + (t.font === f ? ' on' : ''); b.textContent = f; b.style.fontFamily = '"' + f + '", sans-serif';
      b.onclick = function () { t.font = f; Store.saveSettings(); applyText(); refreshTextUI(); };
      box.appendChild(b);
    });
    $('#tSize').value = t.size; $('#sizeVal').textContent = t.size;
    segSet('#tAlign', t.align);
    $('#tMirH').classList.toggle('on', t.mirrorH); $('#tMirV').classList.toggle('on', t.mirrorV);
    $('#tBg').value = Math.round(t.bg * 100); $('#bgVal').textContent = Math.round(t.bg * 100) + '%';
  }
  $('#bText').addEventListener('click', function () { refreshTextUI(); UI.sheet('#shText'); });
  $('#tSize').addEventListener('input', function (e) { S.text.size = +e.target.value; $('#sizeVal').textContent = S.text.size; Store.saveSettings(); applyText(); });
  $$('#tAlign button').forEach(function (b) { b.addEventListener('click', function () { S.text.align = b.dataset.v; Store.saveSettings(); applyText(); segSet('#tAlign', b.dataset.v); }); });
  $('#tMirH').addEventListener('click', function () { S.text.mirrorH = !S.text.mirrorH; Store.saveSettings(); applyText(); refreshTextUI(); });
  $('#tMirV').addEventListener('click', function () { S.text.mirrorV = !S.text.mirrorV; Store.saveSettings(); applyText(); refreshTextUI(); });
  $('#tBg').addEventListener('input', function (e) { S.text.bg = +e.target.value / 100; $('#bgVal').textContent = e.target.value + '%'; Store.saveSettings(); applyText(); });

  /* ================= arranque ================= */
  renderList();
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js?v=2').catch(function () {}); });
  }
  // Para pruebas automáticas
  window.__tp = { T: T, setPos: setPos, S: S, openTele: openTele };
  if (/[?&]open=1/.test(location.search)) { var f = Store.list()[0]; if (f) openTele(f.id); }
})();


