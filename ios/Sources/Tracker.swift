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

/// Sigue la posición en el guion comparando las últimas palabras oídas, en orden, con el texto.
/// Una palabra suelta solo avanza a la siguiente: para saltar hace falta una secuencia de palabras seguidas,
/// así las palabras repetidas no mueven el guion. Cada actualización se calcula desde cero con esas últimas
/// palabras, de modo que un reinicio del reconocedor o un trozo de audio perdido no deja el guion atascado.
final class Tracker {
    let norms: [String]
    private let ids: [Int]            // palabra del guion -> índice en vocab
    private let vocab: [String]
    private let vocabPhons: [String]
    private let weights: [Double]
    private(set) var pos: Int

    private let tailSize = 8          // palabras oídas que se comparan
    private let back = 150            // hasta dónde se busca hacia atrás…
    private let ahead = 800           // …y hacia adelante
    private let gapHeard = 0.35       // costo de una palabra oída que no está en el guion
    private let gapScript = 0.15      // costo de una palabra del guion que no se oyó
    private let backRun = 5           // palabras seguidas necesarias para retroceder
    private let nearTolerance = 1.4   // cuánto peor puede encajar lo nuevo en un sitio cercano y aun así preferirlo

    private var carry: [String] = []  // últimas palabras de la sesión anterior del reconocedor
    private var recent: [String] = []
    private var skip = 0              // palabras de la sesión actual que ya no cuentan (tras un toque)
    private var lastLen = 0
    private var prev: [String] = []   // transcripción anterior, para saber qué palabras son nuevas
    private var fresh = 0             // palabras oídas desde el último avance: las únicas que justifican moverse
    private var rows: [String: [Double]] = [:]

    init(norms: [String], start: Int = 0) {
        self.norms = norms
        var seen: [String: Int] = [:], words: [String] = []
        ids = norms.map { w in
            if let i = seen[w] { return i }
            seen[w] = words.count
            words.append(w)
            return words.count - 1
        }
        vocab = words
        vocabPhons = words.map(Tracker.phon)
        // Las palabras cortas (de, la, que…) aparecen en todas partes: cuentan menos como prueba.
        weights = norms.map { $0.utf8.count <= 2 ? 0.4 : $0.utf8.count == 3 ? 0.6 : 1 }
        pos = max(0, min(start, norms.count))
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
        return 1 - Double(d) / Double(max(a.utf8.count, b.utf8.count))
    }

    /// Parecido (0…1) de una palabra oída con cada palabra distinta del guion.
    private func likeness(_ r: String, tentative: Bool) -> [Double] {
        var row: [Double]
        if let cached = rows[r] {
            row = cached
        } else {
            let rl = r.utf8.count, rp = Tracker.phon(r)
            row = vocab.indices.map { v in
                let s = vocab[v], sl = s.utf8.count
                if r == s { return 1 }
                if min(rl, sl) <= 2 { return 0 }
                var sim = similarity(r, s)
                if rl >= 3 && rp == vocabPhons[v] { sim = max(sim, 0.95) }
                return sim >= (max(rl, sl) <= 4 ? 0.75 : 0.7) ? sim : 0
            }
            if rows.count > 400 { rows.removeAll() }
            rows[r] = row
        }
        if tentative && r.utf8.count >= 3 {                  // palabra a medias
            for v in vocab.indices where vocab[v].utf8.count > r.utf8.count && vocab[v].hasPrefix(r) { row[v] = max(row[v], 0.9) }
        }
        return row
    }

    /// Prueba necesaria para avanzar d palabras: cuanto más lejos, más palabras seguidas.
    private func enough(_ d: Int, _ evidence: Double, _ run: Int) -> Bool {
        if d == 1 { return evidence >= 0.4 }
        if d <= 3 { return evidence >= 1 }
        if d <= 8 { return evidence >= 2 }
        if d <= 30 { return evidence >= 3 && run >= 3 }
        return evidence >= 4 && run >= 4
    }

    /// Entre dos sitios iguales gana el más cercano.
    private func distancePenalty(_ d: Int) -> Double { min(1.5, 0.04 * Double(d)) }

    /// Alinea las últimas palabras oídas con el guion, conservando el orden de ambos.
    private func align(_ tail: [String], tentative: Bool) {
        let lo = max(0, pos - back), hi = min(norms.count, pos + ahead), cols = hi - lo
        guard cols > 0 else { return }
        let freshFrom = tail.count - fresh
        var pH = [Double](repeating: 0, count: cols + 1), pE = pH, pR = [Int](repeating: 0, count: cols + 1)
        var cH = pH, cE = pH, cR = pR
        for (i, r) in tail.enumerated() {
            let row = likeness(r, tentative: tentative && i == tail.count - 1)
            for c in 1...cols {
                let j = lo + c - 1
                let m = row[ids[j]] * weights[j]
                var h = 0.0, e = 0.0, q = 0
                if m > 0 {
                    h = pH[c - 1] + m
                    e = pE[c - 1] + (j >= pos && i >= freshFrom ? m : 0)
                    q = pR[c - 1] + 1
                }
                let up = pH[c] - gapHeard
                if up > h { h = up; e = pE[c]; q = pR[c] }
                let left = cH[c - 1] - gapScript
                if left > h { h = left; e = cE[c - 1]; q = 0 }
                cH[c] = h; cE[c] = e; cR[c] = q
            }
            swap(&pH, &cH); swap(&pE, &cE); swap(&pR, &cR)
        }
        // Si lo oído encaja igual de bien donde ya estamos, no hay nada que mover.
        var stay = 0.0
        for c in 0...cols where lo + c >= pos - 2 && lo + c <= pos { stay = max(stay, pH[c]) }
        var best = -1, bestScore = stay
        for c in 1...cols {
            let d = lo + c - pos
            var s = pH[c]
            if d > 0 {
                guard enough(d, pE[c], pR[c]) else { continue }
                s -= distancePenalty(d)
            } else if d < -2 {
                guard pR[c] >= backRun else { continue }
                s -= 1
            } else {
                continue
            }
            if s > bestScore { bestScore = s; best = lo + c }
        }
        // Si lo nuevo también encaja más cerca, gana ese sitio; si allí aún falta prueba, se espera a la
        // siguiente palabra. Quedarse corto se corrige solo al seguir leyendo; pasarse no.
        if best > pos {
            let need = max(0.01, pE[best - lo] - nearTolerance)
            var c = pos - lo + 1
            while c <= cols {
                let d = lo + c - pos
                if pE[c] >= need && pH[c] - distancePenalty(d) > stay {
                    best = enough(d, pE[c], pR[c]) ? lo + c : -1
                    break
                }
                c += 1
            }
        }
        if best >= 0 { pos = best; fresh = 0 }
    }

    /// words: lista completa (normalizada) de la sesión de reconocimiento actual.
    @discardableResult
    func update(_ words: [String], isFinal: Bool) -> Int {
        let n = words.count
        // Tras una pausa Apple puede vaciar la transcripción sin cerrar la sesión: es como una sesión nueva.
        if n + 3 < lastLen { carry = recent; skip = 0; prev = [] }
        var same = 0
        while same < n && same < prev.count && prev[same] == words[same] { same += 1 }
        fresh = max(0, fresh - (prev.count - same)) + n - same
        prev = words
        skip = min(skip, n)
        lastLen = n
        let tail = Array((carry + words[skip...]).suffix(tailSize))
        recent = tail
        if !tail.isEmpty { align(tail, tentative: !isFinal) }
        return pos
    }

    func resetSession() { carry = recent; skip = 0; lastLen = 0; prev = [] }

    /// Salto manual (toque en una palabra); puede ir hacia atrás. Lo oído antes del toque deja de contar.
    func setPos(_ p: Int) {
        pos = max(0, min(p, norms.count))
        carry = []
        recent = []
        skip = lastLen
        fresh = 0
    }
}
