import AVFoundation
import Speech

/// Marca compartida entre los avisos del reconocedor.
private final class Flag { var value = false }

/// Reconocimiento de voz de Apple. Recibe el mismo audio que se graba (sin abrir el micrófono otra vez).
/// Intenta primero dentro del iPhone; si eso falla, usa el de Apple en línea.
final class SpeechFollower {
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let lock = NSLock()
    private var active = false
    private var generation = 0
    private var preferOnDevice = true
    private var failsInARow = 0

    /// Texto reconocido en la sesión actual y si es final (en el hilo principal).
    var onText: ((String, Bool) -> Void)?
    /// Empezó una sesión nueva (Apple corta tras silencios o al minuto): la posición se conserva.
    var onRestart: (() -> Void)?
    var onProblem: ((String) -> Void)?

    static func authorize(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { st in DispatchQueue.main.async { done(st == .authorized) } }
    }

    var isActive: Bool { active }

    /// Idioma pedido y, si no existe en este iPhone, otros tipos de español.
    private static func makeRecognizer(_ locale: String) -> SFSpeechRecognizer? {
        for id in [locale, "es-MX", "es-US", "es-ES"] {
            if let r = SFSpeechRecognizer(locale: Locale(identifier: id)) { return r }
        }
        return nil
    }

    func start(locale: String) {
        stop()
        recognizer = SpeechFollower.makeRecognizer(locale)
        guard let r = recognizer else {
            onProblem?("Este iPhone no tiene reconocimiento de voz en español")
            return
        }
        if !r.isAvailable && !r.supportsOnDeviceRecognition {
            onProblem?("El reconocimiento de voz necesita internet en este momento")
        }
        failsInARow = 0
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
        req.requiresOnDeviceRecognition = preferOnDevice && r.supportsOnDeviceRecognition
        lock.lock(); request?.endAudio(); request = req; lock.unlock()
        task?.cancel()
        let got = Flag()
        task = r.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let res = result {
                got.value = true
                let text = res.bestTranscription.formattedString
                let fin = res.isFinal
                DispatchQueue.main.async {
                    guard self.active, gen == self.generation else { return }
                    self.failsInARow = 0
                    self.onText?(text, fin)
                }
            }
            let ended = error != nil || (result?.isFinal ?? false)
            guard ended else { return }
            let failed = error != nil && !got.value
            DispatchQueue.main.async {
                guard self.active, gen == self.generation else { return }
                if failed {
                    self.failsInARow += 1
                    // Dentro del iPhone no funcionó dos veces seguidas: pasar al reconocimiento en línea.
                    if self.failsInARow >= 2 && self.preferOnDevice { self.preferOnDevice = false; self.failsInARow = 0 }
                }
                let wait = failed ? min(2.0, 0.3 * Double(max(1, self.failsInARow))) : 0.05
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
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
