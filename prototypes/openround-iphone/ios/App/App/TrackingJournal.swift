import Foundation

struct TrackingContext: Codable { var roundID: String; var courseID: String; var hole: Int }
struct TrackingFix: Codable {
    var id: String; var time: Double; var lat: Double; var lon: Double; var accuracy: Double
    var hole: Int; var segment: String
}
struct TrackingCorrection: Codable {
    var id: String; var status: String; var clubID: String?; var lie: String?
    var startLat: Double; var startLon: Double; var endLat: Double; var endLon: Double
}
struct TrackingRecord: Codable {
    var kind: String; var time: Double
    var context: TrackingContext? = nil; var fix: TrackingFix? = nil; var correction: TrackingCorrection? = nil
}
struct TrackingSnapshot: Codable {
    var sessionID: String; var context: TrackingContext; var fixes: [TrackingFix] = []
    var corrections: [TrackingCorrection] = []; var running = false
}
enum TrackingStoreError: Error { case invalid, corrupt, full }

// ponytail: append-only JSONL, capped at 32 MB per session; use SQLite if replay latency becomes noticeable.
final class TrackingJournal {
    let directory: URL
    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
        #endif
    }
    func file(_ id: String) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw TrackingStoreError.invalid }
        return directory.appendingPathComponent(id).appendingPathExtension("jsonl")
    }
    func create(_ context: TrackingContext) throws -> String {
        guard !context.roundID.isEmpty, context.roundID.count <= 160, !context.courseID.isEmpty,
              context.courseID.count <= 160, (1...18).contains(context.hole) else { throw TrackingStoreError.invalid }
        let id = UUID().uuidString
        let record = TrackingRecord(kind: "start", time: Date().timeIntervalSince1970 * 1000, context: context)
        var data = try JSONEncoder().encode(record); data.append(10)
        try data.write(to: file(id), options: .atomic)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file(id).path)
        #endif
        return id
    }
    func append(_ record: TrackingRecord, sessionID: String) throws {
        let url = try file(sessionID)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        let size = try handle.seekToEnd()
        guard size < 32 * 1024 * 1024 else { throw TrackingStoreError.full }
        // Refuse a partial tail instead of appending over uncertain evidence after an interrupted write.
        if size > 0 {
            let reader = try FileHandle(forReadingFrom: url); defer { try? reader.close() }
            try reader.seek(toOffset: size - 1)
            guard try reader.read(upToCount: 1) == Data([10]) else { throw TrackingStoreError.corrupt }
        }
        var data = try JSONEncoder().encode(record); data.append(10)
        try handle.write(contentsOf: data); try handle.synchronize()
    }
    func read(_ id: String) throws -> TrackingSnapshot {
        let url = try file(id)
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 33 * 1024 * 1024 else { throw TrackingStoreError.full }
        let data = try Data(contentsOf: url)
        guard data.last == 10 else { throw TrackingStoreError.corrupt }
        let rows = try data.split(separator: 10).map { try JSONDecoder().decode(TrackingRecord.self, from: Data($0)) }
        guard let context = rows.first?.context, rows.first?.kind == "start" else { throw TrackingStoreError.corrupt }
        var snapshot = TrackingSnapshot(sessionID: id, context: context)
        for row in rows {
            if let context = row.context { snapshot.context = context }
            if let fix = row.fix { snapshot.fixes.append(fix) }
            if let correction = row.correction { snapshot.corrections.removeAll { $0.id == correction.id }; snapshot.corrections.append(correction) }
            if row.kind == "start" || row.kind == "resume" { snapshot.running = true }
            if row.kind == "stop" { snapshot.running = false }
        }
        return snapshot
    }
    func sessionIDs() throws -> [String] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.creationDateKey])
            .filter { $0.pathExtension == "jsonl" }
            .sorted { ((try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast) > ((try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast) }
            .map { $0.deletingPathExtension().lastPathComponent }
    }
}
