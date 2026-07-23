import AppKit
import Foundation
import ImageIO
import PDFKit
import Vision

let maxSourceIndexPages = 256
let maxSourceIndexRegions = 100_000
let maxSourceIndexTextBytes = 8 * 1024 * 1024
let maxSourceImagePixels = 40_000_000

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Region: Codable {
    let kind: String
    let text: String
    let bounds: Bounds
}

struct Page: Codable {
    let pageNumber: Int
    let width: Double
    let height: Double
    let thumbnailDataUrl: String
    let regions: [Region]
}

struct Extraction: Codable {
    let extractionMethod: String
    let pages: [Page]
}

enum ExtractionError: Error, LocalizedError {
    case unsupported
    case unreadable
    case empty
    case tooComplex

    var errorDescription: String? {
        switch self {
        case .unsupported: return "This source type does not have indexable mathematical content."
        case .unreadable: return "The source could not be opened for indexing."
        case .empty: return "No searchable text could be extracted from this source."
        case .tooComplex: return "This source is too complex to index safely. Choose a smaller document or split it into parts."
        }
    }
}

func pngDataUrl(_ image: NSImage) throws -> String {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let data = bitmap.representation(using: .png, properties: [:]) else {
        throw ExtractionError.unreadable
    }
    return "data:image/png;base64,\(data.base64EncodedString())"
}

func thumbnail(_ image: NSImage) -> NSImage {
    let scale = min(160 / max(image.size.width, 1), 200 / max(image.size.height, 1), 1)
    let size = NSSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
    let output = NSImage(size: size)
    output.lockFocus()
    image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1)
    output.unlockFocus()
    return output
}

func normalized(_ rect: CGRect, in pageBounds: CGRect, flipY: Bool) -> Bounds {
    let x = max(0, min(1, (rect.minX - pageBounds.minX) / pageBounds.width))
    let rawY = max(0, min(1, (rect.minY - pageBounds.minY) / pageBounds.height))
    let width = max(0.0001, min(1 - x, rect.width / pageBounds.width))
    let height = max(0.0001, min(1, rect.height / pageBounds.height))
    let y = flipY ? max(0, 1 - rawY - height) : rawY
    return Bounds(x: x, y: y, width: width, height: min(height, 1 - y))
}

func equationMatches(in text: String) -> [(text: String, range: NSRange)] {
    let pattern = #"\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\)"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    return regex.matches(in: text, range: range).compactMap { match in
        guard let matchRange = Range(match.range, in: text) else { return nil }
        return (String(text[matchRange]), match.range)
    }
}

func looksLikeRenderedEquation(_ text: String) -> Bool {
    let pattern = #"[=×÷∑∫√≤≥≈→←∈∉⊂⊆]|\b[A-Za-z0-9]+\s*[+*/^]\s*[A-Za-z0-9]+"#
    return text.range(of: pattern, options: .regularExpression) != nil
}

func recognizedRegions(_ handler: VNImageRequestHandler) throws -> [Region] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try handler.perform([request])
    return (request.results ?? []).flatMap { observation -> [Region] in
        guard let candidate = observation.topCandidates(1).first else { return [] }
        let box = observation.boundingBox
        let bounds = Bounds(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
        var output = [Region(kind: "text", text: candidate.string, bounds: bounds)]
        if looksLikeRenderedEquation(candidate.string) {
            output.append(Region(kind: "equation", text: candidate.string, bounds: bounds))
        }
        for equation in equationMatches(in: candidate.string) {
            guard let swiftRange = Range(equation.range, in: candidate.string),
                  let equationObservation = try? candidate.boundingBox(for: swiftRange) else { continue }
            let equationBox = equationObservation.boundingBox
            output.append(Region(
                kind: "equation",
                text: equation.text,
                bounds: Bounds(
                    x: equationBox.minX,
                    y: 1 - equationBox.maxY,
                    width: equationBox.width,
                    height: equationBox.height
                )
            ))
        }
        return output
    }
}

func cgImage(_ image: NSImage) throws -> CGImage {
    var bounds = NSRect(origin: .zero, size: image.size)
    guard let image = image.cgImage(forProposedRect: &bounds, context: nil, hints: nil) else {
        throw ExtractionError.unreadable
    }
    return image
}

func extractPdf(_ url: URL) throws -> Extraction {
    guard let document = PDFDocument(url: url) else { throw ExtractionError.unreadable }
    guard document.pageCount <= maxSourceIndexPages else { throw ExtractionError.tooComplex }
    var pages: [Page] = []
    var usedOcr = false
    var retainedRegions = 0
    var retainedTextBytes = 0
    for pageIndex in 0..<document.pageCount {
        guard let page = document.page(at: pageIndex) else { continue }
        let pageBounds = page.bounds(for: .mediaBox)
        let selections = page.selection(for: pageBounds)?.selectionsByLine() ?? []
        var pageRegions = selections.flatMap { selection -> [Region] in
            guard let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return [] }
            let bounds = normalized(selection.bounds(for: page), in: pageBounds, flipY: true)
            return [
                Region(kind: "text", text: text, bounds: bounds),
                looksLikeRenderedEquation(text) ? Region(kind: "equation", text: text, bounds: bounds) : nil
            ].compactMap { $0 }
        }
        if let pageText = page.string {
            for equation in equationMatches(in: pageText) {
                var characterBounds = CGRect.null
                for characterIndex in equation.range.location..<(equation.range.location + equation.range.length) {
                    characterBounds = characterBounds.union(page.characterBounds(at: characterIndex))
                }
                if !characterBounds.isNull && !characterBounds.isEmpty {
                    pageRegions.append(Region(
                        kind: "equation",
                        text: equation.text,
                        bounds: normalized(characterBounds, in: pageBounds, flipY: true)
                    ))
                }
            }
        }
        if pageRegions.isEmpty {
            let renderedPage = page.thumbnail(of: NSSize(width: 1600, height: 2000), for: .mediaBox)
            pageRegions = try recognizedRegions(VNImageRequestHandler(cgImage: cgImage(renderedPage)))
            usedOcr = true
        }
        retainedRegions += pageRegions.count
        retainedTextBytes += pageRegions.reduce(0) { $0 + $1.text.lengthOfBytes(using: .utf8) }
        guard retainedRegions <= maxSourceIndexRegions,
              retainedTextBytes <= maxSourceIndexTextBytes else { throw ExtractionError.tooComplex }
        let thumbnail = page.thumbnail(of: NSSize(width: 160, height: 200), for: .mediaBox)
        pages.append(Page(
            pageNumber: pageIndex + 1,
            width: pageBounds.width,
            height: pageBounds.height,
            thumbnailDataUrl: try pngDataUrl(thumbnail),
            regions: pageRegions
        ))
    }
    guard pages.contains(where: { !$0.regions.isEmpty }) else { throw ExtractionError.empty }
    return Extraction(extractionMethod: usedOcr ? "ocr" : "pdfText", pages: pages)
}

func extractImage(_ url: URL) throws -> Extraction {
    guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
          let pixelWidth = properties[kCGImagePropertyPixelWidth] as? NSNumber,
          let pixelHeight = properties[kCGImagePropertyPixelHeight] as? NSNumber,
          pixelWidth.intValue > 0,
          pixelHeight.intValue > 0 else { throw ExtractionError.unreadable }
    guard pixelWidth.intValue <= maxSourceImagePixels / pixelHeight.intValue else { throw ExtractionError.tooComplex }
    guard let image = NSImage(contentsOf: url) else { throw ExtractionError.unreadable }
    let pageRegions = try recognizedRegions(VNImageRequestHandler(url: url))
    guard pageRegions.count <= maxSourceIndexRegions,
          pageRegions.reduce(0, { $0 + $1.text.lengthOfBytes(using: .utf8) }) <= maxSourceIndexTextBytes
    else { throw ExtractionError.tooComplex }
    guard !pageRegions.isEmpty else { throw ExtractionError.empty }
    return Extraction(extractionMethod: "ocr", pages: [Page(
        pageNumber: 1,
        width: image.size.width,
        height: image.size.height,
        thumbnailDataUrl: try pngDataUrl(thumbnail(image)),
        regions: pageRegions
    )])
}

do {
    guard CommandLine.arguments.count == 2 else { throw ExtractionError.unreadable }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    let extraction: Extraction
    switch url.pathExtension.lowercased() {
    case "pdf": extraction = try extractPdf(url)
    case "png", "jpg", "jpeg": extraction = try extractImage(url)
    default: throw ExtractionError.unsupported
    }
    let encoder = JSONEncoder()
    FileHandle.standardOutput.write(try encoder.encode(extraction))
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
