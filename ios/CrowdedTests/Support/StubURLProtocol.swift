import Foundation

/// Canned HTTP responses keyed by "METHOD /path". Lets LiveAPI and the generated OpenAPI client
/// run for real in unit tests, against JSON shaped exactly like the FastAPI backend sends.
final class StubURLProtocol: URLProtocol {
    struct Stub {
        var status: Int
        var body: String
    }

    private static let lock = NSLock()
    private static var queues: [String: [Stub]] = [:]
    private static var log: [URLRequest] = []

    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        queues = [:]
        log = []
    }

    /// Queue responses for a route. Each request consumes one. The last one repeats.
    static func stub(_ method: String, _ path: String, status: Int = 200, json: String) {
        lock.lock()
        defer { lock.unlock() }
        queues["\(method) \(path)", default: []].append(Stub(status: status, body: json))
    }

    static var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return log
    }

    static func count(_ method: String, _ path: String) -> Int {
        return requests.filter { $0.httpMethod == method && $0.url?.path == path }.count
    }

    private static func next(for request: URLRequest) -> Stub? {
        lock.lock()
        defer { lock.unlock() }
        log.append(request)
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        guard var queue = queues[key], !queue.isEmpty else { return nil }
        let stub = queue[0]
        if queue.count > 1 {
            queue.removeFirst()
            queues[key] = queue
        }
        return stub
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let stub = Self.next(for: request) ?? Stub(status: 404, body: "{\"detail\":\"not_found\"}")
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "http://test.local")!,
            statusCode: stub.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// JSON fixtures shaped like the real backend responses (see docs/openapi.json).
enum Fixtures {
    static let me = """
    {"id":"6f7c1e2a-0000-4000-8000-000000000001","role":"user","wait_threshold_min":20,
     "staff_bar_id":null,"phone_hint":"ending in 34","created_at":"2026-11-09T04:25:07.123456Z"}
    """

    static func tokenPair(access: String = "access-1", refresh: String = "refresh-1") -> String {
        return """
        {"access_token":"\(access)","refresh_token":"\(refresh)","token_type":"bearer",
         "expires_in":900,"user":\(me)}
        """
    }

    static let live = """
    {"has_recent_data":true,"wait_min":31,"wait_low_min":23,"wait_high_min":40,
     "crowd_level":"packed","headcount":205,"capacity_ratio":0.932,"confidence":"high",
     "basis":{"text":"Based on 7 reports, 3 timers and staff counts in the last 30 min",
              "window_min":30,"reports":7,"timers":3,"door_events":14,"staff_line_updates":2},
     "flags":[],"updated_at":"2026-11-14T03:30:00Z"}
    """

    static let noDataLive = """
    {"has_recent_data":false,"wait_min":null,"wait_low_min":null,"wait_high_min":null,
     "crowd_level":null,"headcount":null,"capacity_ratio":null,"confidence":"none",
     "basis":{"text":"No recent data","window_min":30,"reports":0,"timers":0,"door_events":0,
              "staff_line_updates":0},
     "flags":[],"updated_at":"2026-11-14T03:30:00.5Z"}
    """

    static let bars = """
    [{"id":"b1","slug":"fake-owl","name":"FAKE Owl","address":"1 Fake St","capacity":220,
      "pass_price_cents":1500,"live":\(live),
      "verdict":{"recommendation":"buy_pass","text":"Get the pass.","threshold_min":20,
                 "pass_price_cents":1500,"minutes_saved":31}},
     {"id":"b2","slug":"fake-heron","name":"FAKE Heron","address":"2 Fake St","capacity":300,
      "pass_price_cents":null,"live":\(noDataLive),
      "verdict":{"recommendation":"no_data","text":"No recent data. No call yet.",
                 "threshold_min":20,"pass_price_cents":null,"minutes_saved":null,
                 "some_future_field":"ignored"}}]
    """

    static let specialTonight = """
    {"id":"sp1","kind":"cover","title":"FAKE Cover","details":"","days":[3,4,5],
     "start_local":"21:00","end_local":"02:00","price_cents":500,"is_active":true,
     "all_day":false,"items":[],"posted_by":"staff","updated_at":"2026-11-14T03:30:00Z",
     "is_now":false}
    """

    static let happyHourTonight = """
    {"id":"sp2","kind":"happy_hour","title":"FAKE Happy hour","details":"Half off.",
     "days":[0,1,2,3,4],"start_local":"17:00","end_local":"20:00","price_cents":null,
     "is_active":true,"posted_by":"admin","updated_at":"2026-11-14T03:30:00.25Z",
     "all_day":false,
     "items":[{"name":"Double wells","price_label":"$2","category":"mixers","note":""},
              {"name":"Drafts","price_label":"$2","category":"beer"},
              {"name":"Ten wings","price_label":"$6","category":"food","note":"Dine in only"},
              {"name":"Mystery","price_label":"$1","category":"some_future_category"}],
     "is_now":true}
    """

    static let allNightTonight = """
    {"id":"sp3","kind":"drink","title":"FAKE All night drafts","details":"",
     "days":[0,1,2,3,4,5,6],"start_local":"12:00","end_local":"04:00","price_cents":null,
     "is_active":true,"posted_by":"staff","updated_at":"2026-11-14T03:30:00Z",
     "all_day":true,
     "items":[{"name":"Lager drafts","price_label":"$3","category":"beer","note":""}],
     "is_now":true}
    """

    static let barsAllNight = """
    [{"id":"b1","slug":"fake-owl","name":"FAKE Owl","address":"1 Fake St","capacity":220,
      "pass_price_cents":1500,"live":\(live),
      "verdict":{"recommendation":"buy_pass","text":"Get the pass.","threshold_min":20,
                 "pass_price_cents":1500,"minutes_saved":31},
      "specials_tonight":[\(allNightTonight)],"cover_tonight":null}]
    """

    static let barsWithSpecials = """
    [{"id":"b1","slug":"fake-owl","name":"FAKE Owl","address":"1 Fake St","capacity":220,
      "pass_price_cents":1500,"live":\(live),
      "verdict":{"recommendation":"buy_pass","text":"Get the pass.","threshold_min":20,
                 "pass_price_cents":1500,"minutes_saved":31},
      "specials_tonight":[\(happyHourTonight),\(specialTonight)],
      "cover_tonight":\(specialTonight)},
     {"id":"b2","slug":"fake-heron","name":"FAKE Heron","address":"2 Fake St","capacity":300,
      "pass_price_cents":null,"live":\(noDataLive),
      "verdict":{"recommendation":"no_data","text":"No recent data. No call yet.",
                 "threshold_min":20,"pass_price_cents":null,"minutes_saved":null},
      "specials_tonight":[],"cover_tonight":null}]
    """

    static let session = """
    {"id":"s1","bar_id":"b1","status":"active","started_at":"2026-11-14T03:30:00.000001Z",
     "ended_at":null,"predicted_wait_min":31,"actual_wait_min":null,"near_bar":true,
     "points_awarded":0}
    """
}
