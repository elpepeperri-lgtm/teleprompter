import AVFoundation
import SwiftUI
import UIKit

/// Vista de la cámara (solo para verte; la grabación va aparte).
final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    var mirrored = true
    private var timer: Timer?

    /// Vertical y espejo según el ajuste. La conexión aparece cuando la cámara arranca (o cambia), así que se
    /// revisa también unas veces por segundo hasta que exista.
    func applyConnection() {
        guard let c = previewLayer.connection else {
            if timer == nil {
                timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.applyConnection() }
            }
            return
        }
        if c.isVideoRotationAngleSupported(90) && c.videoRotationAngle != 90 { c.videoRotationAngle = 90 }
        if c.isVideoMirroringSupported {
            if c.automaticallyAdjustsVideoMirroring { c.automaticallyAdjustsVideoMirroring = false }
            if c.isVideoMirrored != mirrored { c.isVideoMirrored = mirrored }
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        applyConnection()
    }

    deinit { timer?.invalidate() }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    let mirrored: Bool

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.backgroundColor = .black
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }

    func updateUIView(_ v: PreviewView, context: Context) {
        v.mirrored = mirrored
        v.applyConnection()
    }
}

/// UITextView que avisa cuando cambia de tamaño (para recolocar la palabra actual).
final class PrompterTextView: UITextView {
    var onResize: (() -> Void)?
    private var lastSize = CGSize.zero

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != lastSize {
            lastSize = bounds.size
            onResize?()
        }
    }
}

/// El guion: se desplaza hasta la palabra actual, atenúa lo leído y permite tocar una palabra para saltar.
/// Usa TextKit 1 creado a mano: así la posición de cada palabra en pantalla es siempre exacta.
struct ScriptView: UIViewRepresentable {
    let tokens: [ScriptToken]
    let version: Int          // cambia cuando cambia el texto del guion
    let pos: Int
    let fontSize: CGFloat
    let alignment: String     // "left" | "center" | "right"
    let fontStyle: String     // "normal" | "rounded" | "serif"
    let mirrorH: Bool
    let mirrorV: Bool
    let readAtTop: Bool       // la palabra actual va a la primera línea (como la web) o al primer tercio
    let autoScroll: Bool
    let speed: Double
    let onTap: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PrompterTextView {
        let c = context.coordinator
        c.storage.addLayoutManager(c.layout)
        c.container.widthTracksTextView = true
        c.container.lineFragmentPadding = 0
        c.layout.addTextContainer(c.container)

        let tv = PrompterTextView(frame: CGRect(x: 0, y: 0, width: 300, height: 300), textContainer: c.container)
        tv.isEditable = false
        tv.isSelectable = false
        tv.backgroundColor = .clear
        tv.showsVerticalScrollIndicator = false
        tv.alwaysBounceVertical = true
        tv.textContainerInset = UIEdgeInsets(top: 14, left: 16, bottom: 300, right: 16)
        tv.addGestureRecognizer(UITapGestureRecognizer(target: c, action: #selector(Coordinator.tapped(_:))))
        tv.onResize = { [weak c] in c?.resized() }
        c.tv = tv
        return tv
    }

    func updateUIView(_ tv: PrompterTextView, context: Context) {
        context.coordinator.update(self)
    }

    final class Coordinator: NSObject {
        var parent: ScriptView
        weak var tv: PrompterTextView?
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 300, height: CGFloat.greatestFiniteMagnitude))

        private var ranges: [NSRange] = []
        private var builtKey = ""
        private var shownPos = -1
        private var link: CADisplayLink?
        private var lastTick: CFTimeInterval = 0
        private let dim = UIColor.white.withAlphaComponent(0.35)
        private var lastReadAtTop = true

        init(_ p: ScriptView) { parent = p }

        func update(_ p: ScriptView) {
            parent = p
            let key = "\(p.version)|\(p.fontSize)|\(p.alignment)|\(p.fontStyle)"
            if key != builtKey {
                build()
                builtKey = key
                shownPos = -1
            }
            let lineChanged = p.readAtTop != lastReadAtTop
            lastReadAtTop = p.readAtTop
            if p.pos != shownPos {
                recolor(from: shownPos, to: p.pos)
                let first = shownPos < 0
                shownPos = p.pos
                if link == nil { scrollToCurrent(animated: !first) }
            } else if lineChanged && link == nil {
                scrollToCurrent(animated: true)
            }
            tv?.transform = CGAffineTransform(scaleX: p.mirrorH ? -1 : 1, y: p.mirrorV ? -1 : 1)
            if p.autoScroll && link == nil {
                lastTick = 0
                let l = CADisplayLink(target: self, selector: #selector(tick(_:)))
                l.add(to: .main, forMode: .common)
                link = l
            } else if !p.autoScroll, let l = link {
                l.invalidate()
                link = nil
                scrollToCurrent(animated: true)
            }
        }

        private func build() {
            var font = UIFont.systemFont(ofSize: parent.fontSize, weight: .semibold)
            let design: UIFontDescriptor.SystemDesign? = parent.fontStyle == "rounded" ? .rounded : parent.fontStyle == "serif" ? .serif : nil
            if let ds = design, let fd = font.fontDescriptor.withDesign(ds) { font = UIFont(descriptor: fd, size: parent.fontSize) }
            let para = NSMutableParagraphStyle()
            para.alignment = parent.alignment == "center" ? .center : parent.alignment == "right" ? .right : .left
            para.lineSpacing = parent.fontSize * 0.25
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white, .paragraphStyle: para]
            let s = NSMutableAttributedString()
            ranges = []
            for t in parent.tokens {
                let r = NSRange(location: s.length, length: (t.text as NSString).length)
                s.append(NSAttributedString(string: t.text, attributes: attrs))
                if t.index >= 0 { ranges.append(r) }
            }
            if ranges.isEmpty {
                s.append(NSAttributedString(string: "Este guion está vacío. Toca el ícono de documento para escribirlo.", attributes: attrs))
            }
            storage.setAttributedString(s)
        }

        /// Lo ya leído se atenúa; solo se repintan las palabras que cambiaron.
        private func recolor(from old: Int, to p: Int) {
            guard !ranges.isEmpty else { return }
            let lo = old < 0 ? 0 : min(old, p), hi = old < 0 ? ranges.count : max(old, p)
            guard lo < hi else { return }
            storage.beginEditing()
            for i in max(0, lo)..<min(hi, ranges.count) {
                storage.addAttribute(.foregroundColor, value: i < p ? dim : UIColor.white, range: ranges[i])
            }
            storage.endEditing()
        }

        func resized() {
            guard let tv = tv else { return }
            // Espacio al final para que las últimas líneas también lleguen a la línea de lectura.
            let bottom = max(200, tv.bounds.height * 0.8)
            if abs(tv.textContainerInset.bottom - bottom) > 1 { tv.textContainerInset.bottom = bottom }
            if link == nil { scrollToCurrent(animated: false) }
        }

        /// Lleva la línea de la palabra actual a la parte de arriba del recuadro (como la web),
        /// o al primer tercio si se eligió así, para ver también la línea anterior.
        private func scrollToCurrent(animated: Bool) {
            guard let tv = tv, !ranges.isEmpty, tv.bounds.height > 0 else { return }
            let r = ranges[min(max(shownPos, 0), ranges.count - 1)]
            layout.ensureLayout(for: container)
            let glyphs = layout.glyphRange(forCharacterRange: r, actualCharacterRange: nil)
            let rect = layout.boundingRect(forGlyphRange: glyphs, in: container)
            let margin = parent.readAtTop ? parent.fontSize * 0.2 : tv.bounds.height * 0.22
            // La línea queda a (margen superior del texto + margin) del borde de arriba del recuadro.
            var y = rect.minY - margin
            let used = layout.usedRect(for: container).height + tv.textContainerInset.top + tv.textContainerInset.bottom
            let maxY = max(0, max(tv.contentSize.height, used) - tv.bounds.height)
            y = min(max(0, y), maxY)
            guard abs(tv.contentOffset.y - y) > 1 else { return }
            if animated {
                UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction]) {
                    tv.contentOffset = CGPoint(x: 0, y: y)
                }
            } else {
                tv.contentOffset = CGPoint(x: 0, y: y)
            }
        }

        @objc func tick(_ l: CADisplayLink) {
            guard let tv = tv else { return }
            if lastTick == 0 { lastTick = l.timestamp; return }
            let dt = min(0.1, l.timestamp - lastTick)
            lastTick = l.timestamp
            if tv.isDragging || tv.isDecelerating || tv.isTracking { return }
            let maxY = max(0, tv.contentSize.height - tv.bounds.height)
            tv.contentOffset.y = min(maxY, tv.contentOffset.y + CGFloat(parent.speed * dt))
        }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = tv, !ranges.isEmpty else { return }
            var pt = g.location(in: tv)
            pt.x -= tv.textContainerInset.left
            pt.y -= tv.textContainerInset.top
            layout.ensureLayout(for: container)
            let idx = layout.characterIndex(for: pt, in: container, fractionOfDistanceBetweenInsertionPoints: nil)
            var best = ranges.count - 1
            for (i, r) in ranges.enumerated() where r.location + r.length > idx { best = i; break }
            parent.onTap(best)
        }
    }
}
