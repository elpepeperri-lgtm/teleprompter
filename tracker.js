/* Seguimiento de voz: compara palabras reconocidas contra el guion.
   Funciona en navegador (window.Tracker) y en Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tracker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WINDOW = 15;

  function normalize(s) {
    return String(s).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }

  // Divide el guion en tokens: espacios, separadores (rayas, /) y palabras.
  // Cada palabra con contenido recibe un índice consecutivo.
  function tokenize(text) {
    var parts = String(text).match(/\s+|[—–\/]+|[^\s—–\/]+/g) || [];
    var out = [], idx = 0;
    parts.forEach(function (p) {
      var norm = /^[\s—–\/]/.test(p) ? '' : normalize(p);
      out.push({ text: p, norm: norm, index: norm ? idx++ : -1 });
    });
    return out;
  }

  function scriptWords(text) {
    return tokenize(text).filter(function (t) { return t.index >= 0; })
      .map(function (t) { return t.norm; });
  }

  // Palabras reconocidas -> lista normalizada
  function speechWords(text) {
    return String(text).split(/[\s\-–—]+/).map(normalize).filter(Boolean);
  }

  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // Clave fonética del español: iguala errores típicos del reconocedor (v/b, s/z/c, ll/y, h muda, qu/k...)
  function phon(s) {
    return s.replace(/ll/g, 'y').replace(/qu/g, 'k').replace(/c([ei])/g, 's$1').replace(/z/g, 's').replace(/c/g, 'k')
      .replace(/v/g, 'b').replace(/w/g, 'b').replace(/h/g, '').replace(/x/g, 'ks').replace(/(.)\1+/g, '$1');
  }

  function similarity(a, b) {
    if (a === b) return 1;
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  }

  // Puntaje (0 = no coincide) de la palabra reconocida r contra la del guion s a distancia dist.
  function score(r, s, dist, tentative) {
    if (dist > 0 && s.length < 3) return 0;                   // palabras cortas (de, la, y…) solo cuentan en su lugar exacto
    if (dist > 1 && s.length < 4) return 0;                   // palabras cortas no justifican saltos
    if (r === s) return 1 - 0.04 * dist;
    if (Math.min(r.length, s.length) <= 2) return 0;          // palabras cortas: solo exactas
    var sim = similarity(r, s);
    if (r.length >= 3 && phon(r) === phon(s)) sim = Math.max(sim, 0.95);
    var min = Math.max(r.length, s.length) <= 4 ? 0.75 : 0.7;
    if (tentative && r.length >= 2 && r.length < s.length && s.indexOf(r) === 0) sim = Math.max(sim, 0.9); // palabra a medias
    if (dist > 2) {                                           // saltos largos: exigir más evidencia
      if (s.length < 4) return 0;
      min = 0.8;
    }
    return sim >= min ? sim - 0.04 * dist : 0;
  }

  function create(norms, opts) {
    opts = opts || {};
    var win = opts.window || WINDOW;
    var pos = opts.start || 0;         // índice de la palabra actual (monótono)
    // El reconocedor revisa sus parciales; por eso cada actualización se alinea de nuevo desde el inicio de la
    // frase en curso (basePos) en vez de acumular, y así una palabra repetida no se cuenta dos veces.
    var basePos = pos, cBase = 0, lastLen = 0;

    function find(r, from, tentative) {
      var best = -1, bestScore = 0, end = Math.min(norms.length, from + win);
      for (var j = from; j < end; j++) {
        var sc = score(r, norms[j], j - from, tentative);
        if (sc > bestScore) { bestScore = sc; best = j; }
      }
      return best;
    }

    return {
      get pos() { return pos; },
      get done() { return pos >= norms.length; },
      // words: lista completa (normalizada) de la sesión de reconocimiento actual
      update: function (words, isFinal) {
        var n = words.length;
        if (n < cBase) { cBase = 0; basePos = pos; }
        var p = basePos;
        for (var i = cBase; i < n; i++) {
          var j = find(words[i], p, !isFinal && i === n - 1);
          if (j >= 0) p = j + 1;
        }
        lastLen = n;
        if (isFinal) { cBase = n; basePos = Math.max(p, pos); }
        if (p > pos) pos = p;          // nunca retrocede
        return pos;
      },
      resetSession: function () { cBase = 0; lastLen = 0; basePos = pos; },
      // salto manual (toque en una palabra); puede ir hacia atrás
      setPos: function (p) { pos = basePos = Math.max(0, Math.min(p, norms.length)); cBase = lastLen; }
    };
  }

  return {
    normalize: normalize, tokenize: tokenize, scriptWords: scriptWords,
    speechWords: speechWords, lev: lev, create: create, WINDOW: WINDOW
  };
});

