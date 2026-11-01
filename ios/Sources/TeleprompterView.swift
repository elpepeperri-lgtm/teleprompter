import AVFoundation
import Combine
import SwiftUI

/// Coordina cámara, reconocimiento de voz, guion y grabación.
final class PrompterModel: ObservableObject {
    let camera = CameraController()
    let speech = SpeechFollower()

    @Published var tokens: [ScriptToken] = []
    @Published var pos = 0
    @Published var recording = false
    @Published var rehearsing = false
    @Published var elapsed: TimeInterval = 0
    @Published var toast: String?
    @Published var saving = false

    private var tracker: Tracker?
    private var timer: Timer?
    private var startDate: Date?
    private var bag = Set<AnyCancellable>()
    private var toastWork: DispatchWorkItem?
    private(set) var scriptID: UUID?
    weak var store: ScriptStore?
    var settings: AppSettings?

    init() {
        camera.objectWillChange.sink { [weak self] _ in DispatchQueue.main.async { self?.objectWillChange.send() } }.store(in: &bag)
        camera.$problem.compactMap { $0 }.receive(on: DispatchQueue.main).sink { [weak self] m in self?.show(m) }.store(in: &bag)
        camera.onAudioBuffer = { [weak self] sb in self?.speech.append(sb) }
        speech.onWords = { [weak self] words, fin in self?.apply(words, fin) }
        speech.onRestart = { [weak self] in self?.tracker?.resetSession() }
        speech.onProblem = { [weak self] m in self?.show(m) }
    }

    var active: Bool { recording || rehearsing }

    func load(_ s: Script) {
        scriptID = s.id
        tokens = TextNorm.tokenize(s.text)
        let norms = tokens.filter { $0.index >= 0 }.map { $0.norm }
        let t = Tracker(norms: norms, start: s.pos)
        tracker = t
        pos = t.pos
    }

    func cameraConfig() -> CameraController.Config {
        let st = settings ?? AppSettings()
        return .init(front: st.front, resolution: st.resolution, fps: st.fps, bitrate: st.bitrate)
    }

    func startCamera() {
        Task { @MainActor in
            let ok = await CameraController.requestPermissions()
            if !ok { show("Permite la cámara y el micrófono en Ajustes › Teleprompter"); return }
            camera.start(cameraConfig())
        }
    }

    func applyCameraSettings() {
        guard !recording else { show("Detén la grabación para cambiar la cámara"); return }
        camera.start(cameraConfig())
    }

    func shutdown() {
        rehearsing = false
        if recording { stopRecording() }
        speech.stop()
        camera.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: voz

    func syncFollow() {
        let wantVoice = active && settings?.scrollMode == "voice"
        if wantVoice && !speech.isActive {
            SpeechFollower.authorize { [weak self] ok in
                guard let self = self else { return }
                guard ok else { self.show("Permite el reconocimiento de voz en Ajustes › Teleprompter"); return }
                guard self.active else { return }
                self.tracker?.resetSession()
                self.speech.start(locale: self.settings?.language ?? "es-CO")
            }
        } else if !wantVoice {
            speech.stop()
        }
        UIApplication.shared.isIdleTimerDisabled = true
    }

    private func apply(_ words: [String], _ fin: Bool) {
        guard let t = tracker else { return }
        let p = t.update(TextNorm.speechWords(words.joined(separator: " ")), isFinal: fin)
        if p > pos { pos = p; savePos() }
    }

    func tap(_ i: Int) {
        tracker?.setPos(i)
        pos = i
        savePos()
    }

    func restart() { tap(0) }

    private func savePos() {
        if let id = scriptID { store?.setPos(id, pos) }
    }

    func toggleRehearse() {
        guard !recording else { return }
        rehearsing.toggle()
        syncFollow()
    }

    // MARK: grabación

    func toggleRecord() { recording ? stopRecording() : startRecording() }

    private func startRecording() {
        guard camera.running else { show("La cámara aún no está lista"); return }
        camera.startRecording()
        recording = true
        rehearsing = false
        startDate = Date()
        elapsed = 0
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self = self, let d = self.startDate else { return }
            self.elapsed = Date().timeIntervalSince(d)
        }
        syncFollow()
    }

    private func stopRecording() {
        recording = false
        timer?.invalidate(); timer = nil
        syncFollow()
        saving = true
        camera.stopRecording { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let tmp):
                let file = PendingVideos.keep(tmp)            // primero a la carpeta de la app: nunca se pierde
                PendingVideos.saveToPhotos(file) { ok, err in
                    self.saving = false
                    if ok { self.show("✓ Video guardado en Fotos") }
                    else { self.show("No se pudo guardar en Fotos (\(err ?? "error")). Quedó en la app: desde Guiones puedes reintentarlo.") }
                }
            case .failure(let e):
                self.saving = false
                self.show("No se pudo grabar: \(e.localizedDescription)")
            }
        }
    }

    func show(_ m: String) {
        toast = m
        toastWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.toast = nil }
        toastWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: w)
    }
}

struct TeleprompterView: View {
    let scriptID: UUID
    @EnvironmentObject var store: ScriptStore
    @EnvironmentObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = PrompterModel()
    @State private var showText = false
    @State private var showCamera = false
    @State private var editing: Script?

    var body: some View {
        ZStack {
            CameraPreview(session: model.camera.session).ignoresSafeArea()

            VStack(spacing: 10) {
                topBar
                ScriptView(tokens: model.tokens, pos: model.pos, fontSize: CGFloat(settings.fontSize), centered: settings.centered,
                           mirrored: settings.mirrorText, autoScroll: model.active && settings.scrollMode == "auto",
                           speed: settings.speed, onTap: { model.tap($0) })
                    .frame(height: CGFloat(settings.boxHeight))
                    .background(Color.black.opacity(settings.bgOpacity))
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .padding(.horizontal, 12)
                Spacer()
                bottomPanel
            }

            if let t = model.toast {
                VStack {
                    Text(t).font(.subheadline).multilineTextAlignment(.center)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 60).padding(.horizontal, 20)
                    Spacer()
                }
                .transition(.opacity)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            model.store = store
            model.settings = settings
            if let s = store.script(scriptID) { model.load(s) }
            model.startCamera()
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear { model.shutdown() }
        .sheet(isPresented: $showText) {
            TextSettingsView().environmentObject(settings).presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showCamera, onDismiss: { model.applyCameraSettings() }) {
            CameraSettingsView(camera: model.camera).environmentObject(settings).presentationDetents([.medium, .large])
        }
        .sheet(item: $editing, onDismiss: { if let s = store.script(scriptID) { model.load(s) } }) { s in
            EditorView(scriptID: s.id).environmentObject(store)
        }
    }

    private var topBar: some View {
        HStack {
            circleButton("xmark") {
                if model.recording { model.toggleRecord() }
                dismiss()
            }
            Spacer()
            Text(timeString(model.elapsed))
                .font(.system(.headline, design: .monospaced))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(model.recording ? Color.red : Color.black.opacity(0.45), in: Capsule())
            Spacer()
            circleButton("doc.text") {
                if model.recording { model.show("Detén la grabación para editar"); return }
                editing = store.script(scriptID)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }

    private var bottomPanel: some View {
        VStack(spacing: 12) {
            Picker("Desplazamiento", selection: $settings.scrollMode) {
                Text("Seguir mi voz").tag("voice")
                Text("Velocidad automática").tag("auto")
            }
            .pickerStyle(.segmented)
            .onChange(of: settings.scrollMode) { _, _ in model.syncFollow() }

            if settings.scrollMode == "auto" {
                HStack {
                    Image(systemName: "tortoise")
                    Slider(value: $settings.speed, in: 10...150, step: 5)
                    Image(systemName: "hare")
                }
            }

            HStack {
                Button(model.rehearsing ? "■ Detener" : "▶ Probar") { model.toggleRehearse() }
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(model.rehearsing ? Color.accentColor : Color.white.opacity(0.15), in: Capsule())
                    .disabled(model.recording)
                Spacer()
                Button("Volver al inicio") { model.restart() }
                    .font(.subheadline)
                    .disabled(model.recording)
            }

            HStack {
                circleButton("textformat.size", size: 54) { showText = true }
                Spacer()
                Button { model.toggleRecord() } label: {
                    ZStack {
                        Circle().stroke(Color.white, lineWidth: 4).frame(width: 78, height: 78)
                        RoundedRectangle(cornerRadius: model.recording ? 8 : 32, style: .continuous)
                            .fill(Color.red)
                            .frame(width: model.recording ? 32 : 64, height: model.recording ? 32 : 64)
                            .animation(.easeInOut(duration: 0.2), value: model.recording)
                    }
                }
                .disabled(model.saving)
                Spacer()
                circleButton("camera", size: 54) {
                    if model.recording { model.show("Detén la grabación para cambiar la cámara"); return }
                    showCamera = true
                }
            }

            Text(model.saving ? "Guardando en Fotos…" : model.camera.statusText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    private func circleButton(_ icon: String, size: CGFloat = 44, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.4, weight: .semibold))
                .frame(width: size, height: size)
                .background(Color.black.opacity(0.45), in: Circle())
        }
        .foregroundStyle(.white)
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return String(format: "%02d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
    }
}
