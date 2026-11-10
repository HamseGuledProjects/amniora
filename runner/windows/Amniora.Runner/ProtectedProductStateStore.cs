using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Amniora.Runner;

internal sealed record PendingPairing(string RequestId, string State, string Verifier, long ExpiresAt, string Origin);
internal sealed record ProductConnection(string InstallationId, string Origin, long ConnectedAt);

internal sealed class ProtectedProductStateStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Amniora.Runner.ProductState.v1");
    private readonly string _root;
    internal ProtectedProductStateStore(string? root = null) => _root = root is null ?
        WindowsUserPaths.ProductStateRoot() : Path.Combine(root, "Amniora", "Runner");

    internal void SavePending(PendingPairing value) => Save("pairing.v1.dpapi", value);
    internal PendingPairing? LoadPending() => Load<PendingPairing>("pairing.v1.dpapi");
    internal void ClearPending() => Delete("pairing.v1.dpapi");
    internal void SaveConnection(ProductConnection value) => Save("connection.v1.dpapi", value);
    internal ProductConnection? LoadConnection() => Load<ProductConnection>("connection.v1.dpapi");
    internal void ClearConnection() => Delete("connection.v1.dpapi");

    private void Save<T>(string name, T value)
    {
        Directory.CreateDirectory(_root);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(value);
        try
        {
            var protectedBytes = ProtectedData.Protect(plaintext, Entropy, DataProtectionScope.CurrentUser);
            var target = Path.Combine(_root, name); var temporary = target + ".tmp";
            using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            { stream.Write(protectedBytes); stream.Flush(true); }
            File.Move(temporary, target, true);
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    private T? Load<T>(string name)
    {
        var path = Path.Combine(_root, name); if (!File.Exists(path)) return default;
        var plaintext = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser);
        try { return JsonSerializer.Deserialize<T>(plaintext); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
    private void Delete(string name) { var path = Path.Combine(_root, name); if (File.Exists(path)) File.Delete(path); }
}
