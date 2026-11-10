import AppKit
import CryptoKit
import Foundation
import Security

private let protocolVersion = "1.0"
private let audience = "com.amniora.runner.command.v1"
private let activationScheme = "com.amniora.runner"
private let runnerVersion = "0.1.0-phase1"
private let keychainService = "com.amniora.runner.phase1"
private let keychainAccount = "installation-ed25519-private-key"
private let maximumURIBytes = 256

private enum RunnerFailure: Error {
    case configuration
    case identity
    case invalidURI(String)
    case invalidResponse
    case network
}

private func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func randomValue() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw RunnerFailure.identity
    }
    return base64URL(Data(bytes))
}

private func sha256(_ data: Data) -> Data {
    Data(SHA256.hash(data: data))
}

private func canonicalBytes(label: String, fields: [String: String]) -> Data {
    let body = fields.keys.sorted().map { "\($0)=\(fields[$0]!)" }.joined(separator: "\n")
    return Data("AMNIORA_LOCAL_FIRST_\(label)_V1\n\(body)\n".utf8)
}

private struct InstallationIdentity {
    let key: Curve25519.Signing.PrivateKey
    let installationId: String
    let publicKeyPEM: String
}

private enum KeychainIdentityStore {
    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    static func loadOrCreate() throws -> InstallationIdentity {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        let key: Curve25519.Signing.PrivateKey
        if status == errSecSuccess, let data = item as? Data {
            guard let existing = try? Curve25519.Signing.PrivateKey(rawRepresentation: data) else {
                throw RunnerFailure.identity
            }
            key = existing
        } else if status == errSecItemNotFound {
            let generated = Curve25519.Signing.PrivateKey()
            var addition = query
            addition[kSecValueData as String] = generated.rawRepresentation
            addition[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else {
                throw RunnerFailure.identity
            }
            key = generated
        } else {
            throw RunnerFailure.identity
        }

        let rawPublicKey = key.publicKey.rawRepresentation
        let spkiPrefix = Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
        let spki = spkiPrefix + rawPublicKey
        let encoded = spki.base64EncodedString()
        var lines: [String] = []
        var index = encoded.startIndex
        while index < encoded.endIndex {
            let end = encoded.index(index, offsetBy: 64, limitedBy: encoded.endIndex) ?? encoded.endIndex
            lines.append(String(encoded[index..<end]))
            index = end
        }
        let pem = "-----BEGIN PUBLIC KEY-----\n\(lines.joined(separator: "\n"))\n-----END PUBLIC KEY-----\n"
        return InstallationIdentity(
            key: key,
            installationId: "ins_\(base64URL(sha256(spki)))",
            publicKeyPEM: pem
        )
    }
}

private final class EventLog {
    private let path: String

    init(path: String) throws {
        guard path.hasPrefix("/") else { throw RunnerFailure.configuration }
        self.path = path
        let manager = FileManager.default
        if !manager.fileExists(atPath: path) {
            guard manager.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                throw RunnerFailure.configuration
            }
        }
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    }

    func write(_ fields: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(fields),
              let data = try? JSONSerialization.data(withJSONObject: fields),
              let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: path)) else { return }
        defer { try? handle.close() }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.write(contentsOf: Data("\n".utf8))
        } catch { /* A diagnostic log must never widen command authority. */ }
    }
}

private struct Configuration {
    let serverOrigin: URL
    let eventLogPath: String

    static func load(arguments: [String]) throws -> Configuration {
        let defaults = UserDefaults.standard
        var originText: String?
        var logPath: String?
        var index = 1
        while index < arguments.count {
            switch arguments[index] {
            case "--server-origin" where index + 1 < arguments.count:
                originText = arguments[index + 1]
                index += 2
            case "--event-log" where index + 1 < arguments.count:
                logPath = arguments[index + 1]
                index += 2
            default:
                throw RunnerFailure.configuration
            }
        }
        if let originText { defaults.set(originText, forKey: "phase1.serverOrigin") }
        if let logPath { defaults.set(logPath, forKey: "phase1.eventLogPath") }
        guard let storedOrigin = originText ?? defaults.string(forKey: "phase1.serverOrigin"),
              let storedLog = logPath ?? defaults.string(forKey: "phase1.eventLogPath"),
              let origin = URL(string: storedOrigin), origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil, origin.path.isEmpty,
              (origin.scheme == "https" || (origin.scheme == "http" && origin.host == "127.0.0.1")) else {
            throw RunnerFailure.configuration
        }
        return Configuration(serverOrigin: origin, eventLogPath: storedLog)
    }
}

private final class RunnerCoordinator {
    private let configuration: Configuration
    private let identity: InstallationIdentity
    private let eventLog: EventLog
    private var handledTicketDigests = Set<String>()

    init(configuration: Configuration) throws {
        self.configuration = configuration
        identity = try KeychainIdentityStore.loadOrCreate()
        eventLog = try EventLog(path: configuration.eventLogPath)
        eventLog.write([
            "type": "ready",
            "installationId": identity.installationId,
            "publicKey": identity.publicKeyPEM,
        ])
    }

    func activate(url: URL) {
        do {
            let ticket = try parseActivation(url)
            let ticketDigest = base64URL(sha256(Data(ticket.utf8)))
            guard handledTicketDigests.insert(ticketDigest).inserted else {
                eventLog.write(["type": "activation_rejected", "code": "DUPLICATE_ACTIVATION"])
                return
            }
            eventLog.write(["type": "activation_received"])
            Task { @MainActor in
                do {
                    let command = try await redeem(ticket: ticket)
                    try await submitStatus(command: command)
                    eventLog.write(["type": "operation_completed", "operation": "STATUS",
                                    "requestId": command["requestId"] as! String])
                } catch {
                    eventLog.write(["type": "operation_rejected", "code": "REDEMPTION_FAILED"])
                }
            }
        } catch RunnerFailure.invalidURI(let code) {
            eventLog.write(["type": "activation_rejected", "code": code])
        } catch {
            eventLog.write(["type": "activation_rejected", "code": "MALFORMED_URI"])
        }
    }

    private func parseActivation(_ url: URL) throws -> String {
        let absolute = url.absoluteString
        guard absolute.lengthOfBytes(using: .utf8) <= maximumURIBytes else {
            throw RunnerFailure.invalidURI("URI_TOO_LARGE")
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == activationScheme,
              components.host == nil,
              components.user == nil,
              components.password == nil,
              components.port == nil,
              components.fragment == nil else {
            throw RunnerFailure.invalidURI("MALFORMED_URI")
        }
        guard components.path == "/activate" else { throw RunnerFailure.invalidURI("UNKNOWN_ACTION") }
        guard let items = components.queryItems, items.count == 1, items[0].name == "ticket",
              let ticket = items[0].value, ticket.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              components.percentEncodedQuery == "ticket=\(ticket)" else {
            throw RunnerFailure.invalidURI("TICKET_INVALID")
        }
        return ticket
    }

    private func request(path: String, object: [String: Any]) async throws -> [String: Any] {
        let endpoint = configuration.serverOrigin.appending(path: path)
        var request = URLRequest(url: endpoint, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: object)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), data.count <= 16_384,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RunnerFailure.network
        }
        return value
    }

    private func redeem(ticket: String) async throws -> [String: Any] {
        let clientNonce = try randomValue()
        let signedAt = Int64(Date().timeIntervalSince1970 * 1_000)
        let proofBytes = canonicalBytes(label: "REDEEM", fields: [
            "audience": audience,
            "clientNonce": clientNonce,
            "installationId": identity.installationId,
            "protocolVersion": protocolVersion,
            "signedAt": String(signedAt),
            "ticketDigest": base64URL(sha256(Data(ticket.utf8))),
        ])
        let response = try await request(path: "/api/phase1/redeem", object: [
            "protocolVersion": protocolVersion,
            "audience": audience,
            "ticket": ticket,
            "installationId": identity.installationId,
            "clientNonce": clientNonce,
            "signedAt": signedAt,
            "proof": base64URL(try identity.key.signature(for: proofBytes)),
        ])
        let expected = Set(["protocolVersion", "audience", "requestId", "commandId", "installationId", "operation",
                            "buildId", "runtimeId", "generation", "nonce", "issuedAt", "expiresAt"])
        guard Set(response.keys) == expected,
              response["protocolVersion"] as? String == protocolVersion,
              response["audience"] as? String == audience,
              response["installationId"] as? String == identity.installationId,
              response["operation"] as? String == "STATUS",
              response["buildId"] is NSNull, response["runtimeId"] is NSNull, response["generation"] is NSNull,
              let requestId = response["requestId"] as? String,
              let commandId = response["commandId"] as? String,
              let nonce = response["nonce"] as? String,
              requestId.range(of: "^req_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              commandId.range(of: "^cmd_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              nonce.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            throw RunnerFailure.invalidResponse
        }
        return response
    }

    private func submitStatus(command: [String: Any]) async throws {
        guard let requestId = command["requestId"] as? String,
              let commandId = command["commandId"] as? String,
              let nonce = command["nonce"] as? String else { throw RunnerFailure.invalidResponse }
        let completedAt = Int64(Date().timeIntervalSince1970 * 1_000)
        let result: [String: Any] = ["status": "AVAILABLE", "runnerVersion": runnerVersion, "platform": "macOS"]
        let resultCanonical = Data("{\"platform\":\"macOS\",\"runnerVersion\":\"\(runnerVersion)\",\"status\":\"AVAILABLE\"}".utf8)
        let proofBytes = canonicalBytes(label: "RESULT", fields: [
            "audience": audience,
            "commandId": commandId,
            "completedAt": String(completedAt),
            "installationId": identity.installationId,
            "nonce": nonce,
            "operation": "STATUS",
            "protocolVersion": protocolVersion,
            "requestId": requestId,
            "resultDigest": base64URL(sha256(resultCanonical)),
        ])
        _ = try await request(path: "/api/phase1/results", object: [
            "protocolVersion": protocolVersion,
            "audience": audience,
            "requestId": requestId,
            "commandId": commandId,
            "installationId": identity.installationId,
            "operation": "STATUS",
            "nonce": nonce,
            "completedAt": completedAt,
            "result": result,
            "proof": base64URL(try identity.key.signature(for: proofBytes)),
        ])
    }
}

private final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private var coordinator: RunnerCoordinator?
    private var pendingURLs: [URL] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            coordinator = try RunnerCoordinator(configuration: Configuration.load(arguments: CommandLine.arguments))
            for url in pendingURLs { coordinator?.activate(url: url) }
            pendingURLs.removeAll()
        } catch {
            NSApplication.shared.terminate(nil)
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard let coordinator else {
            pendingURLs.append(contentsOf: urls)
            return
        }
        for url in urls { coordinator.activate(url: url) }
    }
}

private let application = NSApplication.shared
private let delegate = ApplicationDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
