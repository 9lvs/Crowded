import CoreLocation
import Foundation

/// Reads the location ONCE, only when the user taps Report or I'm in line. No continuous
/// updates and no background location. The server turns it into "near the bar" and discards it.
protocol LocationProviding: AnyObject {
    @MainActor func currentLocation(timeout: TimeInterval) async -> Coordinate?
}

@MainActor
final class OneShotLocation: NSObject, LocationProviding, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<Coordinate?, Never>?
    private var authContinuation: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func currentLocation(timeout: TimeInterval = 6) async -> Coordinate? {
        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                authContinuation = cont
                manager.requestWhenInUseAuthorization()
            }
        }
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            return nil
        }
        if continuation != nil {
            return nil
        }
        let timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            self?.finish(nil)
        }
        let result: Coordinate? = await withCheckedContinuation { (cont: CheckedContinuation<Coordinate?, Never>) in
            continuation = cont
            manager.requestLocation()
        }
        timeoutTask.cancel()
        return result
    }

    private func finish(_ value: Coordinate?) {
        guard let cont = continuation else { return }
        continuation = nil
        cont.resume(returning: value)
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if manager.authorizationStatus != .notDetermined, let cont = self.authContinuation {
                self.authContinuation = nil
                cont.resume()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let value = Coordinate(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude)
        Task { @MainActor in
            self.finish(value)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.finish(nil)
        }
    }
}

/// Used by previews, tests and the mock: returns a fixed point or nil, never prompts.
@MainActor
final class FixedLocation: LocationProviding {
    var value: Coordinate?

    init(_ value: Coordinate? = Coordinate(latitude: 0, longitude: 0)) {
        self.value = value
    }

    func currentLocation(timeout: TimeInterval) async -> Coordinate? {
        return value
    }
}
