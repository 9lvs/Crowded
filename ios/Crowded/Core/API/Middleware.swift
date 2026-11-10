import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Adds the bearer token. On a 401, refreshes once (single flight in TokenStore) and retries.
struct AuthMiddleware: ClientMiddleware {
    let tokens: TokenStore

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        // Buffer the request body so it can be sent twice if we need to retry.
        var bodyData: Data? = nil
        if let body {
            bodyData = try await Data(collecting: body, upTo: 1_048_576)
        }

        let token: String? = await tokens.accessToken()
        var firstRequest = request
        if let token {
            firstRequest.headerFields[.authorization] = "Bearer \(token)"
        }
        let firstBody: HTTPBody? = bodyData.map { HTTPBody($0) }
        let first = try await next(firstRequest, firstBody, baseURL)
        guard first.0.status.code == 401 else {
            return first
        }

        let fresh: String
        do {
            fresh = try await tokens.refreshAccessToken(failedToken: token)
        } catch {
            return first
        }
        var retryRequest = request
        retryRequest.headerFields[.authorization] = "Bearer \(fresh)"
        let retryBody: HTTPBody? = bodyData.map { HTTPBody($0) }
        return try await next(retryRequest, retryBody, baseURL)
    }
}

/// Turns any HTTP status of 400 or more into APIError with the server's `detail` code.
struct ErrorMiddleware: ClientMiddleware {
    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        let code = response.status.code
        guard code >= 400 else {
            return (response, responseBody)
        }
        var detail = ""
        if let responseBody {
            if let data = try? await Data(collecting: responseBody, upTo: 65_536) {
                detail = APIError.detail(from: data)
            }
        }
        throw APIError.http(status: code, detail: detail)
    }
}

/// The OpenAPI runtime wraps errors thrown inside the client. Dig out the original one.
func underlyingError(_ error: Error) -> Error {
    if let clientError = error as? ClientError {
        return underlyingError(clientError.underlyingError)
    }
    return error
}
