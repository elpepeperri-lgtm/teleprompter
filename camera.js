/* Cámara: vista previa y grabación a través de un canvas WebGL (filtros, espejo, zoom, desenfoque).
   El guion es HTML encima de la página; nunca se dibuja en el canvas, así que no sale en el video. */
window.Cam = (function () {
  'use strict';

  var RES = { '720': [1280, 720], '1080': [1920, 1080], '4k': [3840, 2160] };
  var FILTERS = { none: 0, bw: 1, warm: 2, cool: 3, bright: 4 };

  var VS = 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
  var FS = 'precision mediump float;varying vec2 v;uniform sampler2D t;uniform float mirror,zoom,blur,hdr;uniform int mode;' +
    'vec3 tap(vec2 uv){return texture2D(t,uv).rgb;}' +
    'void main(){vec2 uv=(v-.5)/zoom+.5;if(mirror>.5)uv.x=1.-uv.x;' +
    'vec3 c;if(blur>.5){float d=length((v-.5)*vec2(1.,.75));float w=smoothstep(.2,.55,d);float r=w*.018;c=tap(uv)*.2;' +
    'for(int i=0;i<12;i++){float a=float(i)*.5236;c+=tap(uv+vec2(cos(a),sin(a))*r*(.55+.45*mod(float(i),2.)))*.0667;}}else c=tap(uv);' +
    'if(hdr>.5){c=pow(c,vec3(.9));c=(c-.5)*1.12+.5;float g=dot(c,vec3(.299,.587,.114));c=mix(vec3(g),c,1.18);}' +
    'if(mode==1){float g=dot(c,vec3(.299,.587,.114));c=vec3(g);}' +
    'else if(mode==2)c*=vec3(1.1,1.,.86);else if(mode==3)c*=vec3(.88,1.,1.13);else if(mode==4)c=c*1.18+.06;' +
    'gl_FragColor=vec4(clamp(c,0.,1.),1.);}';

  var canvas, video, gl, prog, tex, loc = {}, ctx2d;
  var stream = null, running = false, raf = 0;
  var params = { mirror: true, zoom: 1, filter: 'none', blur: false, hdr: false };
  var recorder = null, chunks = [], recMime = '', recDirect = false;
  var lastW = 0, lastH = 0, shownDirect = null;

  // Sin efectos (filtro, desenfoque, HDR, zoom) no hace falta procesar cada cuadro: se muestra el <video> de la cámara
  // y se graba su señal tal cual con el codificador del teléfono. Mucho menos trabajo, menos calor y menos batería.
  function direct() {
    if (recorder && recorder.state !== 'inactive') return recDirect;
    return (params.filter || 'none') === 'none' && !params.blur && !params.hdr && params.zoom <= 1.01;
  }
  function showView(d) {
    if (d === shownDirect) return;
    shownDirect = d;
    canvas.style.visibility = d ? 'hidden' : '';
    video.classList.toggle('live', d);
  }

  function init(cv, vd) {
    canvas = cv; video = vd;
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false });
    if (!gl) { ctx2d = canvas.getContext('2d'); return; }
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; ctx2d = canvas.getContext('2d'); return; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    ['mirror', 'zoom', 'blur', 'hdr', 'mode', 't'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(loc.t, 0);
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!running) return;
    var d = direct();
    showView(d);
    video.classList.toggle('mirror', d && params.mirror);
    if (d || video.readyState < 2 || !video.videoWidth) return;
    var w = video.videoWidth, h = video.videoHeight;
    if (w !== lastW || h !== lastH) { canvas.width = lastW = w; canvas.height = lastH = h; }
    if (gl) {
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform1f(loc.mirror, params.mirror ? 1 : 0);
      gl.uniform1f(loc.zoom, Math.max(1, params.zoom));
      gl.uniform1f(loc.blur, params.blur ? 1 : 0);
      gl.uniform1f(loc.hdr, params.hdr ? 1 : 0);
      gl.uniform1i(loc.mode, FILTERS[params.filter] || 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      var z = Math.max(1, params.zoom);
      ctx2d.save();
      if (params.mirror) { ctx2d.translate(w, 0); ctx2d.scale(-1, 1); }
      ctx2d.drawImage(video, (w - w / z) / 2, (h - h / z) / 2, w / z, h / z, 0, 0, w, h);
      ctx2d.restore();
    }
  }

  async function start(opts) {
    stop();
    var r = RES[opts.res] || RES['1080'];
    var constraints = {
      video: { facingMode: { ideal: opts.facing || 'user' }, width: { ideal: r[0] }, height: { ideal: r[1] }, frameRate: { ideal: opts.fps || 60 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    };
    // Con un micrófono elegido (lavalier/inalámbrico) se desactiva el procesado del teléfono para conservar su calidad.
    if (opts.micId) constraints.audio = { deviceId: { exact: opts.micId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (opts.micId && e.name === 'OverconstrainedError') { delete constraints.audio.deviceId; stream = await navigator.mediaDevices.getUserMedia(constraints); }
      else throw e;
    }
    video.srcObject = stream;
    await video.play();
    running = true;
    lastW = lastH = 0;
    if (!raf) draw();
    return info();
  }

  // Fuente de prueba (?demo=1): sin cámara real, útil para probar en un navegador de escritorio.
  async function startDemo() {
    stop();
    var c = document.createElement('canvas'); c.width = 720; c.height = 1280;
    var x = c.getContext('2d'), t0 = performance.now();
    (function loop() {
      var t = (performance.now() - t0) / 1000;
      var g = x.createLinearGradient(0, 0, 720, 1280);
      g.addColorStop(0, 'hsl(' + (t * 20 % 360) + ',60%,35%)'); g.addColorStop(1, 'hsl(' + ((t * 20 + 120) % 360) + ',60%,15%)');
      x.fillStyle = g; x.fillRect(0, 0, 720, 1280);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(360 + Math.sin(t * 2) * 200, 800, 90, 0, 7); x.fill();
      x.font = 'bold 60px sans-serif'; x.fillText('DEMO ' + t.toFixed(1), 40, 1200);
      setTimeout(loop, 33);
    })();
    stream = c.captureStream(30);
    video.srcObject = stream;
    await video.play();
    running = true; lastW = lastH = 0;
    if (!raf) draw();
    return info();
  }

  function info() {
    var vt = stream.getVideoTracks()[0], caps = {};
    try { caps = vt.getCapabilities ? vt.getCapabilities() : {}; } catch (e) {}
    var max = Math.max((caps.width && caps.width.max) || 0, (caps.height && caps.height.max) || 0);
    return { stream: stream, max: max, settings: vt.getSettings ? vt.getSettings() : {} };
  }

  // Miniatura JPEG pequeña del cuadro actual (para la vista previa sin cargar el video).
  function thumb() {
    try {
      var w = video.videoWidth, h = video.videoHeight; if (!w) return '';
      var s = 320 / Math.max(w, h), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
      var x = c.getContext('2d');
      if (params.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
      x.drawImage(video, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  }

  function stop() {
    running = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (video) video.srcObject = null;
  }

  function pickMime() {
    var list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }

  // onChunk(blob): si se entrega, cada trozo se pasa al llamador (que lo guarda en disco) y no se acumula en memoria.
  function startRecording(bitrate, fps, onChunk) {
    if (!stream || !window.MediaRecorder) throw new Error('Grabación no disponible');
    recDirect = direct();
    var vt = recDirect ? stream.getVideoTracks() : canvas.captureStream(fps || 60).getVideoTracks();
    var tracks = vt.concat(stream.getAudioTracks());
    recMime = pickMime();
    var opts = { videoBitsPerSecond: bitrate || 8e6, audioBitsPerSecond: 192000 };
    if (recMime) opts.mimeType = recMime;
    recorder = new MediaRecorder(new MediaStream(tracks), opts);
    chunks = [];
    recorder.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      if (onChunk) onChunk(e.data); else chunks.push(e.data);
    };
    recorder.start(1000);
    var t = (recorder.mimeType || recMime || 'video/mp4').split(';')[0];
    return { type: t, ext: t.indexOf('mp4') >= 0 ? 'mp4' : 'webm', direct: recDirect };
  }

  function stopRecording() {
    return new Promise(function (resolve, reject) {
      if (!recorder || recorder.state === 'inactive') return reject(new Error('No hay grabación'));
      recorder.onstop = function () {
        var type = (recorder.mimeType || recMime || 'video/mp4').split(';')[0];
        var blob = chunks.length ? new Blob(chunks, { type: type }) : null;   // null: los trozos ya se guardaron aparte
        recorder = null; chunks = [];
        resolve({ blob: blob, type: type, ext: type.indexOf('mp4') >= 0 ? 'mp4' : 'webm' });
      };
      recorder.stop();
    });
  }

  return {
    init: init, start: start, startDemo: startDemo, stop: stop, startRecording: startRecording, stopRecording: stopRecording, thumb: thumb,
    get direct() { return direct(); },
    params: params,
    get stream() { return stream; },
    get recording() { return !!recorder && recorder.state !== 'inactive'; }
  };
})();
