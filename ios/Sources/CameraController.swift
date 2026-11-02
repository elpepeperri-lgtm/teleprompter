import AVFoundation
import Photos
import UIKit

/// Cámara y grabación. Usa AVCaptureSession + AVAssetWriter (HEVC), como una app de cámara profesional:
/// el archivo se escribe en disco mientras grabas (no ocupa memoria) y queda como un .mov normal.
final class CameraController: NSObject, ObservableObject {
    struct Config: Equatable {
        var front: Bool
        var resolution: String
        var fps: Int
        var bitrate: Int
        var mirrorRecording: Bool
        var zoom: Double
    }

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "camara", qos: .userInitiated)
    private let videoOut = AVCaptureVideoDataOutput()
    private let audioOut = AVCaptureAudioDataOutput()
    private var videoIn: AVCaptureDeviceInput?
    private var audioIn: AVCaptureDeviceInput?
    private var config: Config?
    private var actualFps = 30

    // Estado de la grabación (solo se usa dentro de `queue`)
    private var writer: AVAssetWriter?
    private var wVideo: AVAssetWriterInput?
    private var wAudio: AVAssetWriterInput?
    private var wantRecord = false
    private var sessionStarted = false
    private var fileURL: URL?

    /// Audio para el reconocimiento de voz (se llama en la cola de la cámara).
    var onAudioBuffer: ((CMSampleBuffer) -> Void)?

    @Published var running = false
    @Published var statusText = ""
    @Published var inputs: [AVAudioSessionPortDescription] = []
    @Published var currentInputUID = ""
    @Published var problem: String?
    /// Nivel del micrófono (0…1), unas 12 veces por segundo, para el medidor.
    @Published var micLevel: Float = 0
    private var lastLevelTime: CFTimeInterval = 0

    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    static func requestPermissions() async -> Bool {
        let v = await AVCaptureDevice.requestAccess(for: .video)
        let a = await AVCaptureDevice.requestAccess(for: .audio)
        return v && a
    }

    // MARK: - Audio (micrófono)

    /// Modo "videoRecording": sin el procesado de llamadas (eco, ruido, ganancia). Es el audio limpio de la app Cámara.
    private func configureAudioSession() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker])
            try? s.setPreferredSampleRate(48_000)
            try s.setActive(true)
        } catch {
            report("No se pudo preparar el audio: \(error.localizedDescription)")
        }
        preferExternalMic()
    }

    /// Si hay un micrófono externo (receptor USB-C del Lark, Rode, DJI…, o de cable), se usa ese.
    func preferExternalMic() {
        let s = AVAudioSession.sharedInstance()
        let ins = s.availableInputs ?? []
        if let ext = ins.first(where: { $0.portType == .usbAudio }) ?? ins.first(where: { $0.portType == .headsetMic }) {
            try? s.setPreferredInput(ext)
        }
        refreshInputs()
    }

    func selectInput(uid: String) {
        let s = AVAudioSession.sharedInstance()
        if let p = (s.availableInputs ?? []).first(where: { $0.uid == uid }) { try? s.setPreferredInput(p) }
        refreshInputs()
    }

    private func refreshInputs() {
        let s = AVAudioSession.sharedInstance()
        let ins = s.availableInputs ?? []
        let cur = s.currentRoute.inputs.first?.uid ?? ""
        DispatchQueue.main.async {
            self.inputs = ins
            self.currentInputUID = cur
        }
        updateStatus()
    }

    @objc private func routeChanged(_ n: Notification) {
        let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        if AVAudioSession.RouteChangeReason(rawValue: raw) == .newDeviceAvailable { preferExternalMic() }
        else { refreshInputs() }
    }

    // MARK: - Cámara

    func start(_ c: Config) {
        queue.async {
            self.configure(c)
            if !self.session.isRunning { self.session.startRunning() }
            let ok = self.session.isRunning
            DispatchQueue.main.async { self.running = ok }
            self.updateStatus()
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async { self.running = false }
        }
    }

    private func configure(_ c: Config) {
        configureAudioSession()
        session.beginConfiguration()
        session.automaticallyConfiguresApplicationAudioSession = false
        session.sessionPreset = .inputPriority

        let position: AVCaptureDevice.Position = c.front ? .front : .back
        if config?.front != c.front || videoIn == nil {
            if let i = videoIn { session.removeInput(i); videoIn = nil }
            guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
                  let input = try? AVCaptureDeviceInput(device: dev), session.canAddInput(input) else {
                session.commitConfiguration()
                report("No se pudo abrir la cámara")
                return
            }
            session.addInput(input)
            videoIn = input
        }
        if audioIn == nil, let mic = AVCaptureDevice.default(for: .audio),
           let ai = try? AVCaptureDeviceInput(device: mic), session.canAddInput(ai) {
            session.addInput(ai)
            audioIn = ai
        }
        if !session.outputs.contains(videoOut) {
            videoOut.alwaysDiscardsLateVideoFrames = false
            videoOut.setSampleBufferDelegate(self, queue: queue)
            if session.canAddOutput(videoOut) { session.addOutput(videoOut) }
        }
        if !session.outputs.contains(audioOut) {
            audioOut.setSampleBufferDelegate(self, queue: queue)
            if session.canAddOutput(audioOut) { session.addOutput(audioOut) }
        }
        if let dev = videoIn?.device { applyFormat(dev, c) }
        if let conn = videoOut.connection(with: .video) {
            if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }   // vertical
            if conn.isVideoMirroringSupported {   // normal: el video sale como te ven los demás; o en espejo si se pidió
                conn.automaticallyAdjustsVideoMirroring = false
                conn.isVideoMirrored = c.mirrorRecording
            }
            if conn.isVideoStabilizationSupported { conn.preferredVideoStabilizationMode = .standard }
        }
        session.commitConfiguration()
        config = c
        applyZoom(c.zoom)
    }

    /// Zoom de la cámara (se graba así; no es un recorte posterior).
    func setZoom(_ z: Double) {
        queue.async { self.applyZoom(z) }
    }

    private func applyZoom(_ z: Double) {
        guard let dev = videoIn?.device else { return }
        let maxZ = min(dev.activeFormat.videoMaxZoomFactor, 6)
        let target = max(1, min(CGFloat(z), maxZ))
        do {
            try dev.lockForConfiguration()
            dev.videoZoomFactor = target
            dev.unlockForConfiguration()
        } catch {}
    }

    /// Elige el formato nativo de la cámara con la resolución y los fps pedidos (8 bits, como la app Cámara en "Más compatible").
    private func applyFormat(_ dev: AVCaptureDevice, _ c: Config) {
        let want: (Int32, Int32) = c.resolution == "4k" ? (3840, 2160) : (1920, 1080)
        func pick(_ fps: Int) -> AVCaptureDevice.Format? {
            dev.formats.first { f in
                let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
                let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
                let eightBit = sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange || sub == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
                return d.width == want.0 && d.height == want.1 && eightBit &&
                    f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= Double(fps) - 0.5 }
            }
        }
        var useFps = c.fps
        var format = pick(useFps)
        if format == nil && useFps > 30 { useFps = 30; format = pick(30) }
        guard let f = format else { report("Esta cámara no graba \(c.resolution == "4k" ? "4K" : "1080p") a \(c.fps) fps"); return }
        do {
            try dev.lockForConfiguration()
            dev.activeFormat = f
            let d = CMTime(value: 1, timescale: CMTimeScale(useFps))
            dev.activeVideoMinFrameDuration = d
            dev.activeVideoMaxFrameDuration = d
            dev.unlockForConfiguration()
            actualFps = useFps
            if useFps != c.fps { report("Esta cámara graba a \(useFps) fps en esta resolución") }
        } catch {
            report("No se pudo configurar la cámara: \(error.localizedDescription)")
        }
    }

    private func updateStatus() {
        queue.async {
            guard let dev = self.videoIn?.device else { return }
            let d = CMVideoFormatDescriptionGetDimensions(dev.activeFormat.formatDescription)
            let sec = dev.activeVideoMinFrameDuration.seconds
            let fps = sec > 0 ? Int((1 / sec).rounded()) : self.actualFps
            let mic = AVAudioSession.sharedInstance().currentRoute.inputs.first?.portName ?? "ninguno"
            let mbps = (self.config?.bitrate ?? 0) / 1_000_000
            let text = "\(max(d.width, d.height))×\(min(d.width, d.height)) · \(fps) fps · HEVC · \(mbps) Mbps · Mic: \(mic)"
            DispatchQueue.main.async { self.statusText = text }
        }
    }

    private func report(_ msg: String) {
        DispatchQueue.main.async { self.problem = msg }
    }

    // MARK: - Grabación

    func startRecording() {
        queue.async {
            guard !self.wantRecord else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Teleprompter-\(Self.stamp()).mov")
            try? FileManager.default.removeItem(at: url)
            self.fileURL = url
            self.writer = nil; self.wVideo = nil; self.wAudio = nil
            self.sessionStarted = false
            self.wantRecord = true
        }
    }

    func stopRecording(_ done: @escaping (Result<URL, Error>) -> Void) {
        queue.async {
            self.wantRecord = false
            guard let w = self.writer, self.sessionStarted else {
                self.writer = nil
                DispatchQueue.main.async { done(.failure(NSError(domain: "Teleprompter", code: 1, userInfo: [NSLocalizedDescriptionKey: "La grabación quedó vacía"]))) }
                return
            }
            self.wVideo?.markAsFinished()
            self.wAudio?.markAsFinished()
            w.finishWriting {
                let ok = w.status == .completed, url = w.outputURL, err = w.error
                self.queue.async { self.writer = nil; self.wVideo = nil; self.wAudio = nil; self.sessionStarted = false }
                DispatchQueue.main.async {
                    if ok { done(.success(url)) }
                    else { done(.failure(err ?? NSError(domain: "Teleprompter", code: 2, userInfo: [NSLocalizedDescriptionKey: "No se pudo terminar el archivo"]))) }
                }
            }
        }
    }

    private func setupWriter(_ sb: CMSampleBuffer) {
        guard let url = fileURL, let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        do {
            let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
            let compression: [String: Any] = [
                AVVideoAverageBitRateKey: config?.bitrate ?? 10_000_000,
                AVVideoExpectedSourceFrameRateKey: actualFps,
                AVVideoMaxKeyFrameIntervalKey: actualFps
            ]
            let vs: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: w,
                AVVideoHeightKey: h,
                AVVideoCompressionPropertiesKey: compression
            ]
            let vi = AVAssetWriterInput(mediaType: .video, outputSettings: vs)
            vi.expectsMediaDataInRealTime = true
            guard writer.canAdd(vi) else { report("No se pudo preparar la grabación de video"); return }
            writer.add(vi)
            var ai: AVAssetWriterInput?
            if let rec = audioOut.recommendedAudioSettingsForAssetWriter(writingTo: .mov) as? [String: Any] {
                let a = AVAssetWriterInput(mediaType: .audio, outputSettings: rec)
                a.expectsMediaDataInRealTime = true
                if writer.canAdd(a) { writer.add(a); ai = a }
            }
            self.writer = writer
            wVideo = vi
            wAudio = ai
        } catch {
            report("No se pudo crear el archivo: \(error.localizedDescription)")
        }
    }

    static func stamp() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        return f.string(from: Date())
    }
}

extension CameraController: AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let isVideo = output === videoOut
        if !isVideo {
            onAudioBuffer?(sampleBuffer)
            let now = CACurrentMediaTime()
            if now - lastLevelTime > 0.08, let ch = connection.audioChannels.first {
                lastLevelTime = now
                let level = max(0, min(1, (ch.averagePowerLevel + 50) / 50))   // -50 dB … 0 dB
                DispatchQueue.main.async { self.micLevel = level }
            }
        }
        guard wantRecord else { return }
        if isVideo {
            if writer == nil { setupWriter(sampleBuffer) }
            guard let w = writer else { return }
            if !sessionStarted {
                if w.status == .unknown { w.startWriting() }
                guard w.status == .writing else {
                    report("No se pudo empezar a grabar: \(w.error?.localizedDescription ?? "error")")
                    wantRecord = false
                    return
                }
                w.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
                sessionStarted = true
            }
            if let vi = wVideo, vi.isReadyForMoreMediaData { vi.append(sampleBuffer) }
        } else if sessionStarted, let ai = wAudio, ai.isReadyForMoreMediaData {
            ai.append(sampleBuffer)
        }
    }
}

/// Videos terminados que aún no se guardaron en Fotos. Quedan en la carpeta de la app (visible en Archivos).
enum PendingVideos {
    static var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Videos sin guardar", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func list() -> [URL] {
        let all = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return all.filter { $0.pathExtension.lowercased() == "mov" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// Mueve la grabación terminada a la carpeta de la app (así no se pierde aunque falle Fotos).
    static func keep(_ tmp: URL) -> URL {
        let dest = dir.appendingPathComponent(tmp.lastPathComponent)
        try? FileManager.default.removeItem(at: dest)
        do { try FileManager.default.moveItem(at: tmp, to: dest); return dest } catch { return tmp }
    }

    static func saveToPhotos(_ url: URL, _ done: @escaping (Bool, String?) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { st in
            guard st == .authorized || st == .limited else {
                DispatchQueue.main.async { done(false, "Sin permiso para guardar en Fotos (Ajustes › Teleprompter › Fotos)") }
                return
            }
            PHPhotoLibrary.shared().performChanges({
                let r = PHAssetCreationRequest.forAsset()
                let o = PHAssetResourceCreationOptions()
                o.shouldMoveFile = false
                r.addResource(with: .video, fileURL: url, options: o)
            }) { ok, err in
                if ok { try? FileManager.default.removeItem(at: url) }
                DispatchQueue.main.async { done(ok, err?.localizedDescription) }
            }
        }
    }
}
