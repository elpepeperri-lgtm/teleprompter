import Foundation

/// Un trozo del guion: una palabra (index >= 0) o un separador (espacios, rayas…; index = -1).
struct ScriptToken {
    let text: String
    let norm: String
    let index: Int
}

/// Normalización y separación en palabras (igual que tracker.js de la versión web).
enum TextNorm {
    static func normalize(_ s: String) -> String {
        let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es")).lowercased()
        var out = String.UnicodeScalarView()
        for u in folded.unicodeScalars where (97...122).contains(u.value) || (48...57).contains(u.value) { out.append(u) }
        return String(out)
    }

    static func tokenize(_ text: String) -> [ScriptToken] {
        var out: [ScriptToken] = []
        var idx = 0, cur = "", kind = -1
        func flush() {
            guard !cur.isEmpty else { return }
            if kind == 2 {
                let n = normalize(cur)
                if !n.isEmpty { out.append(ScriptToken(text: cur, norm: n, index: idx)); idx += 1 }
                else { out.append(ScriptToken(text: cur, norm: "", index: -1)) }
            } else {
                out.append(ScriptToken(text: cur, norm: "", index: -1))
            }
            cur = ""
        }
        for ch in text {
            let k = ch.isWhitespace ? 0 : ("—–/".contains(ch) ? 1 : 2)
            if k != kind { flush(); kind = k }
            cur.append(ch)
        }
        flush()
        return out
    }

    /// Palabras reconocidas -> lista normalizada
    static func speechWords(_ s: String) -> [String] {
        s.split(whereSeparator: { $0.isWhitespace || "-–—".contains($0) }).map { normalize(String($0)) }.filter { !$0.isEmpty }
    }
}

/// Sigue la posición en el guion a partir de lo que se va reconociendo. Nunca retrocede sola.
final class Tracker {
    let norms: [String]
    private let phons: [String]
    private let window = 15
    private(set) var pos: Int
    // El reconocedor revisa sus resultados parciales; cada actualización se alinea de nuevo desde el inicio
    // de la frase en curso (basePos), así una palabra repetida no se cuenta dos veces.
    private var basePos: Int
    private var cBase = 0
    private var lastLen = 0

    init(norms: [String], start: Int = 0) {
        self.norms = norms
        self.phons = norms.map(Tracker.phon)
        let s = max(0, min(start, norms.count))
        pos = s
        basePos = s
    }

    var done: Bool { pos >= norms.count }

    static func lev(_ a: [UInt8], _ b: [UInt8]) -> Int {
        if a == b { return 0 }
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count), cur = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            cur[0] = i
            for j in 1...b.count {
                let c = a[i - 1] == b[j - 1] ? 0 : 1
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c)
            }
            swap(&prev, &cur)
        }
        return prev[b.count]
    }

    /// Clave fonética del español: iguala errores típicos del reconocedor (v/b, s/z/c, ll/y, h muda, qu/k…)
    static func phon(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "ll", with: "y").replacingOccurrences(of: "qu", with: "k")
        t = t.replacingOccurrences(of: "c(?=[ei])", with: "s", options: .regularExpression)
        t = t.replacingOccurrences(of: "z", with: "s").replacingOccurrences(of: "c", with: "k")
            .replacingOccurrences(of: "v", with: "b").replacingOccurrences(of: "w", with: "b")
            .replacingOccurrences(of: "h", with: "").replacingOccurrences(of: "x", with: "ks")
        return t.replacingOccurrences(of: "(.)\\1+", with: "$1", options: .regularExpression)
    }

    private func similarity(_ a: String, _ b: String) -> Double {
        if a == b { return 1 }
        let d = Tracker.lev(Array(a.utf8), Array(b.utf8))
        return 1 - Double(d) / Double(max(a.count, b.count))
    }

    private func score(_ r: String, _ rp: String, _ j: Int, _ dist: Int, _ tentative: Bool) -> Double {
        let s = norms[j], sl = s.count, rl = r.count
        if dist > 0 && sl < 3 { return 0 }                 // palabras cortas (de, la, y…) solo en su lugar exacto
        if dist > 1 && sl < 4 { return 0 }                 // palabras cortas no justifican saltos
        if r == s { return 1 - 0.04 * Double(dist) }
        if min(rl, sl) <= 2 { return 0 }
        var sim = similarity(r, s)
        if rl >= 3 && rp == phons[j] { sim = max(sim, 0.95) }
        var minS = max(rl, sl) <= 4 ? 0.75 : 0.7
        if tentative && rl >= 2 && rl < sl && s.hasPrefix(r) { sim = max(sim, 0.9) }   // palabra a medias
        if dist > 2 {
            if sl < 4 { return 0 }
            minS = 0.8
        }
        return sim >= minS ? sim - 0.04 * Double(dist) : 0
    }

    private func find(_ r: String, from: Int, tentative: Bool) -> Int {
        var best = -1, bestScore = 0.0
        let end = min(norms.count, from + window), rp = Tracker.phon(r)
        var j = from
        while j < end {
            let sc = score(r, rp, j, j - from, tentative)
            if sc > bestScore { bestScore = sc; best = j }
            j += 1
        }
        return best
    }

    /// words: lista completa (normalizada) de la sesión de reconocimiento actual.
    @discardableResult
    func update(_ words: [String], isFinal: Bool) -> Int {
        let n = words.count
        if n < cBase { cBase = 0; basePos = pos }
        var p = basePos
        var i = cBase
        while i < n {
            let j = find(words[i], from: p, tentative: !isFinal && i == n - 1)
            if j >= 0 { p = j + 1 }
            i += 1
        }
        lastLen = n
        if isFinal { cBase = n; basePos = max(p, pos) }
        if p > pos { pos = p }
        return pos
    }

    func resetSession() { cBase = 0; lastLen = 0; basePos = pos }

    /// Salto manual (toque en una palabra); puede ir hacia atrás.
    func setPos(_ p: Int) {
        pos = max(0, min(p, norms.count))
        basePos = pos
        cBase = lastLen
    }
}
