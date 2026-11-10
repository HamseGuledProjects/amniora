using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Amniora.Runner;

internal sealed class WindowsProductBridge
{
    private static readonly Regex FailureCode = new("^[A-Z][A-Z0-9_]{2,63}$", RegexOptions.CultureInvariant);
    private readonly string _node;
    private readonly string _entry;

    private WindowsProductBridge(string node, string entry) { _node = node; _entry = entry; }

    internal static WindowsProductBridge? Discover()
    {
        var entry = Environment.GetEnvironmentVariable("AMNIORA_WINDOWS_PRODUCT_BRIDGE") ??
            Path.Combine(AppContext.BaseDirectory, "resources", "bin", "amniora-windows-product.cjs");
        var node = Environment.GetEnvironmentVariable("AMNIORA_WINDOWS_NODE") ??
            Path.Combine(AppContext.BaseDirectory, "resources", "bin", "node.exe");
        return File.Exists(entry) && File.Exists(node) ? new WindowsProductBridge(node, entry) : null;
    }

    internal async Task<JsonObject> ExecuteAsync(JsonObject command, CancellationToken cancellationToken = default)
    {
        var start = new ProcessStartInfo(_node) {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = AppContext.BaseDirectory,
        };
        start.ArgumentList.Add(_entry);
        start.ArgumentList.Add("execute");
        start.Environment.Clear();
        foreach (var (name, value) in SafeChildEnvironment()) start.Environment[name] = value;
        CopyEnvironment(start, "AMNIORA_WINDOWS_IDENTITY_HELPER");
        start.Environment["NODE_ENV"] = "production";
        using var process = Process.Start(start) ?? throw new RunnerProtocolException("GUEST_AGENT_UNAVAILABLE");
        await process.StandardInput.WriteAsync(command.ToJsonString().AsMemory(), cancellationToken);
        process.StandardInput.Close();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(75));
        var stdoutTask = process.StandardOutput.ReadToEndAsync(deadline.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(deadline.Token);
        try { await process.WaitForExitAsync(deadline.Token); }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            if (cancellationToken.IsCancellationRequested) throw;
            throw new RunnerProtocolException("GUEST_AGENT_UNAVAILABLE");
        }
        var stdout = await stdoutTask; var stderr = await stderrTask;
        if (stdout.Length > 128 * 1024 || stderr.Length > 4 * 1024) throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID");
        if (process.ExitCode != 0)
        {
            var code = stderr.Trim();
            throw new RunnerProtocolException(FailureCode.IsMatch(code) ? code : "GUEST_AGENT_UNAVAILABLE");
        }
        JsonObject result;
        try { result = JsonNode.Parse(stdout) as JsonObject ?? throw new FormatException(); }
        catch { throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID"); }
        Validate(result);
        return result;
    }

    internal static IReadOnlyDictionary<string, string> SafeChildEnvironment()
    {
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        // Custom-protocol launches can inherit packaged-app folder virtualization from the browser.
        // Always point the bridge at the Runner's stable, per-user product state instead.
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var stateRoot = WindowsUserPaths.ProductStateRoot();
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var temporary = Path.GetTempPath();
        if (!Path.IsPathFullyQualified(windows) || !Path.IsPathFullyQualified(localAppData) ||
            !Path.IsPathFullyQualified(userProfile) || !Path.IsPathFullyQualified(temporary))
            throw new RunnerProtocolException("RUNNER_CONFIGURATION_INVALID");
        return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            ["SystemRoot"] = windows,
            ["WINDIR"] = windows,
            ["LOCALAPPDATA"] = localAppData,
            ["AMNIORA_WINDOWS_STATE_ROOT"] = stateRoot,
            ["USERPROFILE"] = userProfile,
            ["TEMP"] = temporary,
            ["TMP"] = temporary,
            ["PATH"] = Path.Combine(windows, "System32"),
        };
    }

    private static void Validate(JsonObject value)
    {
        if (value.Count != 7 || value["ok"] is not JsonValue ok || !ok.TryGetValue<bool>(out _) ||
            value["runner"] is not JsonObject runner || runner["platform"]?.GetValue<string>() != "Windows" ||
            runner["version"] is not JsonValue version || !version.TryGetValue<string>(out var versionText) || versionText.Length > 64 ||
            value["code"] is JsonValue code && (!code.TryGetValue<string>(out var codeText) || !FailureCode.IsMatch(codeText)) ||
            value["virtualMachine"] is not (null or JsonObject) || value["guestAgent"] is not (null or JsonObject) ||
            value["docker"] is not (null or JsonObject) || value["runtime"] is not (null or JsonObject))
            throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID");
        if (value["virtualMachine"] is JsonObject vm &&
            (vm["name"]?.GetValue<string>() != "Amniora-Windows-Test" || vm["operatingSystem"]?.GetValue<string>() != "Ubuntu 24.04" ||
             vm["architecture"]?.GetValue<string>() is not ("amd64" or "arm64") || vm["state"]?.GetValue<string>() is not ("ready" or "unavailable" or "unknown")))
            throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID");
        if (value["guestAgent"] is JsonObject guest && guest["state"]?.GetValue<string>() is not ("ready" or "unavailable" or "unknown"))
            throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID");
        if (value["docker"] is JsonObject docker && docker["state"]?.GetValue<string>() is not ("ready" or "unavailable" or "unknown"))
            throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID");
        if (value["runtime"] is JsonObject runtime &&
            (runtime["runtimeId"]?.GetValue<string>() is not string runtimeId || !Regex.IsMatch(runtimeId, "^[a-f0-9]{32}$") ||
             runtime["buildId"]?.GetValue<string>() is not string buildId || buildId.Length is < 1 or > 128 ||
             runtime["generation"] is not JsonValue generation || !generation.TryGetValue<int>(out var generationValue) || generationValue < 1 ||
             runtime["labName"]?.GetValue<string>() is not string labName || labName.Length is < 1 or > 128 ||
             runtime["state"]?.GetValue<string>() is not ("stopped" or "starting" or "running" or "resetting" or "stopping" or "failed")))
            throw new RunnerProtocolException("RUNNER_BRIDGE_INVALID");
    }

    private static void CopyEnvironment(ProcessStartInfo start, string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (!string.IsNullOrEmpty(value)) start.Environment[name] = value;
    }
}
