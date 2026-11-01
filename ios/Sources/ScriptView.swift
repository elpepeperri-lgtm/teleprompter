import AVFoundation
import SwiftUI
import UIKit

/// Vista de la cámara (solo para verte; la grabación va aparte).
final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.backgroundColor = .black
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }

    func updateUIView(_ v: PreviewView, context: Context) {
        if let c = v.previewLayer.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
    }
}

/// El guion: texto que se desplaza hasta la palabra actual, atenúa lo leído y permite tocar una palabra.
struct ScriptView: UIViewRepresentable {
    let tokens: [ScriptToken]
    let pos: Int
    let fontSize: CGFloat
    let centered: Bool
    let mirrored: Bool
    let autoScroll: Bool
    let speed: Double
    let onTap: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.isSelectable = false
        tv.backgroundColor = .clear
        tv.showsVerticalScrollIndicator = false
        tv.textContainerInset = UIEdgeInsets(top: 14, left: 14, bottom: 600, right: 14)
        tv.textContainer.lineFragmentPadding = 0
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tv.addGestureRecognizer(tap)
        context.coordinator.tv = tv
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.update(self)
    }

    final class Coordinator: NSObject {
        var parent: ScriptView
        weak var tv: UITextView?
        private var ranges: [NSRange] = []
        private var builtKey = ""
        private var shownPos = -1
        private var link: CADisplayLink?
        private var lastTick: CFTimeInterval = 0
        private let dim = UIColor.white.withAlphaComponent(0.38)

        init(_ p: ScriptView) { parent = p }

        func update(_ p: ScriptView) {
            parent = p
            let key = "\(p.tokens.count)|\(p.tokens.map { $0.text.count }.reduce(0, +))|\(p.fontSize)|\(p.centered)"
            if key != builtKey {
                build()
                builtKey = key
                shownPos = -1
            }
            if p.pos != shownPos {
                applyPos(p.pos, animated: shownPos >= 0)
                shownPos = p.pos
            }
            tv?.transform = p.mirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity
            if p.autoScroll && link == nil {
                lastTick = 0
                let l = CADisplayLink(target: self, selector: #selector(tick(_:)))
                l.add(to: .main, forMode: .common)
                link = l
            } else if !p.autoScroll, let l = link {
                l.invalidate()
                link = nil
            }
        }

        private func build() {
            guard let tv = tv else { return }
            let font = UIFont.systemFont(ofSize: parent.fontSize, weight: .semibold)
            let para = NSMutableParagraphStyle()
            para.alignment = parent.centered ? .center : .left
            para.lineSpacing = parent.fontSize * 0.22
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white, .paragraphStyle: para]
            let s = NSMutableAttributedString()
            ranges = []
            for t in parent.tokens {
                let r = NSRange(location: s.length, length: (t.text as NSString).length)
                s.append(NSAttributedString(string: t.text, attributes: attrs))
                if t.index >= 0 { ranges.append(r) }
            }
            tv.attributedText = s
        }

        private func applyPos(_ p: Int, animated: Bool) {
            guard let tv = tv, !ranges.isEmpty else { return }
            let storage = tv.textStorage
            storage.beginEditing()
            let lo = shownPos < 0 ? 0 : min(shownPos, p), hi = shownPos < 0 ? ranges.count : max(shownPos, p)
            var i = max(0, lo)
            while i < min(hi, ranges.count) {
                storage.addAttribute(.foregroundColor, value: i < p ? dim : UIColor.white, range: ranges[i])
                i += 1
            }
            storage.endEditing()
            if link == nil { scroll(to: p, animated: animated) }
        }

        private func scroll(to p: Int, animated: Bool) {
            guard let tv = tv, !ranges.isEmpty else { return }
            let r = ranges[min(p, ranges.count - 1)]
            let lm = tv.layoutManager
            let glyphs = lm.glyphRange(forCharacterRange: r, actualCharacterRange: nil)
            let rect = lm.boundingRect(forGlyphRange: glyphs, in: tv.textContainer)
            let y = max(0, rect.minY + tv.textContainerInset.top - parent.fontSize * 0.35)
            guard abs(tv.contentOffset.y - y) > 2 else { return }
            if animated {
                UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
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
            if tv.isDragging || tv.isDecelerating { return }
            let maxY = max(0, tv.contentSize.height - tv.bounds.height)
            tv.contentOffset.y = min(maxY, tv.contentOffset.y + CGFloat(parent.speed * dt))
        }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = tv, !ranges.isEmpty else { return }
            var pt = g.location(in: tv)
            pt.x -= tv.textContainerInset.left
            pt.y -= tv.textContainerInset.top
            let idx = tv.layoutManager.characterIndex(for: pt, in: tv.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            var best = ranges.count - 1
            for (i, r) in ranges.enumerated() where r.location + r.length > idx { best = i; break }
            parent.onTap(best)
        }
    }
}
