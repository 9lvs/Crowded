import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

// The only file that touches the generated OpenAPI types (Client, Operations, Components).
// Generated names come from the operationIds in docs/openapi.json. The iOS copy
// (API/openapi.json) is normalized by ios/scripts/sync_openapi.py: optional values are plain
// Swift Optionals, ids, dates and enums are Strings.

final class LiveAPI: CrowdedAPI, @unchecked Sendable {
    private let client: Client
    private let plainClient: Client
    let tokens: TokenStore

    /// `session` is injectable so tests can stub the network with a URLProtocol.
    init(baseURL: URL, secureStore: SecureStore, session: URLSession = .shared) {
        let transport = URLSessionTransport(configuration: .init(session: session))
        let plain = Client(
            serverURL: baseURL,
            transport: transport,
            middlewares: [ErrorMiddleware()]
        )
        let store = TokenStore(secureStore: secureStore) { refreshToken in
            let output = try await plain.refresh_v1_auth_refresh_post(
                body: .json(Components.Schemas.RefreshIn(refresh_token: refreshToken))
            )
            let pair = try output.ok.body.json
            return TokenPairValue(access: pair.access_token, refresh: pair.refresh_token)
        }
        self.plainClient = plain
        self.tokens = store
        // ErrorMiddleware is outermost so it sees the final response after any auth retry.
        self.client = Client(
            serverURL: baseURL,
            transport: transport,
            middlewares: [ErrorMiddleware(), AuthMiddleware(tokens: store)]
        )
    }

    /// Runs a call and converts every failure into APIError.
    private func run<T>(_ work: () async throws -> T) async throws -> T {
        do {
            return try await work()
        } catch {
            throw APIError.wrap(underlyingError(error))
        }
    }

    // MARK: Session

    func hasStoredSession() async -> Bool {
        return await tokens.hasRefreshToken()
    }

    func requestCode(phone: String) async throws -> CodeRequest {
        return try await run {
            let output = try await plainClient.request_code_v1_auth_request_code_post(
                body: .json(Components.Schemas.RequestCodeIn(phone: phone))
            )
            let value = try output.ok.body.json
            return CodeRequest(expiresIn: value.expires_in, devCode: value.dev_code)
        }
    }

    func verifyCode(phone: String, code: String, ageAttested: Bool) async throws -> Me {
        return try await run {
            let input = Components.Schemas.VerifyCodeIn(
                age_attested: ageAttested,
                code: code,
                phone: phone,
                platform: "ios"
            )
            let output = try await plainClient.verify_code_v1_auth_verify_code_post(
                body: .json(input)
            )
            let pair = try output.ok.body.json
            await tokens.store(TokenPairValue(access: pair.access_token, refresh: pair.refresh_token))
            return Self.mapMe(pair.user)
        }
    }

    func signOut() async {
        if let refresh = await tokens.refreshToken() {
            _ = try? await plainClient.logout_v1_auth_logout_post(
                body: .json(Components.Schemas.RefreshIn(refresh_token: refresh))
            )
        }
        await tokens.clear()
    }

    // MARK: Me

    func me() async throws -> Me {
        return try await run {
            let output = try await client.read_me_v1_me_get()
            return Self.mapMe(try output.ok.body.json)
        }
    }

    func updateThreshold(minutes: Int) async throws -> Me {
        return try await run {
            let output = try await client.update_me_v1_me_patch(
                body: .json(Components.Schemas.MeUpdate(wait_threshold_min: minutes))
            )
            return Self.mapMe(try output.ok.body.json)
        }
    }

    func deleteAccount() async throws {
        try await run {
            _ = try await client.delete_me_v1_me_delete()
        }
        await tokens.clear()
    }

    // MARK: Bars

    func bars() async throws -> [Bar] {
        return try await run {
            let output = try await client.list_bars_v1_bars_get()
            let rows = try output.ok.body.json
            return rows.map { Self.mapBar($0) }
        }
    }

    func bar(id: String) async throws -> BarDetail {
        return try await run {
            let output = try await client.get_bar_v1_bars__bar_id__get(
                path: .init(bar_id: id)
            )
            return Self.mapDetail(try output.ok.body.json)
        }
    }

    // MARK: Sourcing

    func activeSession() async throws -> LineSession? {
        do {
            let output = try await client.get_active_session_v1_line_sessions_active_get()
            return Self.mapSession(try output.ok.body.json)
        } catch {
            let cause = underlyingError(error)
            if cause is APIError || cause is URLError {
                throw APIError.wrap(cause)
            }
            // The server answers `null` when no timer is running, which cannot decode into
            // LineSessionOut. Treat that as "no active session".
            return nil
        }
    }

    func startSession(barId: String, location: Coordinate?) async throws -> LineSession {
        return try await run {
            let input = Components.Schemas.LineSessionStartIn(
                bar_id: barId,
                location: Self.mapLocation(location)
            )
            let output = try await client.start_line_session_v1_line_sessions_post(
                body: .json(input)
            )
            return Self.mapSession(try output.created.body.json)
        }
    }

    func endSession(id: String, outcome: EndOutcome, doorCode: String?) async throws -> LineSession {
        return try await run {
            let input = Components.Schemas.LineSessionEndIn(
                door_code: doorCode,
                outcome: outcome.rawValue
            )
            let output = try await client.end_line_session_v1_line_sessions__session_id__end_post(
                path: .init(session_id: id),
                body: .json(input)
            )
            return Self.mapSession(try output.ok.body.json)
        }
    }

    func report(
        barId: String, crowd: CrowdLevel?, line: LineSize?, location: Coordinate?
    ) async throws -> ReportResult {
        return try await run {
            let input = Components.Schemas.ReportCreate(
                bar_id: barId,
                crowd_level: crowd?.rawValue,
                line_size: line?.rawValue,
                location: Self.mapLocation(location)
            )
            let output = try await client.submit_report_v1_reports_post(body: .json(input))
            let value = try output.created.body.json
            return ReportResult(nearBar: value.near_bar, pointsAwarded: value.points_awarded)
        }
    }

    // MARK: Staff

    func redeemInvite(code: String) async throws -> Me {
        return try await run {
            let output = try await client.redeem_invite_v1_staff_invites_redeem_post(
                body: .json(Components.Schemas.RedeemInviteIn(code: code))
            )
            return Self.mapMe(try output.ok.body.json)
        }
    }

    func staffState(barId: String) async throws -> StaffState {
        return try await run {
            let output = try await client.get_staff_state_v1_staff_bars__bar_id__get(
                path: .init(bar_id: barId)
            )
            return Self.mapStaff(try output.ok.body.json)
        }
    }

    func door(barId: String, direction: DoorDirection, count: Int) async throws -> StaffState {
        return try await run {
            let output = try await client.door_v1_staff_bars__bar_id__door_post(
                path: .init(bar_id: barId),
                body: .json(Components.Schemas.DoorIn(count: count, direction: direction.rawValue))
            )
            return Self.mapStaff(try output.ok.body.json)
        }
    }

    func setLine(barId: String, size: LineSize) async throws -> StaffState {
        return try await run {
            let output = try await client.line_v1_staff_bars__bar_id__line_post(
                path: .init(bar_id: barId),
                body: .json(Components.Schemas.LineSizeIn(line_size: size.rawValue))
            )
            return Self.mapStaff(try output.ok.body.json)
        }
    }

    // MARK: Staff line samples, door code, clicker sync

    func startLineSample(barId: String) async throws -> LineSample {
        return try await run {
            let output = try await client.start_line_sample_v1_staff_bars__bar_id__line_samples_post(
                path: .init(bar_id: barId)
            )
            return Self.mapSample(try output.created.body.json)
        }
    }

    func endLineSample(barId: String, sampleId: String, outcome: SampleOutcome) async throws -> LineSample {
        return try await run {
            let output = try await client.end_line_sample_v1_staff_bars__bar_id__line_samples__sample_id__end_post(
                path: .init(sample_id: sampleId, bar_id: barId),
                body: .json(Components.Schemas.LineSampleEndIn(outcome: outcome.rawValue))
            )
            return Self.mapSample(try output.ok.body.json)
        }
    }

    func activeLineSamples(barId: String) async throws -> [LineSample] {
        return try await run {
            let output = try await client.list_active_line_samples_v1_staff_bars__bar_id__line_samples_active_get(
                path: .init(bar_id: barId)
            )
            let rows = try output.ok.body.json
            return rows.map { Self.mapSample($0) }
        }
    }

    func doorCode(barId: String) async throws -> DoorCode {
        return try await run {
            let output = try await client.get_door_code_v1_staff_bars__bar_id__door_code_get(
                path: .init(bar_id: barId)
            )
            let value = try output.ok.body.json
            return DoorCode(code: value.code, expiresIn: value.expires_in)
        }
    }

    func countSync(barId: String, insideNow: Int) async throws -> StaffState {
        return try await run {
            let output = try await client.count_sync_v1_staff_bars__bar_id__count_sync_post(
                path: .init(bar_id: barId),
                body: .json(Components.Schemas.CountSyncIn(inside_now: insideNow))
            )
            return Self.mapStaff(try output.ok.body.json)
        }
    }

    // MARK: Staff specials

    func listSpecials(barID: String) async throws -> [Special] {
        return try await run {
            let output = try await client.staff_list_v1_staff_bars__bar_id__specials_get(
                path: .init(bar_id: barID)
            )
            let rows = try output.ok.body.json
            return rows.map { Self.mapSpecial($0) }
        }
    }

    func createSpecial(barID: String, input: SpecialInput) async throws -> Special {
        return try await run {
            let body = Components.Schemas.SpecialIn(
                all_day: input.allDay,
                days: input.days,
                details: input.details,
                end_local: input.allDay ? nil : input.endLocal,
                items: input.items.map { Self.dealItemIn($0) },
                kind: input.kind.rawValue,
                price_cents: input.priceCents,
                start_local: input.allDay ? nil : input.startLocal,
                title: input.title
            )
            let output = try await client.staff_create_v1_staff_bars__bar_id__specials_post(
                path: .init(bar_id: barID),
                body: .json(body)
            )
            return Self.mapSpecial(try output.created.body.json)
        }
    }

    func updateSpecial(barID: String, specialID: String, update: SpecialPatch) async throws -> Special {
        return try await run {
            let body = Components.Schemas.SpecialUpdate(
                all_day: update.allDay,
                days: update.days,
                details: update.details,
                end_local: update.endLocal,
                is_active: update.isActive,
                items: update.items?.map { Self.dealItemIn($0) },
                kind: update.kind?.rawValue,
                price_cents: update.priceCents,
                start_local: update.startLocal,
                title: update.title
            )
            let output = try await client.staff_update_v1_staff_bars__bar_id__specials__special_id__patch(
                path: .init(special_id: specialID, bar_id: barID),
                body: .json(body)
            )
            return Self.mapSpecial(try output.ok.body.json)
        }
    }

    func deleteSpecial(barID: String, specialID: String) async throws {
        try await run {
            _ = try await client.staff_delete_v1_staff_bars__bar_id__specials__special_id__delete(
                path: .init(special_id: specialID, bar_id: barID)
            )
        }
    }

    // MARK: Mapping generated types to domain models

    private static func dealItem(_ d: Components.Schemas.DealItemOut) -> DealItem {
        return DealItem(
            name: d.name, priceLabel: d.price_label, category: DealCategory(api: d.category),
            note: d.note ?? "")
    }

    private static func dealItemIn(_ d: DealItem) -> Components.Schemas.DealItem {
        return Components.Schemas.DealItem(
            category: d.category.rawValue, name: d.name, note: d.note, price_label: d.priceLabel)
    }

    private static func mapSpecial(_ s: Components.Schemas.SpecialOut) -> Special {
        return Special(
            id: s.id,
            kind: SpecialKind(api: s.kind),
            title: s.title,
            details: s.details,
            days: s.days,
            startLocal: s.start_local,
            endLocal: s.end_local,
            priceCents: s.price_cents,
            isActive: s.is_active,
            postedBy: PostedBy(api: s.posted_by),
            updatedAt: APIDate.parse(s.updated_at) ?? Date(),
            allDay: s.all_day,
            items: s.items.map { Self.dealItem($0) }
        )
    }

    private static func mapTonight(_ s: Components.Schemas.SpecialTonight) -> SpecialTonight {
        let special = Special(
            id: s.id,
            kind: SpecialKind(api: s.kind),
            title: s.title,
            details: s.details,
            days: s.days,
            startLocal: s.start_local,
            endLocal: s.end_local,
            priceCents: s.price_cents,
            isActive: s.is_active,
            postedBy: PostedBy(api: s.posted_by),
            updatedAt: APIDate.parse(s.updated_at) ?? Date(),
            allDay: s.all_day,
            items: s.items.map { Self.dealItem($0) }
        )
        return SpecialTonight(special: special, isNow: s.is_now)
    }

    private static func mapLocation(_ c: Coordinate?) -> Components.Schemas.LocationIn? {
        guard let c else { return nil }
        return Components.Schemas.LocationIn(latitude: c.latitude, longitude: c.longitude)
    }

    private static func mapMe(_ s: Components.Schemas.MeOut) -> Me {
        return Me(
            id: s.id,
            role: Role(api: s.role),
            waitThresholdMin: s.wait_threshold_min,
            staffBarId: s.staff_bar_id,
            phoneHint: s.phone_hint
        )
    }

    private static func mapBasis(_ s: Components.Schemas.BasisOut) -> Basis {
        return Basis(
            text: s.text,
            windowMin: s.window_min,
            reports: s.reports,
            timers: s.timers,
            doorEvents: s.door_events,
            staffLineUpdates: s.staff_line_updates
        )
    }

    private static func mapLive(_ s: Components.Schemas.LiveOut) -> Live {
        return Live(
            hasRecentData: s.has_recent_data,
            waitMin: s.wait_min,
            waitLowMin: s.wait_low_min,
            waitHighMin: s.wait_high_min,
            crowdLevel: CrowdLevel(api: s.crowd_level),
            headcount: s.headcount,
            capacityRatio: s.capacity_ratio,
            confidence: Confidence(api: s.confidence),
            basis: mapBasis(s.basis),
            flags: s.flags,
            updatedAt: APIDate.parse(s.updated_at)
        )
    }

    private static func mapVerdict(_ s: Components.Schemas.VerdictOut) -> Verdict {
        return Verdict(
            recommendation: Recommendation(api: s.recommendation),
            text: s.text,
            thresholdMin: s.threshold_min,
            passPriceCents: s.pass_price_cents,
            minutesSaved: s.minutes_saved
        )
    }

    private static func mapBar(_ s: Components.Schemas.BarSummary) -> Bar {
        return Bar(
            id: s.id,
            slug: s.slug,
            name: s.name,
            address: s.address,
            capacity: s.capacity,
            passPriceCents: s.pass_price_cents,
            live: mapLive(s.live),
            verdict: mapVerdict(s.verdict),
            specialsTonight: (s.specials_tonight ?? []).map { Self.mapTonight($0) },
            coverTonight: s.cover_tonight.map { Self.mapTonight($0) }
        )
    }

    private static func mapDetail(_ s: Components.Schemas.BarDetail) -> BarDetail {
        let summary = Bar(
            id: s.id,
            slug: s.slug,
            name: s.name,
            address: s.address,
            capacity: s.capacity,
            passPriceCents: s.pass_price_cents,
            live: mapLive(s.live),
            verdict: mapVerdict(s.verdict),
            specialsTonight: (s.specials_tonight ?? []).map { Self.mapTonight($0) },
            coverTonight: s.cover_tonight.map { Self.mapTonight($0) }
        )
        let hours: [HourPoint] = s.wait_by_hour.map { point in
            HourPoint(
                hour: point.hour,
                typicalWaitMin: point.typical_wait_min,
                tonightWaitMin: point.tonight_wait_min
            )
        }
        return BarDetail(
            bar: summary,
            latitude: s.latitude,
            longitude: s.longitude,
            normalWaitMin: s.normal_wait_min,
            waitByHour: hours,
            specialsWeek: (s.specials_week ?? []).map { Self.mapSpecial($0) }
        )
    }

    private static func mapSession(_ s: Components.Schemas.LineSessionOut) -> LineSession {
        return LineSession(
            id: s.id,
            barId: s.bar_id,
            status: SessionStatus(api: s.status),
            startedAt: APIDate.parse(s.started_at) ?? Date(),
            endedAt: APIDate.parse(s.ended_at),
            predictedWaitMin: s.predicted_wait_min,
            actualWaitMin: s.actual_wait_min,
            nearBar: s.near_bar,
            pointsAwarded: s.points_awarded ?? 0,
            verified: s.verified ?? false
        )
    }

    private static func mapSample(_ s: Components.Schemas.LineSampleOut) -> LineSample {
        return LineSample(
            id: s.id,
            barId: s.bar_id,
            status: SessionStatus(api: s.status),
            startedAt: APIDate.parse(s.started_at) ?? Date(),
            endedAt: APIDate.parse(s.ended_at),
            actualWaitMin: s.actual_wait_min
        )
    }

    private static func mapStaff(_ s: Components.Schemas.StaffState) -> StaffState {
        return StaffState(
            barId: s.bar_id,
            barName: s.bar_name,
            capacity: s.capacity,
            headcount: s.headcount,
            entriesTonight: s.entries_tonight,
            exitsTonight: s.exits_tonight,
            lineSize: LineSize(api: s.line_size),
            lineUpdatedAt: APIDate.parse(s.line_updated_at),
            live: mapLive(s.live)
        )
    }
}
