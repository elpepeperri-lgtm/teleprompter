import AVFoundation
import Combine
import SwiftUI

/// Coordina cámara, reconocimiento de voz, guion y grabación.
final class PrompterModel: ObservableObject {
    let camera = CameraController()
    let speech = SpeechFollower()

    @Published var tokens: [ScriptToken] = []
    @Published var version = 0
    @Published var pos = 0
    @Published var total = 0
    @Published var recording = false
    @Published var rehearsing = false
    @Published var countdown = 0
    @Published var elapsed: TimeInterval = 0
    @Published var heard = ""
    @Published var toast: String?
    @Published var saving = false

    private var tracker: Tracker?
    private var timer: Timer?
    private var countTimer: Timer?
    private var startDate: Date?
    private var bag = Set<AnyCancellable>()
    private var toastWork: DispatchWorkItem?
    private(set) var scriptID: UUID?
    weak var store: ScriptStore?
    var settings: AppSettings?

    init() {
        camera.$problem.compactMap { $0 }.receive(on: DispatchQueue.main).sink { [weak self] m in self?.show(m) }.store(in: &bag)
        camera.onAudioBuffer = { [weak self] sb in self?.speech.append(sb) }
        speech.onText = { [weak self] text, fin in self?.apply(text, fin) }
        speech.onRestart = { [weak self] in self?.tracker?.resetSession() }
        speech.onProblem = { [weak self] m in self?.show(m) }
    }

    var active: Bool { recording || rehearsing }
    var following: Bool { active && settings?.scrollMode == "voice" }

    func load(_ s: Script) {
        scriptID = s.id
        tokens = TextNorm.tokenize(s.text)
        let norms = tokens.filter { $0.index >= 0 }.map { $0.norm }
        let t = Tracker(norms: norms, start: s.pos >= norms.count ? 0 : s.pos)
        tracker = t
        total = norms.count
        pos = t.pos
        version += 1
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
        guard !recording && countdown == 0 else { show("Detén la grabación para cambiar la cámara"); return }
        camera.start(cameraConfig())
    }

    func flipCamera() {
        guard let st = settings else { return }
        guard !recording && countdown == 0 else { show("No se puede cambiar de cámara grabando"); return }
        st.front.toggle()
        camera.start(cameraConfig())
    }

    func shutdown() {
        cancelCountdown()
        rehearsing = false
        if recording { stopRecording() }
        speech.stop()
        camera.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: voz

    func syncFollow() {
        if following && !speech.isActive {
            SpeechFollower.authorize { [weak self] ok in
                guard let self = self else { return }
                guard ok else { self.show("Permite el reconocimiento de voz en Ajustes › Teleprompter"); return }
                guard self.following, !self.speech.isActive else { return }
                self.tracker?.resetSession()
                self.heard = ""
                self.speech.start(locale: self.settings?.language ?? "es-CO")
            }
        } else if !following && speech.isActive {
            speech.stop()
            heard = ""
        }
    }

    private func apply(_ text: String, _ fin: Bool) {
        guard let t = tracker else { return }
        let words = TextNorm.speechWords(text)
        let shown = text.split(separator: " ").suffix(6).joined(separator: " ")
        if shown != heard { heard = shown }
        let p = t.update(words, isFinal: fin)
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
        guard !recording && countdown == 0 else { return }
        rehearsing.toggle()
        syncFollow()
    }

    // MARK: grabación

    /// Botón rojo: empieza (con cuenta regresiva si está activada), cancela la cuenta o detiene.
    func recordButton() {
        if recording { stopRecording(); return }
        if countdown > 0 { cancelCountdown(); return }
        guard camera.running else { show("La cámara aún no está lista"); return }
        if settings?.countdown ?? true {
            countdown = 3
            countTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] t in
                guard let self = self else { t.invalidate(); return }
                self.countdown -= 1
                if self.countdown <= 0 { t.invalidate(); self.countTimer = nil; self.startRecording() }
            }
        } else {
            startRecording()
        }
    }

    private func cancelCountdown() {
        countTimer?.invalidate(); countTimer = nil
        countdown = 0
    }

    private func startRecording() {
        countdown = 0
        camera.startRecording()
        recording = true
        rehearsing = false
        startDate = Date()
        elapsed = 0
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self = self, let d = self.startDate else { return }
            self.elapsed = Date().timeIntervalSince(d)
        }
        UIApplication.shared.isIdleTimerDisabled = true
        syncFollow()
    }

    func stopRecording() {
        guard recording else { return }
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

/// Medidor del micrófono (se actualiza solo, sin redibujar la pantalla entera).
struct MicMeter: View {
    @ObservedObject var camera: CameraController

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<8, id: \.self) { i in
                Capsule()
                    .fill(Float(i) / 8 < camera.micLevel ? Color.green : Color.white.opacity(0.25))
                    .frame(width: 3, height: 6 + CGFloat(i) * 1.6)
            }
        }
        .animation(.linear(duration: 0.08), value: camera.micLevel)
    }
}

/// Lo que de verdad está grabando la cámara: resolución, fps, códec y micrófono.
struct CameraStatus: View {
    @ObservedObject var camera: CameraController
    var body: some View {
        Text(camera.statusText.isEmpty ? "Iniciando cámara…" : camera.statusText)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

/// Cuadrícula de tercios para encuadrar.
struct GridOverlay: View {
    var body: some View {
        GeometryReader { g in
            Path { p in
                for i in 1...2 {
                    let x = g.size.width * CGFloat(i) / 3, y = g.size.height * CGFloat(i) / 3
                    p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: g.size.height))
                    p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: g.size.width, y: y))
                }
            }
            .stroke(Color.white.opacity(0.35), lineWidth: 0.7)
        }
        .allowsHitTesting(false)
    }
}

struct TeleprompterView: View {
    let scriptID: UUID
    @EnvironmentObject var store: ScriptStore
    @EnvironmentObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = PrompterModel()
    @State private var showText = false
    @State private var showCamera = false
    @State private var editing: Script?

    var body: some View {
        ZStack {
            CameraPreview(session: model.camera.session).ignoresSafeArea()
            if settings.showGrid { GridOverlay().ignoresSafeArea() }

            VStack(spacing: 8) {
                topBar
                scriptBox
                Spacer()
                bottomPanel
            }

            if model.countdown > 0 {
                Text("\(model.countdown)")
                    .font(.system(size: 120, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .shadow(radius: 12)
                    .transition(.scale.combined(with: .opacity))
                    .id(model.countdown)
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
        .animation(.easeOut(duration: 0.25), value: model.countdown)
        .preferredColorScheme(.dark)
        .onAppear {
            model.store = store
            model.settings = settings
            if let s = store.script(scriptID) { model.load(s) }
            model.startCamera()
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear { model.shutdown() }
        .onChange(of: phase) { _, p in
            // Si sales de la app grabando, se detiene y se guarda (en segundo plano iOS apaga la cámara).
            if p != .active && model.recording { model.stopRecording() }
        }
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

    private var scriptBox: some View {
        VStack(spacing: 0) {
            ScriptView(tokens: model.tokens, version: model.version, pos: model.pos, fontSize: CGFloat(settings.fontSize),
                       centered: settings.centered, mirrored: settings.mirrorText,
                       autoScroll: model.active && settings.scrollMode == "auto", speed: settings.speed,
                       onTap: { model.tap($0) })
            captionBar
        }
        .frame(height: CGFloat(settings.boxHeight))
        .background(Color.black.opacity(settings.bgOpacity))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 10)
    }

    /// Debajo del guion: medidor del micrófono, lo que se está escuchando y el avance.
    private var captionBar: some View {
        HStack(spacing: 8) {
            MicMeter(camera: model.camera)
            Text(captionText)
                .lineLimit(1)
                .truncationMode(.head)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 4)
            Text(progressText).monospacedDigit()
        }
        .font(.caption)
        .foregroundStyle(Color.white.opacity(0.75))
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Color.black.opacity(0.25))
    }

    private var captionText: String {
        if model.following { return model.heard.isEmpty ? "Escuchando… empieza a leer" : model.heard }
        if settings.scrollMode == "voice" { return "Toca ▶ Probar o ● Grabar y el guion seguirá tu voz" }
        return model.active ? "Velocidad automática" : "Toca ▶ Probar o ● Grabar para que avance"
    }

    private var progressText: String {
        guard model.total > 0 else { return "" }
        return "\(Int(Double(model.pos) / Double(model.total) * 100))%"
    }

    private var timerChip: some View {
        let bg: Color = model.recording ? Color.red : Color.black.opacity(0.45)
        return HStack(spacing: 6) {
            if model.recording { Circle().fill(Color.white).frame(width: 8, height: 8) }
            Text(timeString(model.elapsed)).font(.system(.headline, design: .monospaced))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(bg, in: Capsule())
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            circleButton("xmark") {
                if model.recording { model.stopRecording() }
                dismiss()
            }
            circleButton("arrow.triangle.2.circlepath.camera") { model.flipCamera() }
            Spacer()
            timerChip
            Spacer()
            circleButton("arrow.counterclockwise") { model.restart() }
                .disabled(model.recording)
            circleButton("doc.text") {
                if model.recording { model.show("Detén la grabación para editar"); return }
                editing = store.script(scriptID)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
    }

    private var bottomPanel: some View {
        VStack(spacing: 12) {
            modePicker
            if settings.scrollMode == "auto" { speedSlider }
            controlsRow
            statusLine
        }
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    private var modePicker: some View {
        Picker("Desplazamiento", selection: $settings.scrollMode) {
            Text("Seguir mi voz").tag("voice")
            Text("Velocidad automática").tag("auto")
        }
        .pickerStyle(.segmented)
        .onChange(of: settings.scrollMode) { _, _ in model.syncFollow() }
    }

    private var speedSlider: some View {
        HStack {
            Image(systemName: "tortoise")
            Slider(value: $settings.speed, in: 10...150, step: 5)
            Image(systemName: "hare")
        }
    }

    private var controlsRow: some View {
        HStack {
            circleButton("textformat.size", size: 54) { showText = true }
            Spacer()
            rehearseButton
            Spacer()
            recordButton
            Spacer()
            Color.clear.frame(width: 70, height: 1)
            Spacer()
            circleButton("camera", size: 54) {
                if model.recording { model.show("Detén la grabación para cambiar la cámara"); return }
                showCamera = true
            }
        }
    }

    private var rehearseButton: some View {
        let on = model.rehearsing
        let bg: Color = on ? Color.accentColor : Color.white.opacity(0.15)
        return Button(on ? "■ Detener" : "▶ Probar") { model.toggleRehearse() }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(bg, in: Capsule())
            .disabled(model.recording || model.countdown > 0)
    }

    private var recordButton: some View {
        let rec = model.recording
        let side: CGFloat = rec ? 32 : 64
        let radius: CGFloat = rec ? 8 : 32
        return Button { model.recordButton() } label: {
            ZStack {
                Circle().stroke(Color.white, lineWidth: 4).frame(width: 78, height: 78)
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color.red)
                    .frame(width: side, height: side)
                    .animation(.easeInOut(duration: 0.2), value: rec)
            }
        }
        .disabled(model.saving)
    }

    @ViewBuilder private var statusLine: some View {
        if model.saving {
            Text("Guardando en Fotos…").font(.caption2).foregroundStyle(.secondary)
        } else {
            CameraStatus(camera: model.camera)
        }
    }

    private func circleButton(_ icon: String, size: CGFloat = 42, action: @escaping () -> Void) -> some View {
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
