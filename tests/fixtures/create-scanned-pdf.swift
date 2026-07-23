import AppKit
import Foundation
import PDFKit

guard CommandLine.arguments.count == 2 || CommandLine.arguments.count == 3 else { exit(1) }
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let pageCount = CommandLine.arguments.count == 3 ? Int(CommandLine.arguments[2]) ?? 0 : 1
guard pageCount > 0 else { exit(1) }
let image = NSImage(size: NSSize(width: 612, height: 792))
image.lockFocus()
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: 612, height: 792).fill()
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 28),
    .foregroundColor: NSColor.black
]
NSString(string: "Heine Borel compactness theorem.\nx^2 + y^2 = 1").draw(
    in: NSRect(x: 56, y: 580, width: 500, height: 120),
    withAttributes: attributes
)
image.unlockFocus()

let document = PDFDocument()
for pageIndex in 0..<pageCount {
    guard let page = PDFPage(image: image) else { exit(1) }
    document.insert(page, at: pageIndex)
}
guard document.write(to: output) else { exit(1) }
