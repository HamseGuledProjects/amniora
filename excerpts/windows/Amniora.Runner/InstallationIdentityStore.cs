using System.Security.Cryptography;
using System.Text;
using NSec.Cryptography;

namespace Amniora.Runner;

internal sealed class InstallationIdentity : IDisposable
{
    private readonly Key _key;
    internal string PublicKeyPem { get; }
    internal string InstallationId { get; }

    internal InstallationIdentity(Key key)
    {
        _key = key;
        var raw = key.PublicKey.Export(KeyBlobFormat.RawPublicKey);
        var spki = Ed25519Spki(raw);
        PublicKeyPem = $"-----BEGIN PUBLIC KEY-----\n{Convert.ToBase64String(spki)}\n-----END PUBLIC KEY-----\n";
        InstallationId = $"ins_{Base64Url(SHA256.HashData(spki))}";
    }

    internal string Sign(ReadOnlySpan<byte> message) => Base64Url(SignatureAlgorithm.Ed25519.Sign(_key, message));
    public void Dispose() => _key.Dispose();

    private static byte[] Ed25519Spki(byte[] raw)
    {
        byte[] prefix = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
        return [.. prefix, .. raw];
    }

    internal static string Base64Url(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

internal sealed class InstallationIdentityStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Amniora.Runner.Identity.v1");
    private readonly string _path;

    internal InstallationIdentityStore(string? root = null)
    {
        var stateRoot = root is null ? WindowsUserPaths.ProductStateRoot() : Path.Combine(root, "Amniora", "Runner");
        _path = Path.Combine(stateRoot, "identity.v1.dpapi");
    }

    internal InstallationIdentity LoadOrCreate()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        if (File.Exists(_path)) return Import(ProtectedData.Unprotect(File.ReadAllBytes(_path), Entropy, DataProtectionScope.CurrentUser));

        using var created = Key.Create(SignatureAlgorithm.Ed25519, new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
        var raw = created.Export(KeyBlobFormat.RawPrivateKey);
        try
        {
            var protectedKey = ProtectedData.Protect(raw, Entropy, DataProtectionScope.CurrentUser);
            using var stream = new FileStream(_path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.WriteThrough);
            stream.Write(protectedKey);
            stream.Flush(true);
        }
        finally { CryptographicOperations.ZeroMemory(raw); }
        return LoadOrCreate();
    }

    internal void DeleteForUnpairOrTest() { if (File.Exists(_path)) File.Delete(_path); }

    private static InstallationIdentity Import(byte[] raw)
    {
        try { return new InstallationIdentity(Key.Import(SignatureAlgorithm.Ed25519, raw, KeyBlobFormat.RawPrivateKey)); }
        finally { CryptographicOperations.ZeroMemory(raw); }
    }
}
