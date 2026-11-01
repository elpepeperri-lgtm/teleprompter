import AVFoundation
import Speech

/// Reconocimiento de voz de Apple, dentro del iPhone cuando el idioma lo permite.
/// Recibe el mismo audio que se graba (sin abrir el micrófono otra vez).
final class SpeechFollower {
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let lock = NSLock()
    private var active = false
    private var generation = 0

    /// Palabras de la sesión actual y si el resultado es final (en el hilo principal).
    var onWords: (([String], Bool) -> Void)?
    /// Se empezó una sesión nueva (Apple corta tras silencios): la posición se conserva.
    var onRestart: (() -> Void)?
    var onProblem: ((String) -> Void)?

    static func authorize(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { st in DispatchQueue.main.async { done(st == .authorized) } }
    }

    var isActive: Bool { active }

    func start(locale: String) {
        stop()
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer(locale: Locale(identifier: "es-ES"))
        guard let r = recognizer, r.isAvailable else {
            onProblem?("El reconocimiento de voz no está disponible ahora")
            return
        }
        active = true
        begin()
    }

    private func begin() {
        guard active, let r = recognizer else { return }
        generation += 1
        let gen = generation
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        req.addsPunctuation = false
        if r.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        lock.lock(); request?.endAudio(); request = req; lock.unlock()
        task?.cancel()
        task = r.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let res = result {
                let words = res.bestTranscription.segments.map { $0.substring }
                let fin = res.isFinal
                DispatchQueue.main.async { if self.active && gen == self.generation { self.onWords?(words, fin) } }
            }
            if error != nil || (result?.isFinal ?? false) {
                DispatchQueue.main.asyncAfter(deadline: .now() + (error != nil ? 0.3 : 0.05)) {
                    guard self.active, gen == self.generation else { return }
                    self.onRestart?()
                    self.begin()
                }
            }
        }
    }

    /// Se llama desde la cola de la cámara con cada trozo de audio.
    func append(_ sb: CMSampleBuffer) {
        lock.lock(); let r = request; lock.unlock()
        r?.appendAudioSampleBuffer(sb)
    }

    func stop() {
        active = false
        generation += 1
        lock.lock(); request?.endAudio(); request = nil; lock.unlock()
        task?.cancel()
        task = nil
    }
}
