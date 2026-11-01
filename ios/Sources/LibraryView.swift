import SwiftUI

@main
struct TeleprompterApp: App {
    @StateObject private var store = ScriptStore()
    @StateObject private var settings = AppSettings()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environmentObject(store)
                .environmentObject(settings)
                .preferredColorScheme(.dark)
        }
    }
}

struct LibraryView: View {
    @EnvironmentObject var store: ScriptStore
    @EnvironmentObject var settings: AppSettings
    @Environment(\.scenePhase) private var phase
    @State private var query = ""
    @State private var opening: Script?
    @State private var editing: Script?
    @State private var newID: UUID?
    @State private var pending: [URL] = []
    @State private var pendingMsg: String?

    private var filtered: [Script] {
        let q = TextNorm.normalize(query)
        guard !q.isEmpty else { return store.sorted }
        return store.sorted.filter { TextNorm.normalize($0.title + " " + $0.text).contains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                if !pending.isEmpty {
                    Section {
                        Button {
                            savePending()
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(pending.count) video(s) sin guardar en Fotos").font(.headline)
                                Text(pendingMsg ?? "Toca para guardarlos. También están en Archivos › En mi iPhone › Teleprompter.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                ForEach(filtered) { s in
                    Button { opening = s } label: { row(s) }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { store.delete(s.id) } label: { Label("Eliminar", systemImage: "trash") }
                            Button { editing = s } label: { Label("Editar", systemImage: "pencil") }.tint(.blue)
                        }
                        .contextMenu {
                            Button { editing = s } label: { Label("Editar", systemImage: "pencil") }
                            Button { store.duplicate(s.id) } label: { Label("Duplicar", systemImage: "plus.square.on.square") }
                            Button(role: .destructive) { store.delete(s.id) } label: { Label("Eliminar", systemImage: "trash") }
                        }
                }
                if filtered.isEmpty {
                    Text(query.isEmpty ? "Aún no tienes guiones. Toca “Nuevo guion”." : "No hay guiones que coincidan.")
                        .foregroundStyle(.secondary)
                }
            }
            .searchable(text: $query, prompt: "Buscar por título o contenido")
            .navigationTitle("Guiones")
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Button {
                        let s = store.create()
                        newID = s.id
                        editing = s
                    } label: {
                        Label("Nuevo guion", systemImage: "plus.circle.fill").font(.headline)
                    }
                }
            }
            .fullScreenCover(item: $opening, onDismiss: { pending = PendingVideos.list() }) { s in
                TeleprompterView(scriptID: s.id)
                    .environmentObject(store)
                    .environmentObject(settings)
            }
            .sheet(item: $editing, onDismiss: dropEmptyNew) { s in
                EditorView(scriptID: s.id).environmentObject(store)
            }
            .onAppear { pending = PendingVideos.list() }
            .onChange(of: phase) { _, p in if p == .active { pending = PendingVideos.list() } }
        }
    }

    private func row(_ s: Script) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(s.title.isEmpty ? "Sin título" : s.title).font(.headline).foregroundStyle(.primary)
            Text(s.text.replacingOccurrences(of: "\n", with: " ")).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            Text(s.updated.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    /// Un guion nuevo que se cerró sin escribir nada no se guarda.
    private func dropEmptyNew() {
        if let id = newID, let s = store.script(id), s.title.isEmpty, s.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            store.delete(id)
        }
        newID = nil
    }

    private func savePending() {
        let files = pending
        pendingMsg = "Guardando…"
        var left = files.count, fails = 0
        for f in files {
            PendingVideos.saveToPhotos(f) { ok, _ in
                if !ok { fails += 1 }
                left -= 1
                if left == 0 {
                    pending = PendingVideos.list()
                    pendingMsg = fails == 0 ? nil : "No se pudieron guardar \(fails). Revisa el permiso de Fotos en Ajustes."
                }
            }
        }
    }
}

struct EditorView: View {
    let scriptID: UUID
    @EnvironmentObject var store: ScriptStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var text = ""
    @State private var loaded = false

    private var words: Int { text.split(whereSeparator: { $0.isWhitespace }).count }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Título del guion", text: $title)
                    .font(.title2.bold())
                    .padding(.horizontal)
                TextEditor(text: $text)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 10)
                Text("\(words) palabras · se guarda solo")
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal).padding(.bottom, 8)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Listo") { save(); dismiss() } }
            }
            .onAppear {
                guard !loaded, let s = store.script(scriptID) else { return }
                title = s.title; text = s.text; loaded = true
            }
            .onChange(of: title) { _, _ in save() }
            .onChange(of: text) { _, _ in save() }
            .onDisappear { save(); store.saveNow() }
        }
    }

    private func save() {
        guard loaded else { return }
        store.update(scriptID, title: title, text: text)
    }
}

struct TextSettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Texto") {
                    VStack(alignment: .leading) {
                        Text("Tamaño: \(Int(settings.fontSize))")
                        Slider(value: $settings.fontSize, in: 20...80, step: 1)
                    }
                    VStack(alignment: .leading) {
                        Text("Alto del recuadro: \(Int(settings.boxHeight))")
                        Slider(value: $settings.boxHeight, in: 150...620, step: 10)
                    }
                    VStack(alignment: .leading) {
                        Text("Opacidad del fondo: \(Int(settings.bgOpacity * 100))%")
                        Slider(value: $settings.bgOpacity, in: 0...1, step: 0.05)
                    }
                    Toggle("Centrar texto", isOn: $settings.centered)
                    Toggle("Espejo del texto (para vidrio de teleprompter)", isOn: $settings.mirrorText)
                }
                Section("Seguimiento de voz") {
                    Picker("Idioma", selection: $settings.language) {
                        Text("Español (Colombia)").tag("es-CO")
                        Text("Español (México)").tag("es-MX")
                        Text("Español (España)").tag("es-ES")
                        Text("Español (EE. UU.)").tag("es-US")
                    }
                    VStack(alignment: .leading) {
                        Text("Velocidad automática: \(Int(settings.speed)) pt/s")
                        Slider(value: $settings.speed, in: 10...150, step: 5)
                    }
                }
            }
            .navigationTitle("Texto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } } }
        }
    }
}

struct CameraSettingsView: View {
    @ObservedObject var camera: CameraController
    @EnvironmentObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(camera.statusText.isEmpty ? "Iniciando cámara…" : camera.statusText)
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Cámara") {
                    Picker("Cámara", selection: $settings.front) {
                        Text("Frontal").tag(true)
                        Text("Trasera").tag(false)
                    }
                    .pickerStyle(.segmented)
                    Picker("Resolución", selection: $settings.resolution) {
                        Text("1080p").tag("1080")
                        Text("4K").tag("4k")
                    }
                    .pickerStyle(.segmented)
                    Picker("Fotogramas por segundo", selection: $settings.fps) {
                        Text("24 fps").tag(24)
                        Text("30 fps").tag(30)
                        Text("60 fps").tag(60)
                    }
                    .pickerStyle(.segmented)
                    Picker("Calidad", selection: $settings.quality) {
                        Text("Máxima").tag("max")
                        Text("Alta").tag("high")
                    }
                    .pickerStyle(.segmented)
                    Text("≈ \(Int(Double(settings.bitrate) * 60 / 8 / 1_048_576)) MB por minuto · HEVC (formato de la cámara del iPhone)")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Micrófono") {
                    if camera.inputs.isEmpty {
                        Text("Sin micrófonos").foregroundStyle(.secondary)
                    } else {
                        Picker("Micrófono", selection: Binding(get: { camera.currentInputUID }, set: { camera.selectInput(uid: $0) })) {
                            ForEach(camera.inputs, id: \.uid) { p in Text(p.portName).tag(p.uid) }
                        }
                    }
                    Text("Si conectas un micrófono externo (USB-C, como el receptor del Lark M2), la app lo usa sola. El audio se graba sin el filtro de llamadas de iOS.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Cámara")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } } }
        }
    }
}
