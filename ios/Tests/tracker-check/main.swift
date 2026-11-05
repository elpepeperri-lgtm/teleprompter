import Foundation

// Pruebas del seguimiento del guion. Se compilan junto con Tracker.swift y corren antes de generar la app.
var failures = 0

func check(_ ok: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
    print((ok ? "ok    " : "FALLA ") + name + (ok ? "" : " — " + detail()))
    if !ok { failures += 1 }
}

func words(_ s: String) -> [String] { TextNorm.tokenize(s).filter { $0.index >= 0 }.map { $0.norm } }

/// Guion de hasta 125 palabras inventadas que no se parecen entre sí: dos cualesquiera difieren en al menos
/// dos sílabas, así el parecido aproximado no las confunde y la prueba mide solo el orden.
func distinct(_ n: Int) -> [String] {
    let syl = ["ba", "ce", "di", "fo", "gu"]
    return (0..<n).map { i in
        let a = i % 5, b = (i / 5) % 5, c = (i / 25) % 5
        return syl[a] + syl[b] + syl[c] + syl[(a + b + c) % 5]
    }
}

/// Lee palabra por palabra, como llegan los resultados parciales.
func say(_ t: Tracker, _ list: [String], into heard: inout [String]) {
    for w in list {
        heard.append(w)
        t.update(heard, isFinal: false)
    }
}

// Una palabra repetida más adelante no mueve el guion.
do {
    let script = words("hoy quiero hablar de la casa de mi abuela porque esa casa tiene un jardin muy bonito y al final de la casa hay un arbol enorme")
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, ["hoy", "quiero", "hablar", "de", "la", "casa"], into: &heard)
    check(t.pos == 6, "la primera 'casa' se queda en la primera", "pos \(t.pos)")
    t.update(heard + ["casa"], isFinal: false)
    check(t.pos <= 7, "repetir 'casa' no salta a la siguiente", "pos \(t.pos)")
}

// Una palabra suelta del final del guion no adelanta nada.
do {
    let script = words("primero vamos a revisar los numeros del mes y despues hablamos del presupuesto para el proximo trimestre con todo el equipo")
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, ["primero", "vamos"], into: &heard)
    say(t, ["presupuesto"], into: &heard)
    check(t.pos == 2, "una palabra suelta lejana no salta", "pos \(t.pos)")
}

// Una frase ya leída que se repite más adelante no justifica saltar allá por una palabra nueva.
do {
    var script = distinct(100)
    for k in 0..<6 { script[80 + k] = script[10 + k] }
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, Array(script[0..<16]), into: &heard)
    say(t, [script[86]], into: &heard)
    check(t.pos == 16, "lo ya leído no cuenta para saltar", "pos \(t.pos)")
}

// Tras perder audio, si la frase existe dos veces, va a la copia más cercana.
do {
    var script = distinct(120)
    for k in 0..<6 { script[100 + k] = script[40 + k] }
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, Array(script[0..<5]), into: &heard)
    t.resetSession()
    heard = []
    say(t, Array(script[40..<46]), into: &heard)
    check(t.pos == 46, "entre dos copias gana la más cercana", "pos \(t.pos)")
}

// Apple vacía la transcripción tras una pausa, sin avisar: el guion sigue.
do {
    let script = distinct(60)
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, Array(script[0..<20]), into: &heard)
    heard = []
    say(t, Array(script[20..<30]), into: &heard)
    check(t.pos == 30, "sigue tras vaciarse la transcripción", "pos \(t.pos)")
}

// Se pierden 40 palabras de audio: se recupera solo al oír unas pocas seguidas.
do {
    let script = distinct(120)
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, Array(script[0..<10]), into: &heard)
    t.resetSession()
    heard = []
    say(t, Array(script[50..<58]), into: &heard)
    check(t.pos == 58, "se recupera tras perder audio", "pos \(t.pos)")
}

// Si quedó adelantado y se sigue leyendo más atrás, regresa con una frase completa.
do {
    let script = distinct(80)
    let t = Tracker(norms: script, start: 40)
    var heard: [String] = []
    say(t, Array(script[20..<27]), into: &heard)
    check(t.pos == 27, "regresa si se lee una frase anterior", "pos \(t.pos)")
}

// Un toque manda: lo oído antes del toque no lo deshace, ni aunque el reconocedor corrija su texto.
do {
    let script = distinct(120)
    let t = Tracker(norms: script)
    var heard: [String] = []
    say(t, Array(script[0..<12]), into: &heard)
    t.setPos(100)
    t.update(Array(heard.dropLast()), isFinal: false)
    t.update(heard, isFinal: true)
    check(t.pos == 100, "el toque no se deshace", "pos \(t.pos)")
    t.resetSession()
    heard = []
    say(t, Array(script[100..<104]), into: &heard)
    check(t.pos == 104, "sigue desde el toque", "pos \(t.pos)")
}

// Lecturas simuladas con errores del reconocedor en guiones muy repetitivos.
struct LCG {
    var s: UInt32
    mutating func next() -> Double {
        s = s &* 1664525 &+ 1013904223
        return Double(s) / 4294967296
    }
    mutating func pick(_ a: [String]) -> String { a[Int(next() * Double(a.count))] }
}

let stop = "de la el en y a que los las un una por con para del se lo como pero mas su al es".split(separator: " ").map(String.init)
let vocab = "tiempo personas negocio dinero trabajo cliente producto mercado empresa historia camino mundo gente proyecto resultado pregunta respuesta momento ejemplo problema solucion marca video contenido seguidores redes semana equipo idea cambio futuro valor precio calidad servicio mejor nuevo grande importante primero siempre nunca ahora despues hacer tener poder saber querer decir vender comprar crear ganar perder empezar seguir".split(separator: " ").map(String.init)

func makeScript(_ r: inout LCG, _ n: Int, repeats: Double) -> [String] {
    var phrases: [[String]] = []
    for _ in 0..<8 {
        var p: [String] = []
        for _ in 0..<(4 + Int(r.next() * 4)) { p.append(r.next() < 0.45 ? r.pick(stop) : r.pick(vocab)) }
        phrases.append(p)
    }
    var out: [String] = []
    while out.count < n {
        if r.next() < repeats {
            out += phrases[Int(r.next() * Double(phrases.count))]
        } else {
            for _ in 0..<6 { out.append(r.next() < 0.45 ? r.pick(stop) : r.pick(vocab)) }
        }
    }
    return Array(out.prefix(n))
}

var unfinished = 0, maxAhead = 0
let readings = 40
for seed in 1...readings {
    var r = LCG(s: UInt32(seed * 7919))
    let script = makeScript(&r, 600, repeats: seed % 2 == 0 ? 0.6 : 0.15)
    let t = Tracker(norms: script)
    var heard: [String] = []
    var i = 0
    while i < script.count {
        let x = r.next()
        if x < 0.08 {
            // no se reconoció
        } else if x < 0.16 {
            heard.append(r.pick(vocab))
        } else {
            heard.append(script[i])
        }
        if r.next() < 0.03 { heard.append("este") }
        t.update(heard, isFinal: false)
        i += 1
        maxAhead = max(maxAhead, t.pos - i)
        if r.next() < 0.02 { heard = [] }
        if r.next() < 0.01 { t.update(heard, isFinal: true); t.resetSession(); heard = [] }
        if i < script.count - 100 && r.next() < 0.005 {
            i += 10 + Int(r.next() * 50)
            t.update(heard, isFinal: true); t.resetSession(); heard = []
        }
    }
    if script.count - t.pos > 25 { unfinished += 1 }
}
check(unfinished == 0, "las \(readings) lecturas llegan al final", "\(unfinished) no llegaron")
check(maxAhead <= 30, "nunca se adelanta de más", "se adelantó \(maxAhead) palabras")

// Un guion largo debe alinearse sin trabar la pantalla.
do {
    var r = LCG(s: 42)
    let script = makeScript(&r, 5000, repeats: 0.3)
    let t = Tracker(norms: script, start: 1000)
    var heard: [String] = []
    let start = Date()
    say(t, Array(script[1000..<1400]), into: &heard)
    let ms = Date().timeIntervalSince(start) * 1000 / 400
    check(ms < 8, "cada actualización tarda menos de 8 ms", String(format: "%.1f ms", ms))
}

print(failures == 0 ? "Todo bien" : "\(failures) prueba(s) fallaron")
exit(failures == 0 ? 0 : 1)
