import Foundation
import SwiftUI

struct Script: Identifiable, Codable, Equatable {
    var id = UUID()
    var title: String
    var text: String
    var created = Date()
    var updated = Date()
    var pos = 0
}

/// Guiones guardados en el iPhone (Documentos/guiones.json).
final class ScriptStore: ObservableObject {
    @Published private(set) var scripts: [Script] = []
    private let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("guiones.json")
    private var saveWork: DispatchWorkItem?

    static let sample = """
    Hola, bienvenidos a mi canal. Hoy quiero hablarles de tres hábitos que cambiaron mi vida.

    El primero es levantarme temprano: la mañana es el mejor momento para concentrarme y avanzar en lo importante.

    El segundo es leer todos los días, aunque sean solo diez minutos. Con el tiempo, esos minutos se convierten en libros enteros.

    Y el tercero, quizás el más importante, es agradecer antes de dormir. Termino el día recordando tres cosas buenas que me pasaron.

    Si te gustó este video, suscríbete y cuéntame en los comentarios cuál es tu hábito favorito. ¡Nos vemos en el próximo video!
    """

    init() {
        if let d = try? Data(contentsOf: url), let s = try? JSONDecoder().decode([Script].self, from: d) { scripts = s }
        if scripts.isEmpty { scripts = [Script(title: "Guion de ejemplo", text: ScriptStore.sample)]; saveNow() }
    }

    var sorted: [Script] { scripts.sorted { $0.updated > $1.updated } }

    func script(_ id: UUID) -> Script? { scripts.first { $0.id == id } }

    func saveNow() {
        saveWork?.cancel()
        if let d = try? JSONEncoder().encode(scripts) { try? d.write(to: url, options: .atomic) }
    }
    private func saveSoon() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: w)
    }

    func create() -> Script {
        let s = Script(title: "", text: "")
        scripts.append(s); saveNow()
        return s
    }
    func update(_ id: UUID, title: String, text: String) {
        guard let i = scripts.firstIndex(where: { $0.id == id }) else { return }
        if scripts[i].title == title && scripts[i].text == text { return }
        if scripts[i].text != text { scripts[i].pos = 0 }
        scripts[i].title = title; scripts[i].text = text; scripts[i].updated = Date()
        saveSoon()
    }
    func setPos(_ id: UUID, _ p: Int) {
        guard let i = scripts.firstIndex(where: { $0.id == id }), scripts[i].pos != p else { return }
        scripts[i].pos = p
        saveSoon()
    }
    func duplicate(_ id: UUID) {
        guard let s = script(id) else { return }
        scripts.append(Script(title: (s.title.isEmpty ? "Sin título" : s.title) + " (copia)", text: s.text))
        saveNow()
    }
    func delete(_ id: UUID) {
        scripts.removeAll { $0.id == id }
        saveNow()
    }
}

/// Ajustes (se guardan solos en el iPhone).
final class AppSettings: ObservableObject {
    private let d = UserDefaults.standard

    @Published var fontSize: Double { didSet { d.set(fontSize, forKey: "fontSize") } }
    @Published var boxHeight: Double { didSet { d.set(boxHeight, forKey: "boxHeight") } }
    @Published var bgOpacity: Double { didSet { d.set(bgOpacity, forKey: "bgOpacity") } }
    @Published var centered: Bool { didSet { d.set(centered, forKey: "centered") } }
    @Published var mirrorText: Bool { didSet { d.set(mirrorText, forKey: "mirrorText") } }
    @Published var scrollMode: String { didSet { d.set(scrollMode, forKey: "scrollMode") } }   // "voice" | "auto"
    @Published var speed: Double { didSet { d.set(speed, forKey: "speed") } }                 // puntos por segundo
    @Published var language: String { didSet { d.set(language, forKey: "language") } }
    @Published var front: Bool { didSet { d.set(front, forKey: "front") } }
    @Published var resolution: String { didSet { d.set(resolution, forKey: "resolution") } }  // "1080" | "4k"
    @Published var fps: Int { didSet { d.set(fps, forKey: "fps") } }
    @Published var quality: String { didSet { d.set(quality, forKey: "quality") } }           // "max" | "high"
    @Published var countdown: Bool { didSet { d.set(countdown, forKey: "countdown") } }       // 3-2-1 antes de grabar
    @Published var showGrid: Bool { didSet { d.set(showGrid, forKey: "showGrid") } }
    @Published var mirrorTextV: Bool { didSet { d.set(mirrorTextV, forKey: "mirrorTextV") } }
    @Published var alignment: String { didSet { d.set(alignment, forKey: "alignment") } }    // "left" | "center" | "right"
    @Published var fontStyle: String { didSet { d.set(fontStyle, forKey: "fontStyle") } }    // "normal" | "rounded" | "serif"
    @Published var readAtTop: Bool { didSet { d.set(readAtTop, forKey: "readAtTop") } }      // palabra actual arriba (como la web)
    @Published var boxTop: Double { didSet { d.set(boxTop, forKey: "boxTop") } }             // distancia del recuadro al borde superior
    @Published var mirrorPreview: Bool { didSet { d.set(mirrorPreview, forKey: "mirrorPreview") } }     // verte en espejo
    @Published var mirrorRecording: Bool { didSet { d.set(mirrorRecording, forKey: "mirrorRecording") } } // el video sale en espejo
    @Published var zoom: Double { didSet { d.set(zoom, forKey: "zoom") } }

    init() {
        fontSize = d.object(forKey: "fontSize") as? Double ?? 34
        boxHeight = d.object(forKey: "boxHeight") as? Double ?? 300
        bgOpacity = d.object(forKey: "bgOpacity") as? Double ?? 0.55
        centered = d.object(forKey: "centered") as? Bool ?? false
        mirrorText = d.object(forKey: "mirrorText") as? Bool ?? false
        scrollMode = d.string(forKey: "scrollMode") ?? "voice"
        speed = d.object(forKey: "speed") as? Double ?? 40
        language = d.string(forKey: "language") ?? "es-CO"
        front = d.object(forKey: "front") as? Bool ?? true
        resolution = d.string(forKey: "resolution") ?? "1080"
        fps = d.object(forKey: "fps") as? Int ?? 60
        quality = d.string(forKey: "quality") ?? "max"
        countdown = d.object(forKey: "countdown") as? Bool ?? true
        showGrid = d.object(forKey: "showGrid") as? Bool ?? false
        mirrorTextV = d.object(forKey: "mirrorTextV") as? Bool ?? false
        let wasCentered = d.object(forKey: "centered") as? Bool ?? false
        alignment = d.string(forKey: "alignment") ?? (wasCentered ? "center" : "left")
        fontStyle = d.string(forKey: "fontStyle") ?? "normal"
        readAtTop = d.object(forKey: "readAtTop") as? Bool ?? true
        boxTop = d.object(forKey: "boxTop") as? Double ?? 0
        mirrorPreview = d.object(forKey: "mirrorPreview") as? Bool ?? true
        mirrorRecording = d.object(forKey: "mirrorRecording") as? Bool ?? false
        zoom = d.object(forKey: "zoom") as? Double ?? 1
    }

    /// Bitrate HEVC en bits/s. "Máxima" ≈ lo que graba la app Cámara (o un poco más).
    var bitrate: Int {
        let hi = fps >= 60
        let mbps: Double
        switch (resolution, quality) {
        case ("4k", "max"): mbps = hi ? 50 : 30
        case ("4k", _): mbps = hi ? 32 : 20
        case (_, "max"): mbps = hi ? 16 : 10
        default: mbps = hi ? 11 : 7
        }
        return Int(mbps * 1_000_000)
    }
}
