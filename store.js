/* Almacenamiento local (localStorage): guiones y ajustes. */
window.Store = (function () {
  'use strict';
  var K_SCRIPTS = 'tp.scripts.v1', K_SETTINGS = 'tp.settings.v1';

  var SAMPLE = 'Hola, bienvenidos a mi canal. Hoy quiero hablarles de tres hábitos que cambiaron mi vida.\n\n' +
    'El primero es levantarme temprano: la mañana es el mejor momento para concentrarme y avanzar en lo importante.\n\n' +
    'El segundo es leer todos los días, aunque sean solo diez minutos. Con el tiempo, esos minutos se convierten en libros enteros.\n\n' +
    'Y el tercero, quizás el más importante, es agradecer antes de dormir. Termino el día recordando tres cosas buenas que me pasaron.\n\n' +
    'Si te gustó este video, suscríbete y cuéntame en los comentarios cuál es tu hábito favorito. ¡Nos vemos en el próximo video!';

  var DEFAULTS = {
    text: { font: 'Open Sans', size: 35, align: 'left', mirrorH: false, mirrorV: false, bg: 0.55 },
    camera: { facing: 'user', mirror: true, grid: false, hdr: false, res: '1080', fps: 60, zoom: 1, micId: '', blur: false, filter: 'none' },
    box: { top: 70, left: 0.03, width: 0.94, height: 290 },
    voice: { lang: 'es-CO', mode: 'voice', speed: 40, engine: 'vosk' },
    started: false
  };

  function read(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var scripts = read(K_SCRIPTS, null);
  if (!scripts) {
    var now = Date.now();
    scripts = [{ id: uid(), title: 'Guion de ejemplo', text: SAMPLE, created: now, updated: now, pos: 0 }];
    write(K_SCRIPTS, scripts);
  }

  var saved = read(K_SETTINGS, {});
  var settings = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    var d = DEFAULTS[k];
    settings[k] = (d && typeof d === 'object') ? Object.assign({}, d, saved[k] || {}) : (k in saved ? saved[k] : d);
  });

  function persistScripts() { write(K_SCRIPTS, scripts); }

  return {
    settings: settings,
    saveSettings: function () { write(K_SETTINGS, settings); },
    uid: uid,
    list: function () { return scripts.slice().sort(function (a, b) { return b.updated - a.updated; }); },
    get: function (id) { return scripts.find(function (s) { return s.id === id; }); },
    create: function (title, text) {
      var now = Date.now();
      var s = { id: uid(), title: title || '', text: text || '', created: now, updated: now, pos: 0 };
      scripts.push(s); persistScripts(); return s;
    },
    update: function (id, patch, touch) {
      var s = this.get(id); if (!s) return;
      Object.assign(s, patch);
      if (touch !== false) s.updated = Date.now();
      persistScripts();
    },
    setPos: function (id, pos) { this.update(id, { pos: pos }, false); },
    duplicate: function (id) {
      var s = this.get(id); if (!s) return;
      return this.create((s.title || 'Sin título') + ' (copia)', s.text);
    },
    remove: function (id) { scripts = scripts.filter(function (s) { return s.id !== id; }); persistScripts(); },
    exportAll: function () {
      return JSON.stringify({ app: 'teleprompter', version: 1, exported: new Date().toISOString(), scripts: scripts }, null, 2);
    },
    importAll: function (json) {
      var data = JSON.parse(json);
      var arr = Array.isArray(data) ? data : data.scripts;
      if (!Array.isArray(arr)) throw new Error('Formato no válido');
      var added = 0, updated = 0;
      arr.forEach(function (it) {
        if (!it || typeof it.text !== 'string') return;
        var cur = it.id && scripts.find(function (s) { return s.id === it.id; });
        if (cur) {
          if ((it.updated || 0) > cur.updated) { cur.title = it.title || ''; cur.text = it.text; cur.updated = it.updated; updated++; }
        } else {
          var now = Date.now();
          scripts.push({ id: it.id || uid(), title: String(it.title || ''), text: it.text, created: it.created || now, updated: it.updated || now, pos: 0 });
          added++;
        }
      });
      persistScripts();
      return { added: added, updated: updated };
    }
  };
})();

