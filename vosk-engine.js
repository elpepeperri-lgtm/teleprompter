/* Motor de voz local (Vosk, español): reconoce dentro del teléfono, sin enviar audio a servidores y con resultados parciales casi inmediatos. */
window.VoskEngine = (function () {
  'use strict';
  var LIB = 'vosk/vosk.js?v=1', MODEL = 'vosk/model-es.tar.gz', CACHE = 'vosk-model-v1';
  var PARTS = 4, model = null, loading = null;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (window.Vosk) return res();
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('No se pudo cargar el motor de voz')); };
      document.head.appendChild(s);
    });
  }

  // Descarga el modelo una sola vez y lo guarda en el dispositivo (Cache Storage).
  async function modelUrl(onProgress) {
    var cache = null;
    try { cache = await caches.open(CACHE); var hit = await cache.match(MODEL); if (hit) return URL.createObjectURL(await hit.blob()); } catch (e) {}
    var parts = [];
    for (var i = 0; i < PARTS; i++) {   // el modelo se publica en 4 trozos de ~10 MB
      var resp = await fetch('vosk/model-es.part' + i);
      if (!resp.ok) throw new Error('No se pudo descargar el modelo de voz');
      parts.push(new Uint8Array(await resp.arrayBuffer()));
      if (onProgress) onProgress((i + 1) / PARTS);
    }
    var blob = new Blob(parts, { type: 'application/gzip' });
    try { if (cache) await cache.put(MODEL, new Response(blob)); } catch (e) {}
    return URL.createObjectURL(blob);
  }

  function load(onProgress) {
    if (model) return Promise.resolve(model);
    if (loading) return loading;
    loading = (async function () {
      await loadScript(LIB);
      var url = await modelUrl(onProgress);
      if (onProgress) onProgress(1, true);
      model = await Vosk.createModel(url);
      return model;
    })();
    loading.catch(function () { loading = null; });
    return loading;
  }

  // stream: MediaStream con audio. handlers: {onPartial(text), onFinal(text)}
  function start(stream, handlers) {
    var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
    var rec = new model.KaldiRecognizer(ctx.sampleRate);
    rec.on('partialresult', function (m) { if (m && m.result) handlers.onPartial(m.result.partial || ''); });
    rec.on('result', function (m) { if (m && m.result) handlers.onFinal(m.result.text || ''); });
    var src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    var proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = function (e) { try { rec.acceptWaveform(e.inputBuffer); } catch (err) {} };
    src.connect(proc); proc.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume();
    return {
      stop: function () {
        try { proc.onaudioprocess = null; src.disconnect(); proc.disconnect(); } catch (e) {}
        try { rec.remove(); } catch (e) {}
        try { ctx.close(); } catch (e) {}
      }
    };
  }

  // Libera el modelo (cientos de MB de RAM); se vuelve a cargar desde la caché al usar la voz de nuevo.
  function unload() {
    var m = model; model = null; loading = null;
    try { if (m && m.terminate) m.terminate(); } catch (e) {}
  }

  return { unload: unload, load: load, start: start, get model() { return model; }, get ready() { return !!model; } };
})();
