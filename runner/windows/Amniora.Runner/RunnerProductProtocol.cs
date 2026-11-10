using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Amniora.Runner;

internal sealed class RunnerProtocolException(string safeCode) : Exception(safeCode)
{
    internal string SafeCode { get; } = safeCode;
}

internal sealed record RunnerDiagnostics(bool Connected, string Account, string VirtualMachine,
    string GuestAgent, string Docker, string Runtime);

internal sealed class RunnerProductProtocol : IDisposable
{
    internal const string Protocol = "1.0";
    internal const string Audience = "com.amniora.runner.command.v1";
    internal const string Version = "0.7.0-windows-w2";
    internal const string ProductionOrigin = "https://portfolio.example.test";
    private static readonly System.Text.RegularExpressions.Regex SafeCode =
        new("^[A-Z][A-Z0-9_]{2,63}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    private readonly Uri _origin;
    private readonly InstallationIdentity _identity;
    private readonly ProtectedProductStateStore _state;
    private readonly HttpClient _http;
    private readonly WindowsProductBridge? _bridge;
    private JsonObject? _lastResult;

    internal RunnerProductProtocol(Uri origin, InstallationIdentity identity, ProtectedProductStateStore? state = null,
        HttpMessageHandler? handler = null, WindowsProductBridge? bridge = null)
    {
        if (!IsAllowedOrigin(origin)) throw new RunnerProtocolException("RUNNER_CONFIGURATION_INVALID");
        _origin = origin; _identity = identity; _state = state ?? new ProtectedProductStateStore();
        _bridge = bridge ?? WindowsProductBridge.Discover();
        _http = handler is null ? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) : new HttpClient(handler);
        _http.BaseAddress = origin; _http.Timeout = TimeSpan.FromSeconds(10);
    }

    internal async Task<Uri> BeginPairingAsync(bool openSystemBrowser = true, CancellationToken cancellationToken = default)
    {
        var verifier = RandomValue(); var state = RandomValue(); var challenge = Digest(verifier);
        var started = await PostAsync("/api/web-labs/local-first/runner/pairing-begin", new JsonObject {
            ["protocolVersion"] = Protocol, ["audience"] = Audience, ["installationId"] = _identity.InstallationId,
            ["publicKey"] = _identity.PublicKeyPem, ["deviceName"] = "Windows PC", ["codeChallenge"] = challenge,
            ["state"] = state, ["redirectUri"] = "com.amniora.runner:/pair",
        }, cancellationToken);
        var requestId = Text(started, "authorizationRequestId"); var approval = Text(started, "approvalUrl");
        var expiresAt = Integer(started, "expiresAt");
        if (!Uri.TryCreate(approval, UriKind.Absolute, out var approvalUri) || approvalUri.Scheme != _origin.Scheme ||
            approvalUri.Host != _origin.Host || approvalUri.Port != _origin.Port) throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
        _state.SavePending(new PendingPairing(requestId, state, verifier, expiresAt, _origin.GetLeftPart(UriPartial.Authority)));
        if (openSystemBrowser) Process.Start(new ProcessStartInfo(approvalUri.AbsoluteUri) { UseShellExecute = true });
        return approvalUri;
    }

    internal async Task CompletePairingAsync(RunnerUriValue callback, CancellationToken cancellationToken = default)
    {
        if (callback.Kind != RunnerUriKind.PairCallback || callback.RequestId is null || callback.Code is null || callback.State is null)
            throw new RunnerProtocolException("PAIRING_INVALID");
        var pending = _state.LoadPending() ?? throw new RunnerProtocolException("PAIRING_INVALID");
        if (pending.RequestId != callback.RequestId || pending.State != callback.State || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= pending.ExpiresAt ||
            pending.Origin != _origin.GetLeftPart(UriPartial.Authority)) throw new RunnerProtocolException("PAIRING_INVALID");
        var proof = _identity.Sign(ProofBytes("PAIR", new Dictionary<string, string> {
            ["authorizationCodeDigest"] = Digest(callback.Code), ["authorizationRequestId"] = callback.RequestId,
            ["audience"] = Audience, ["installationId"] = _identity.InstallationId, ["protocolVersion"] = Protocol,
            ["stateDigest"] = Digest(callback.State),
        }));
        var completed = await PostAsync("/api/web-labs/local-first/runner/pairing-complete", new JsonObject {
            ["protocolVersion"] = Protocol, ["audience"] = Audience, ["authorizationRequestId"] = callback.RequestId,
            ["authorizationCode"] = callback.Code, ["installationId"] = _identity.InstallationId,
            ["codeVerifier"] = pending.Verifier, ["state"] = callback.State, ["redirectUri"] = "com.amniora.runner:/pair", ["proof"] = proof,
        }, cancellationToken);
        if (Text(completed, "installationId") != _identity.InstallationId) throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
        _state.SaveConnection(new ProductConnection(_identity.InstallationId, pending.Origin, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        _state.ClearPending();
    }

    internal async Task RedeemAndSubmitAsync(RunnerUriValue activation, CancellationToken cancellationToken = default)
    {
        if (activation.Kind != RunnerUriKind.Activate || activation.Ticket is null) throw new RunnerProtocolException("TICKET_INVALID");
        RequireConnection(); var signedAt = Now(); var clientNonce = RandomValue();
        var proof = _identity.Sign(ProofBytes("REDEEM", new Dictionary<string, string> {
            ["audience"] = Audience, ["clientNonce"] = clientNonce, ["installationId"] = _identity.InstallationId,
            ["protocolVersion"] = Protocol, ["signedAt"] = signedAt.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["ticketDigest"] = Digest(activation.Ticket),
        }));
        var command = await PostAsync("/api/web-labs/local-first/runner/redeem", new JsonObject {
            ["protocolVersion"] = Protocol, ["audience"] = Audience, ["ticket"] = activation.Ticket,
            ["installationId"] = _identity.InstallationId, ["clientNonce"] = clientNonce, ["signedAt"] = signedAt, ["proof"] = proof,
        }, cancellationToken);
        OwnerTestTrace("RedeemAccepted");
        var requestId = Text(command, "requestId"); var commandId = Text(command, "commandId");
        var operation = Text(command, "operation"); var nonce = Text(command, "nonce");
        if (Text(command, "protocolVersion") != Protocol || Text(command, "audience") != Audience ||
            Text(command, "installationId") != _identity.InstallationId || !new[] { "STATUS", "LAUNCH", "OPEN_LAB", "RESET", "STOP" }.Contains(operation) ||
            Integer(command, "expiresAt") <= Now()) throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
        var result = _bridge is null ? UnavailableResult() : await _bridge.ExecuteAsync(command, cancellationToken);
        OwnerTestTrace("BridgeCompleted");
        _lastResult = result.DeepClone() as JsonObject;
        var completedAt = Now(); var resultDigest = Digest(CanonicalResult(result));
        var resultProof = _identity.Sign(ProofBytes("RESULT", new Dictionary<string, string> {
            ["audience"] = Audience, ["commandId"] = commandId, ["completedAt"] = completedAt.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["installationId"] = _identity.InstallationId, ["nonce"] = nonce, ["operation"] = operation,
            ["protocolVersion"] = Protocol, ["requestId"] = requestId, ["resultDigest"] = resultDigest,
        }));
        await PostAsync("/api/web-labs/local-first/runner/result", new JsonObject {
            ["protocolVersion"] = Protocol, ["audience"] = Audience, ["requestId"] = requestId, ["commandId"] = commandId,
            ["installationId"] = _identity.InstallationId, ["operation"] = operation, ["nonce"] = nonce,
            ["completedAt"] = completedAt, ["result"] = result.DeepClone(), ["proof"] = resultProof,
        }, cancellationToken);
        OwnerTestTrace("ResultAccepted");
    }

    internal async Task SendPresenceAsync(CancellationToken cancellationToken = default)
    {
        RequireConnection(); var signedAt = Now(); var clientNonce = RandomValue();
        var proof = _identity.Sign(ProofBytes("PRESENCE", new Dictionary<string, string> {
            ["audience"] = Audience, ["clientNonce"] = clientNonce, ["installationId"] = _identity.InstallationId,
            ["protocolVersion"] = Protocol, ["signedAt"] = signedAt.ToString(System.Globalization.CultureInfo.InvariantCulture),
        }));
        await PostAsync("/api/web-labs/local-first/runner/presence", new JsonObject {
            ["protocolVersion"] = Protocol, ["audience"] = Audience, ["installationId"] = _identity.InstallationId,
            ["clientNonce"] = clientNonce, ["signedAt"] = signedAt, ["proof"] = proof,
        }, cancellationToken);
    }

    internal async Task UnpairAsync(CancellationToken cancellationToken = default)
    {
        RequireConnection(); var signedAt = Now(); var clientNonce = RandomValue();
        var proof = _identity.Sign(ProofBytes("UNPAIR", new Dictionary<string, string> {
            ["audience"] = Audience, ["clientNonce"] = clientNonce, ["installationId"] = _identity.InstallationId,
            ["protocolVersion"] = Protocol, ["signedAt"] = signedAt.ToString(System.Globalization.CultureInfo.InvariantCulture),
        }));
        await PostAsync("/api/web-labs/local-first/runner/unpair", new JsonObject {
            ["protocolVersion"] = Protocol, ["audience"] = Audience, ["installationId"] = _identity.InstallationId,
            ["clientNonce"] = clientNonce, ["signedAt"] = signedAt, ["proof"] = proof,
        }, cancellationToken);
        _state.ClearConnection();
    }

    internal RunnerDiagnostics Diagnostics()
    {
        var connection = _state.LoadConnection();
        if (connection is null) return new(false, "Not connected", "Not configured", "Not configured", "Not configured", "No active runtime");
        if (_bridge is null) return new(true, "Connected", "Not configured", "Not configured", "Not configured", "No active runtime");
        return _lastResult is null ? new(true, "Connected", "Check required", "Unknown", "Unknown", "No active runtime") :
            DiagnosticsFromResult(_lastResult);
    }

    internal static bool IsAllowedOrigin(Uri origin)
    {
        if (!origin.IsAbsoluteUri || !string.IsNullOrEmpty(origin.UserInfo) || origin.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.Fragment)) return false;
        var loopback = origin.Scheme == Uri.UriSchemeHttp &&
            (origin.Host.Equals("127.0.0.1", StringComparison.Ordinal) || origin.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) &&
            origin.Port is >= 1 and <= 65535;
        var production = origin.Scheme == Uri.UriSchemeHttps && origin.IsDefaultPort &&
            origin.Host.Equals("portfolio.example.test", StringComparison.OrdinalIgnoreCase);
        return loopback || production;
    }

    internal async Task<RunnerDiagnostics> RefreshDiagnosticsAsync(CancellationToken cancellationToken = default)
    {
        RequireConnection();
        if (_bridge is null) return Diagnostics();
        _lastResult = await _bridge.ExecuteAsync(new JsonObject { ["operation"] = "STATUS" }, cancellationToken);
        return DiagnosticsFromResult(_lastResult);
    }

    private static RunnerDiagnostics DiagnosticsFromResult(JsonObject value)
    {
        var vm = value["virtualMachine"] as JsonObject;
        var guest = value["guestAgent"] as JsonObject;
        var docker = value["docker"] as JsonObject;
        var runtime = value["runtime"] as JsonObject;
        var vmText = vm is null ? value["code"]?.GetValue<string>() == "VM_POWERED_OFF" ? "Unavailable" : "Not configured" :
            $"{vm["operatingSystem"]?.GetValue<string>()} {vm["architecture"]?.GetValue<string>()} · {Title(vm["state"]?.GetValue<string>())}";
        var guestText = guest is null ? "Unavailable" : Title(guest["state"]?.GetValue<string>());
        var dockerText = docker is null ? "Unavailable" :
            $"{docker["version"]?.GetValue<string>() ?? "Not installed"} · {Title(docker["state"]?.GetValue<string>())}";
        var runtimeText = runtime is null ? "No active runtime" :
            $"{runtime["labName"]?.GetValue<string>()} · {Title(runtime["state"]?.GetValue<string>())} · Generation {runtime["generation"]?.GetValue<int>()}";
        return new(true, "Connected", vmText, guestText, dockerText, runtimeText);
    }

    private static string Title(string? value) => string.IsNullOrEmpty(value) ? "Unknown" : char.ToUpperInvariant(value[0]) + value[1..];

    private void RequireConnection()
    {
        var connection = _state.LoadConnection();
        if (connection is null || connection.InstallationId != _identity.InstallationId ||
            connection.Origin != _origin.GetLeftPart(UriPartial.Authority)) throw new RunnerProtocolException("PAIRING_REVOKED");
    }

    private async Task<JsonObject> PostAsync(string path, JsonObject body, CancellationToken cancellationToken)
    {
        using var response = await _http.PostAsJsonAsync(path, body, cancellationToken);
        var envelope = await response.Content.ReadFromJsonAsync<JsonObject>(cancellationToken: cancellationToken) ??
            throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
        var error = envelope["error"] as JsonObject;
        if (!response.IsSuccessStatusCode || error is not null)
        {
            var code = error?["code"]?.GetValue<string>();
            throw new RunnerProtocolException(code is not null && SafeCode.IsMatch(code) ? code : "RUNNER_SERVER_UNAVAILABLE");
        }
        return envelope["data"] as JsonObject ?? throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
    }

    internal static byte[] ProofBytes(string label, IReadOnlyDictionary<string, string> fields)
    {
        var body = string.Join("\n", fields.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => $"{pair.Key}={pair.Value}"));
        return Encoding.UTF8.GetBytes($"AMNIORA_LOCAL_FIRST_{label}_V1\n{body}\n");
    }
    internal static string Digest(string value) => InstallationIdentity.Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    internal static string CanonicalResult(JsonObject result)
    {
        var canonical = new JsonObject {
            ["code"] = result["code"]?.DeepClone(),
            ["docker"] = CanonicalObject(result["docker"] as JsonObject, "state", "version"),
            ["guestAgent"] = CanonicalObject(result["guestAgent"] as JsonObject, "state"),
            ["ok"] = result["ok"]?.DeepClone(),
            ["runner"] = CanonicalObject(result["runner"] as JsonObject, "platform", "version"),
            ["runtime"] = CanonicalObject(result["runtime"] as JsonObject, "buildId", "generation", "labName", "runtimeId", "state"),
            ["virtualMachine"] = CanonicalObject(result["virtualMachine"] as JsonObject,
                "architecture", "name", "operatingSystem", "state"),
        };
        return canonical.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
    }

    private static JsonObject? CanonicalObject(JsonObject? source, params string[] names)
    {
        if (source is null) return null;
        var canonical = new JsonObject();
        foreach (var name in names) canonical[name] = source[name]?.DeepClone();
        return canonical;
    }
    private static JsonObject UnavailableResult() => new() {
        ["code"] = "VM_NOT_CONFIGURED", ["docker"] = null, ["guestAgent"] = null, ["ok"] = false,
        ["runner"] = new JsonObject { ["platform"] = "Windows", ["version"] = Version }, ["runtime"] = null, ["virtualMachine"] = null,
    };
    private static string RandomValue() => InstallationIdentity.Base64Url(RandomNumberGenerator.GetBytes(32));
    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static void OwnerTestTrace(string value)
    {
        if (Environment.GetEnvironmentVariable("AMNIORA_RUNNER_TEST_MODE") != "1") return;
        try
        {
            var directory = Path.Combine(Path.GetTempPath(), "Amniora", "Runner");
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "owner-test-lifecycle.log"), value + Environment.NewLine);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
    private static string Text(JsonObject value, string name) => value[name]?.GetValue<string>() ?? throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
    private static long Integer(JsonObject value, string name) => value[name]?.GetValue<long>() ?? throw new RunnerProtocolException("RUNNER_SERVER_INVALID");
    public void Dispose() => _http.Dispose();
}
