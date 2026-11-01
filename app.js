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
    setTimeout(function () { URL.revokeObjectURL(url); }, 300000);   // un video grande tarda en descargarse
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
    engine: 'vosk', vosk: null, real: 0, lastAdv: 0, rate: 2.2, rec: null, speechWanted: false, speechFails: 0, audio: null
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
    T.tracker.setPos(i); T.real = i; T.lastAdv = 0; T.pos = -1; setPos(i, false); T.lastScrollTop = -1; scrollToPos(true);
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
      T.camInfo = DEMO ? await Cam.startDemo() : await Cam.start({ facing: S.camera.facing, res: S.camera.res, fps: S.camera.fps, micId: S.camera.micId });
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
  function applyWords(words, isFinal) {
    var p = T.tracker.update(words, isFinal), now = performance.now();
    if (p > T.real) {
      var dt = (now - T.lastAdv) / 1000;
      if (T.lastAdv && dt < 3) T.rate = 0.6 * T.rate + 0.4 * clamp((p - T.real) / Math.max(dt, 0.3), 0.5, 5);
      T.real = p; T.lastAdv = now;
    }
    if (p > T.pos) setPos(p, true);
  }

  function startSpeech() {
    if (T.speechWanted) return;
    T.speechWanted = true; T.speechFails = 0; T.real = T.pos; T.lastAdv = 0; T.rate = 2.2;
    if (S.voice.engine === 'vosk') { startVosk(); return; }
    startApple();
  }
  function startApple() {
    T.engine = 'apple';
    if (!SR) { fallbackAuto('El reconocimiento de voz no está disponible en este navegador. Se cambió a “Velocidad automática”.'); return; }
    launchRecognizer();
  }

  // Motor local (Vosk): el audio se reconoce dentro del teléfono; los parciales llegan casi al instante.
  async function startVosk() {
    T.engine = 'vosk';
    try {
      if (!VoskEngine.ready) warn('Preparando el motor de voz rápido… la primera vez descarga ~40 MB (solo una vez).', 60000);
      await VoskEngine.load(function (f, done) { if (!done) warn('Descargando motor de voz: ' + Math.round(f * 100) + '% (solo la primera vez)', 60000); else warn('Iniciando motor de voz…', 60000); });
      $('#warn').hidden = true;
      if (!T.speechWanted) return;
      if (!Cam.stream || !Cam.stream.getAudioTracks().length) throw new Error('sin audio');
      T.tracker.resetSession();
      var finals = [];
      T.vosk = VoskEngine.start(Cam.stream, {
        onPartial: function (t) { if (T.speechWanted) applyWords(finals.concat(Tracker.speechWords(t)), false); },
        onFinal: function (t) { if (!T.speechWanted) return; finals = finals.concat(Tracker.speechWords(t)); applyWords(finals, true); }
      });
      warn('Motor de voz rápido activo', 1500);
    } catch (e) {
      if (!T.speechWanted) return;
      S.voice.engine = 'apple'; Store.saveSettings(); refreshTextUI();
      warn('No se pudo iniciar el motor rápido (' + (e && e.message || 'error') + '). Se usa el reconocimiento de Safari.', 6000);
      startApple();
    }
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
      applyWords(words, isFinal);
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
    if (T.vosk) { T.vosk.stop(); T.vosk = null; }
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
      var br = bitrate(), seq = 0, onChunk = null;
      T.chunkErr = false; T.pending = Promise.resolve(); T.meta = null;
      try { await VDB.open(); onChunk = function (b) { var n = seq++; T.pending = T.pending.then(function () { return VDB.chunk(n, b); }).catch(function () { T.chunkErr = true; }); }; }
      catch (e) { onChunk = null; }
      try {
        var info = Cam.startRecording(br, S.camera.fps, onChunk);
        T.meta = { type: info.type, ext: info.ext, done: false, dur: 0, thumb: Cam.thumb() };
        if (onChunk) { T.pending = VDB.begin(T.meta).catch(function () { T.chunkErr = true; }); }
      }
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
      var r = await Cam.stopRecording(), dur = Date.now() - T.t0;
      if (!r.blob) {   // los trozos están en el almacenamiento del teléfono: se arma el video desde ahí
        await T.pending;
        if (T.chunkErr) throw new Error('No hay espacio suficiente en el teléfono para guardar la grabación');
        T.meta.done = true; T.meta.dur = dur;
        await VDB.finish(T.meta);
        var o = await VDB.load();
        if (!o) throw new Error('La grabación quedó vacía');
        r = { blob: o.blob, ext: T.meta.ext, type: T.meta.type };
      }
      r.blob = await Mp4Fix.fix(r.blob, dur);   // Safari deja una duración absurda en el encabezado del MP4
      if (T.lastVideo) URL.revokeObjectURL(T.lastVideo.url);
      T.lastVideo = { blob: r.blob, ext: r.ext, type: r.type, url: URL.createObjectURL(r.blob), dur: dur, thumb: T.meta && T.meta.thumb };
      freeMemory();   // sin cámara ni motor de voz cargados, iOS tiene memoria para guardar el archivo
      showPreview(false); updateLast();
      saveVideo(true);   // abre “Guardar video” de inmediato; si iOS lo bloquea, queda el botón
    } catch (e) { UI.info('No se pudo guardar la grabación', (e && (e.name + ': ' + e.message)) || 'Error desconocido. Prueba con una resolución o fps menores.'); }
    $('#timer').textContent = '00:00:00';
  }

  /* iOS puede cerrar la página si tiene que cargar entero un video de cientos de MB (al reproducirlo o al compartirlo).
     La vista previa muestra una miniatura y el video se guarda como un solo archivo; si iOS cerró la app al guardar,
     al volver se detecta y se ofrece descargarlo completo a Archivos. */
  var SHARE_MAX = 90 * 1048576, PLAY_MAX = 80 * 1048576, K_SHARING = 'tp.sharing';
  T.shareCrashed = 0;
  try { var sh = localStorage.getItem(K_SHARING); if (sh) { T.shareCrashed = +sh || 1; localStorage.removeItem(K_SHARING); } } catch (e) {}
  if (DEMO) { var qmax = /[?&]maxkb=(\d+)/.exec(location.search); if (qmax) SHARE_MAX = PLAY_MAX = +qmax[1] * 1024; }   // pruebas: forzar la división
  function mb(n) { return Math.max(1, Math.round(n / 1048576)) + ' MB'; }
  function fmtDur(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function videoName(suffix) {
    var stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return 'teleprompter-' + stamp + (suffix || '') + '.' + T.lastVideo.ext;
  }
  function unloadPlayer() { var el = $('#pvVid'); el.pause(); el.removeAttribute('src'); el.load(); el.hidden = true; }

  function showPreview(isReview) {
    var v = T.lastVideo, crashed = T.shareCrashed > 0;
    unloadPlayer();
    var th = $('#pvThumb'); th.hidden = !v.thumb; if (v.thumb) th.src = v.thumb;
    $('#pvPlay').hidden = v.blob.size > PLAY_MAX;
    $('#pvInfo').textContent = (v.dur ? fmtDur(v.dur) + ' · ' : '') + mb(v.blob.size) +
      (crashed ? ' · La última vez iOS cerró la app al guardar. Usa “Descargar a Archivos” (un solo archivo, misma calidad).' : '');
    $('#pvSave').textContent = 'Guardar en Fotos';
    $('#pvSplit').hidden = !crashed;
    $('#pvParts').hidden = true; $('#pvParts').innerHTML = '';
    $('#preview').hidden = false;
    $('#pvDiscard').hidden = isReview; $('#pvClose').hidden = !isReview;
    disarmDiscard();
  }
  $('#pvPlay').addEventListener('click', function () {
    var el = $('#pvVid'); this.hidden = true; $('#pvThumb').hidden = true;
    el.hidden = false; el.src = T.lastVideo.url; el.play().catch(function () {});
  });
  // Libera cámara, motor de voz y medidor de audio. La cámara vuelve sola al cerrar la vista previa.
  function freeMemory() {
    T.rehearsing = false; stopSpeech(); syncScrollEngines();
    try { VoskEngine.unload(); } catch (e) {}
    if (T.audio) { try { T.audio.ctx.close(); } catch (e) {} T.audio = null; }
    Cam.stop(); T.camOk = false;
  }
  function closePreview() {
    unloadPlayer(); $('#preview').hidden = true;
    if (current === 'tele' && !T.camOk) startCamera();
  }
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
    T.lastVideo = null; VDB.clear(); updateLast(); UI.toast('Video descartado');
  });

  // Abre la hoja de iOS para guardar un archivo. Devuelve 'ok', 'cancel' o el nombre del error.
  async function shareBlob(blob, name) {
    var file = new File([blob], name, { type: T.lastVideo.type });
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) return 'unsupported';
    // Marca: si iOS cierra la página mientras prepara el archivo, al volver se sabe y se ofrece otra vía.
    try { localStorage.setItem(K_SHARING, String(blob.size)); } catch (e) {}
    try { await navigator.share({ files: [file] }); return 'ok'; }
    catch (e) { return e.name === 'AbortError' ? 'cancel' : (e.name || 'error'); }
    finally { try { localStorage.removeItem(K_SHARING); } catch (e) {} }
  }

  async function saveVideo(auto) {
    var v = T.lastVideo; if (!v) return;
    if (auto && v.blob.size > SHARE_MAX) { UI.toast('Toca “Guardar en Fotos” para guardar el video'); return; }
    freeMemory(); unloadPlayer();
    var r = await shareBlob(v.blob, videoName());
    if (r === 'ok') { T.shareCrashed = 0; return; }
    if (r === 'cancel') return;
    if (auto) { UI.toast('Toca “Guardar en Fotos” para guardarlo'); return; }   // iOS pide un toque del usuario
    UI.toast('No se pudo abrir “Guardar” (' + r + '). Prueba “Descargar a Archivos”.');
  }

  // Divide el MP4 sin recomprimir y muestra un botón por parte (iOS exige un toque para cada “Guardar”).
  async function showParts() {
    var v = T.lastVideo, box = $('#pvParts');
    if (!v.parts) {
      UI.toast('Preparando partes…');
      try { v.parts = await Mp4Fix.split(v.blob, SHARE_MAX, v.dur); } catch (e) { v.parts = null; }
    }
    if (!v.parts || v.parts.length < 2) {
      var ok = await UI.confirm('Video muy grande', 'Pesa ' + mb(v.blob.size) + ' y no se pudo dividir. iOS puede cerrar la app al guardarlo en Fotos. ¿Descargarlo a Archivos?', 'Descargar');
      if (ok) downloadVideo();
      return;
    }
    box.innerHTML = '';
    v.parts.forEach(function (p, i) {
      var b = document.createElement('button'), label = 'Guardar parte ' + (i + 1) + ' de ' + v.parts.length + (p.seconds ? ' · ' + fmtDur(p.seconds * 1000) : '') + ' · ' + mb(p.blob.size);
      b.textContent = (p.saved ? '✓ ' : '') + label; b.classList.toggle('done', !!p.saved);
      b.onclick = async function () {
        var r = await shareBlob(p.blob, videoName('-parte' + (i + 1)));
        if (r === 'ok') { p.saved = true; b.textContent = '✓ ' + label; b.classList.add('done'); }
        else if (r !== 'cancel') UI.toast('No se pudo guardar la parte ' + (i + 1) + ' (' + r + ')');
      };
      box.appendChild(b);
    });
    box.hidden = false;
    $('#pvInfo').textContent = 'Toca cada parte y elige “Guardar video”. Se guardan en orden en Fotos, con la misma calidad.';
  }

  function downloadVideo() {
    var v = T.lastVideo; if (!v) return;
    freeMemory(); unloadPlayer();
    downloadBlob(v.blob, videoName());
    UI.info('Descargando video', 'Queda en la app Archivos › Descargas (' + mb(v.blob.size) + '). Ábrelo ahí, toca Compartir y elige “Guardar video” para pasarlo a Fotos.');
  }
  $('#pvSave').addEventListener('click', function () { saveVideo(false); });
  $('#pvDown').addEventListener('click', downloadVideo);
  $('#pvSplit').addEventListener('click', function () { freeMemory(); unloadPlayer(); showParts(); });
  // Diagnóstico: cómo viene el archivo de Safari (original) y cómo queda tras la corrección, para una captura.
  $('#pvDiag').addEventListener('click', async function () {
    var v = T.lastVideo; if (!v) return;
    var txt = '';
    try { var o = await VDB.load(); if (o) txt += 'ORIGINAL\n' + await Mp4Fix.describe(o.blob) + '\n\n'; } catch (e) {}
    try { txt += 'CORREGIDO\n' + await Mp4Fix.describe(v.blob); } catch (e) { txt += 'error: ' + e.message; }
    UI.info('Info técnica (v17 · ' + (v.dur ? fmtDur(v.dur) : '?') + ')', txt);
  });  // Aviso en la pantalla de inicio mientras haya un video grabado sin descartar.
  function updateLast() { $('#btnLast').hidden = !T.lastVideo; }
  $('#btnLast').addEventListener('click', function () { if (T.lastVideo) showPreview(true); });

  /* Los trozos de la grabación se escriben en el almacenamiento del teléfono mientras grabas (no se acumulan en memoria),
     y quedan como copia de seguridad: si la app se cierra, el video se recupera al abrirla de nuevo. */
  var VDB = {
    db: null,
    open: function () {
      if (!VDB.db) VDB.db = new Promise(function (res, rej) {
        var r = indexedDB.open('tp-video', 2);
        r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('v')) d.createObjectStore('v'); if (!d.objectStoreNames.contains('c')) d.createObjectStore('c'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
      return VDB.db;
    },
    tx: async function (stores, fn) {
      var db = await VDB.open();
      return new Promise(function (res, rej) {
        var t = db.transaction(stores, 'readwrite'), out;
        out = fn(t); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = t.onabort = function () { rej(t.error); };
      });
    },
    begin: function (meta) { return VDB.tx(['v', 'c'], function (t) { t.objectStore('c').clear(); t.objectStore('v').put(meta, 'meta'); }); },
    chunk: function (seq, blob) { return VDB.tx(['c'], function (t) { t.objectStore('c').put(blob, seq); }); },
    finish: function (meta) { return VDB.tx(['v'], function (t) { t.objectStore('v').put(meta, 'meta'); }); },
    clear: function () { return VDB.tx(['v', 'c'], function (t) { t.objectStore('c').clear(); t.objectStore('v').clear(); }); },
    load: async function () {
      var db = await VDB.open();
      return new Promise(function (res, rej) {
        var t = db.transaction(['v', 'c']), m = t.objectStore('v').get('meta'), c = t.objectStore('c').getAll();
        t.oncomplete = function () { res(m.result && c.result && c.result.length ? { meta: m.result, n: c.result.length, blob: new Blob(c.result, { type: m.result.type }) } : null); };
        t.onerror = function () { rej(t.error); };
      });
    }
  };
  try {
    VDB.load().then(async function (o) {
      if (!o || T.lastVideo) return;
      var dur = o.meta.dur || o.n * 1000;   // sin duración guardada (grabación interrumpida): un trozo ≈ 1 s
      o.blob = await Mp4Fix.fix(o.blob, dur);
      T.lastVideo = { blob: o.blob, ext: o.meta.ext, type: o.meta.type, url: URL.createObjectURL(o.blob), dur: dur, thumb: o.meta.thumb };
      updateLast();
      if (T.shareCrashed) return UI.info('Tu video está a salvo', 'iOS cerró la app mientras preparaba “Guardar en Fotos” (' + mb(o.blob.size) + '). Toca “Video sin guardar” y usa “Descargar a Archivos”: es el mismo archivo completo, en la misma calidad.');
      UI.toast(o.meta.done ? 'Tienes un video sin exportar: botón de descarga en el teleprompter' : 'Se recuperó una grabación interrumpida: botón de descarga en el teleprompter');
    }).catch(function () {});
  } catch (e) {}  $('#bDown').addEventListener('click', function () {
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
  // Calidad de grabación (Mbps a 30 / 60 fps). "Máxima" se parece a lo que graba la cámara del iPhone en H.264.
  var QUALITY = {
    max:  { '720': [8, 12], '1080': [16, 24], '4k': [45, 65] },
    high: { '720': [5, 7],  '1080': [10, 14], '4k': [28, 40] },
    lite: { '720': [3, 4],  '1080': [5, 7],   '4k': [14, 20] }
  };
  function bitrate() {
    var q = QUALITY[S.camera.quality] || QUALITY.max, r = q[S.camera.res] || q['1080'];
    return r[S.camera.fps >= 60 ? 1 : 0] * 1e6;
  }
  function qualityHint() {
    var el = $('#qualityHint'); if (!el) return;
    el.textContent = '≈ ' + Math.round(bitrate() * 60 / 8 / 1048576 + 1.4) + ' MB por minuto';
  }
  $$('#cQuality button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (T.recording) return UI.toast('Detén la grabación para cambiar la calidad');
      S.camera.quality = b.dataset.v; Store.saveSettings(); segSet('#cQuality', b.dataset.v); qualityHint();
    });
  });

  function refreshCamUI() {
    var c = S.camera;
    qualityHint();
    $('#cMirror').checked = c.mirror; $('#cGrid').checked = c.grid; $('#cHdr').checked = c.hdr;
    $('#rowHdr').hidden = !(window.matchMedia && matchMedia('(dynamic-range: high)').matches);
    segSet('#cRes', c.res); segSet('#cFps', c.fps); segSet('#cQuality', c.quality); segSet('#cBlur', c.blur ? 1 : 0);
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
  function micLabel() { var t = Cam.stream && Cam.stream.getAudioTracks()[0]; return t && t.label || ''; }
  async function refreshMics() {
    var sel = $('#cMic'), row = $('#rowMic');
    var ml = document.querySelector('.meter span'); if (ml) ml.textContent = micLabel() || 'Micrófono';
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
  $$('#cFps button').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (S.camera.fps === +b.dataset.v) return;
      if (T.recording) return UI.toast('Detén la grabación para cambiar los fps');
      S.camera.fps = +b.dataset.v; Store.saveSettings(); segSet('#cFps', b.dataset.v); qualityHint();
      await restartCamera(); refreshCamUI();
      var got = T.camInfo && T.camInfo.settings && T.camInfo.settings.frameRate;
      if (got && Math.round(got) < S.camera.fps - 2) UI.toast('Tu cámara entrega ' + Math.round(got) + ' fps en esta resolución');
    });
  });
  // Micrófono externo (inalámbrico, USB-C, Lightning o Bluetooth): al conectarlo o quitarlo, volver a tomar el audio.
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    var micCount = -1, micTimer;
    navigator.mediaDevices.addEventListener('devicechange', function () {
      clearTimeout(micTimer);
      micTimer = setTimeout(async function () {
        if (current !== 'tele' || !T.camOk) return;
        var n = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'audioinput'; }).length;
        var changed = micCount >= 0 && n !== micCount; micCount = n;
        if (!changed) return refreshMics();
        if (T.recording) { UI.toast('Cambió el micrófono; se aplicará al terminar de grabar'); return; }
        S.camera.micId = '';   // vuelve al micrófono predeterminado del sistema, que iOS cambia al externo
        await restartCamera(); refreshMics();
        UI.toast('Micrófono: ' + (micLabel() || 'predeterminado'));
      }, 600);
    });
  }
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
    $$('#tEngine button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.voice.engine); });
    $('#tBg').value = Math.round(t.bg * 100); $('#bgVal').textContent = Math.round(t.bg * 100) + '%';
  }
  $('#bText').addEventListener('click', function () { refreshTextUI(); UI.sheet('#shText'); });
  $('#tSize').addEventListener('input', function (e) { S.text.size = +e.target.value; $('#sizeVal').textContent = S.text.size; Store.saveSettings(); applyText(); });
  $$('#tAlign button').forEach(function (b) { b.addEventListener('click', function () { S.text.align = b.dataset.v; Store.saveSettings(); applyText(); segSet('#tAlign', b.dataset.v); }); });
  $('#tMirH').addEventListener('click', function () { S.text.mirrorH = !S.text.mirrorH; Store.saveSettings(); applyText(); refreshTextUI(); });
  $('#tMirV').addEventListener('click', function () { S.text.mirrorV = !S.text.mirrorV; Store.saveSettings(); applyText(); refreshTextUI(); });
  $$('#tEngine button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.voice.engine = b.dataset.v; Store.saveSettings(); refreshTextUI();
      if (T.speechWanted) { stopSpeech(); syncScrollEngines(); }
    });
  });
  $('#tBg').addEventListener('input', function (e) { S.text.bg = +e.target.value / 100; $('#bgVal').textContent = e.target.value + '%'; Store.saveSettings(); applyText(); });

  /* ================= arranque ================= */
  renderList();
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js?v=6').catch(function () {}); });
  }
  // Para pruebas automáticas
  window.__tp = { T: T, setPos: setPos, S: S, openTele: openTele };
  if (/[?&]open=1/.test(location.search)) { var f = Store.list()[0]; if (f) openTele(f.id); }
})();







