import Foundation

@main struct JournalChecks {
 static func main() throws {
  let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at:folder) }
  let journal=try TrackingJournal(directory:folder)
  let context=TrackingContext(roundID:"round",courseID:"course",hole:1)
  let id=try journal.create(context)
  let fix=TrackingFix(id:"a",time:1000,lat:32,lon:-97,accuracy:4,hole:1,segment:"one")
  try journal.append(TrackingRecord(kind:"fix",time:1000,fix:fix),sessionID:id)
  let reopened=try TrackingJournal(directory:folder)
  let recovered = try reopened.read(id)
  precondition(recovered.fixes.count==1)
  let correction=TrackingCorrection(id:"a:b",status:"reviewed",clubID:"iron",lie:"rough",startLat:32,startLon:-97,endLat:32.001,endLon:-97)
  try reopened.append(TrackingRecord(kind:"correction",time:2000,correction:correction),sessionID:id)
  try reopened.append(TrackingRecord(kind:"stop",time:3000),sessionID:id)
  let saved=try reopened.read(id)
  precondition(!saved.running && saved.corrections.count==1)
  do { _=try journal.file("../escape"); fatalError("accepted invalid id") } catch TrackingStoreError.invalid {}
  let handle=try FileHandle(forWritingTo:journal.file(id)); try handle.seekToEnd(); try handle.write(contentsOf:Data("partial".utf8)); try handle.close()
  do { try journal.append(TrackingRecord(kind:"resume",time:4000),sessionID:id); fatalError("overwrote partial evidence") } catch TrackingStoreError.corrupt {}
  print("Native journal checks passed: restart, correction, stop, path rejection, partial-write protection")
 }
}
