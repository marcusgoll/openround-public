import UIKit
import CoreLocation
import Capacitor

final class OpenRoundViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(SmartTrackingPlugin()) }
}

@objc(SmartTrackingPlugin)
public class SmartTrackingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "SmartTrackingPlugin"
    public let jsName = "SmartTracking"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "correct", returnType: CAPPluginReturnPromise)
    ]
    private let manager = CLLocationManager()
    private var journal: TrackingJournal?
    private var sessionID: String?
    private var context: TrackingContext?
    private var segment = UUID().uuidString
    private var lastTimestamp = 0.0
    private var recording = false
    private var requested = false
    private var problem: String?

    public override func load() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.pausesLocationUpdatesAutomatically = false
        do {
            let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("OpenRoundTracking")
            journal = try TrackingJournal(directory: folder)
            // Reopening shows the previous journal, but requires an explicit Resume after process termination.
            sessionID = try journal?.sessionIDs().first
            if let id = sessionID, let saved = try journal?.read(id) { context = saved.context }
        } catch { problem = "Tracking storage could not be opened. Existing files were preserved." }
    }
    private func now() -> Double { Date().timeIntervalSince1970 * 1000 }
    private func append(_ record: TrackingRecord) throws {
        guard let journal, let sessionID else { throw TrackingStoreError.invalid }
        try journal.append(record, sessionID: sessionID)
    }
    private func failStorage() {
        recording = false; requested = false; manager.stopUpdatingLocation()
        problem = "Recording stopped because the location journal could not be saved. Existing evidence was preserved."
    }
    private func beginIfAllowed() throws {
        let authorization = manager.authorizationStatus
        guard requested, authorization == .authorizedAlways || authorization == .authorizedWhenInUse else { return }
        if !recording {
            segment = UUID().uuidString; lastTimestamp = now()
            try append(TrackingRecord(kind: "resume", time: now(), context: context))
            manager.startUpdatingLocation(); recording = true
        }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let roundID = call.getString("roundID"), !roundID.isEmpty, roundID.count <= 160,
                  let courseID = call.getString("courseID"), !courseID.isEmpty, courseID.count <= 160,
                  let hole = call.getInt("hole"), (1...18).contains(hole), let journal = self.journal else {
                call.reject("A saved round, course and valid hole are required."); return
            }
            if self.requested && (self.context?.roundID != roundID || self.context?.courseID != courseID) { call.reject("Stop the active recording before switching rounds."); return }
            do {
                let next = TrackingContext(roundID: roundID, courseID: courseID, hole: hole)
                if self.context?.roundID != roundID || self.sessionID == nil { self.sessionID = try journal.create(next) }
                if self.context?.hole != hole { self.segment = UUID().uuidString; self.lastTimestamp = self.now() }
                self.context = next
                try self.append(TrackingRecord(kind: "context", time: self.now(), context: next))
                self.problem = nil; self.requested = true
                if self.manager.authorizationStatus == .notDetermined { self.manager.requestWhenInUseAuthorization() }
                else if self.manager.authorizationStatus == .denied || self.manager.authorizationStatus == .restricted {
                    self.requested = false; self.problem = "Location access is off. Enable it in iPhone Settings to record."
                } else { try self.beginIfAllowed() }
                self.resolve(call)
            } catch { self.failStorage(); call.reject(self.problem ?? "Could not start recording.") }
        }
    }
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager.stopUpdatingLocation(); self.recording = false; self.requested = false
            do { if self.sessionID != nil { try self.append(TrackingRecord(kind: "stop", time: self.now())) }; self.resolve(call) }
            catch { self.failStorage(); call.reject(self.problem ?? "Could not save the stop event.") }
        }
    }
    @objc func snapshot(_ call: CAPPluginCall) { DispatchQueue.main.async { self.resolve(call, id: call.getString("sessionID")) } }
    private func resolve(_ call: CAPPluginCall, id: String? = nil) {
        do {
            var result: [String: Any] = ["recording": recording, "permission": manager.authorizationStatus.rawValue, "precise": manager.accuracyAuthorization == .fullAccuracy, "requested": requested]
            if let problem { result["problem"] = problem }
            if let sessionID { result["activeSessionID"] = sessionID }
            if let journal {
                let sessions = try journal.sessionIDs().map { id -> [String: Any] in
                    guard let saved = try? journal.read(id) else {
                        return ["sessionID": id, "roundID": "", "courseID": "", "fixCount": 0, "unreadable": true]
                    }
                    return ["sessionID": id, "roundID": saved.context.roundID, "courseID": saved.context.courseID, "fixCount": saved.fixes.count]
                }
                result["sessions"] = sessions
                if let selected = id ?? sessionID {
                    do { result["session"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(journal.read(selected))) }
                    catch { result["problem"] = "This journal needs recovery. Its original file is preserved; you can start a new round recording." }
                }
            }
            call.resolve(result)
        } catch { call.reject("The saved journal could not be read. It was not modified.") }
    }
    @objc func correct(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                guard let journal = self.journal, let id = call.getString("sessionID"),
                      let candidateID = call.getString("id"), let status = call.getString("status"), ["reviewed", "dismissed"].contains(status),
                      let startLat = call.getDouble("startLat"), let startLon = call.getDouble("startLon"),
                      let endLat = call.getDouble("endLat"), let endLon = call.getDouble("endLon"),
                      [startLat, endLat].allSatisfy({ $0.isFinite && (-90...90).contains($0) }),
                      [startLon, endLon].allSatisfy({ $0.isFinite && (-180...180).contains($0) }) else { throw TrackingStoreError.invalid }
                let saved = try journal.read(id)
                let pair = candidateID.split(separator: ":").map(String.init)
                guard pair.count == 2, let start = saved.fixes.first(where: { $0.id == pair[0] }),
                      let end = saved.fixes.first(where: { $0.id == pair[1] }), start.time < end.time,
                      start.segment == end.segment, start.hole == end.hole else { throw TrackingStoreError.invalid }
                let lie = call.getString("lie") ?? "unknown"
                guard ["unknown", "tee", "fairway", "rough", "bunker", "recovery", "green"].contains(lie),
                      (call.getString("clubID") ?? "").count <= 80 else { throw TrackingStoreError.invalid }
                let correction = TrackingCorrection(id: candidateID, status: status, clubID: call.getString("clubID"), lie: lie,
                    startLat: startLat, startLon: startLon, endLat: endLat, endLon: endLon)
                try journal.append(TrackingRecord(kind: "correction", time: self.now(), correction: correction), sessionID: id)
                self.resolve(call, id: id)
            } catch { call.reject("Could not save this correction. The original evidence is unchanged.") }
        }
    }
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            recording = false; requested = false; manager.stopUpdatingLocation(); problem = "Location permission was denied or revoked."
        } else { do { try beginIfAllowed() } catch { failStorage() } }
    }
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard recording, let context else { return }
        for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
            let timestamp = location.timestamp.timeIntervalSince1970 * 1000
            guard CLLocationCoordinate2DIsValid(location.coordinate), location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 20,
                  timestamp > lastTimestamp, now() - timestamp <= 30_000, timestamp - now() <= 5_000 else { continue }
            let fix = TrackingFix(id: UUID().uuidString, time: timestamp, lat: location.coordinate.latitude, lon: location.coordinate.longitude,
                                  accuracy: location.horizontalAccuracy, hole: context.hole, segment: segment)
            do { try append(TrackingRecord(kind: "fix", time: now(), fix: fix)); lastTimestamp = timestamp; problem = nil }
            catch { failStorage(); return }
        }
    }
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        problem = "Location updates are unavailable. Recording will wait for a fresh accurate fix."
    }
}
