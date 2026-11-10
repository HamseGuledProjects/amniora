import CryptoKit
import Foundation
import Security

private let keychainService = "com.amniora.runner.phase1"
private let keychainAccount = "installation-ed25519-private-key"

private enum SignerFailure: Error { case invalid }

private func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

private func decodeBase64URL(_ value: String) throws -> Data {
    guard value.range(of: "^[A-Za-z0-9_-]{1,8192}$", options: .regularExpression) != nil else { throw SignerFailure.invalid }
    var text = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    text += String(repeating: "=", count: (4 - text.count % 4) % 4)
    guard let data = Data(base64Encoded: text), data.count <= 6144 else { throw SignerFailure.invalid }
    return data
}

private struct Identity {
    let key: Curve25519.Signing.PrivateKey
    let installationId: String
    let publicKey: String
}

private func loadOrCreate() throws -> Identity {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService, kSecAttrAccount as String: keychainAccount]
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &item)
    let key: Curve25519.Signing.PrivateKey
    if status == errSecSuccess, let data = item as? Data {
        key = try Curve25519.Signing.PrivateKey(rawRepresentation: data)
    } else if status == errSecItemNotFound {
        let generated = Curve25519.Signing.PrivateKey()
        var addition = query
        addition[kSecValueData as String] = generated.rawRepresentation
        addition[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw SignerFailure.invalid }
        key = generated
    } else { throw SignerFailure.invalid }
    let prefix = Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
    let spki = prefix + key.publicKey.rawRepresentation
    let encoded = spki.base64EncodedString()
    var lines: [String] = []
    var index = encoded.startIndex
    while index < encoded.endIndex {
        let end = encoded.index(index, offsetBy: 64, limitedBy: encoded.endIndex) ?? encoded.endIndex
        lines.append(String(encoded[index..<end])); index = end
    }
    return Identity(key: key, installationId: "ins_\(base64URL(Data(SHA256.hash(data: spki))))",
        publicKey: "-----BEGIN PUBLIC KEY-----\n\(lines.joined(separator: "\n"))\n-----END PUBLIC KEY-----\n")
}

private func output(_ identity: Identity, signature: Data? = nil) throws {
    var value: [String: String] = ["installationId": identity.installationId, "publicKey": identity.publicKey]
    if let signature { value["signature"] = base64URL(signature) }
    let data = try JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let identity = try loadOrCreate()
    if arguments == ["identity"] { try output(identity) }
    else if arguments.count == 2, arguments[0] == "sign" {
        try output(identity, signature: try identity.key.signature(for: decodeBase64URL(arguments[1])))
    } else { throw SignerFailure.invalid }
} catch {
    FileHandle.standardError.write(Data("SIGNER_FAILED\n".utf8)); exit(1)
}
