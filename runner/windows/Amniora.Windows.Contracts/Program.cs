using Amniora.Runner;
using Amniora.Viewer;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Amniora.Windows.Contracts;

internal static class Program
{
    private static int _checks;
    private static void Check(bool condition, string name) { _checks++; if (!condition) throw new InvalidOperationException(name); }

    private static async Task Main()
    {
        const string ticket = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        var uri = $"com.amniora.runner:/activate?ticket={ticket}";
        Check(ActivationUri.TryParse(uri, out var parsed) && parsed!.Ticket == ticket, "valid opaque URI");
        foreach (var invalid in new[] {
            "https://example.com/activate?ticket=" + ticket,
            "com.amniora.runner:/activate?ticket=short",
            "com.amniora.runner:/activate?ticket=" + ticket + "&account=owner",
            "com.amniora.runner://host/activate?ticket=" + ticket,
            "com.amniora.runner:/other?ticket=" + ticket,
        }) Check(!ActivationUri.TryParse(invalid, out _), $"reject {invalid}");

        var gate = new ActivationGate();
        Check(gate.Evaluate(uri, out _) == ActivationDecision.Accept, "first activation accepted");
        Check(gate.Evaluate(uri, out _) == ActivationDecision.Duplicate, "duplicate activation ignored");
        Check(gate.Evaluate("bad", out _) == ActivationDecision.Malformed, "malformed activation rejected");

        var temp = Path.Combine(Path.GetTempPath(), "amniora-w1-identity-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new InstallationIdentityStore(temp);
            string firstId;
            using (var first = store.LoadOrCreate()) { firstId = first.InstallationId; Check(first.PublicKeyPem.Contains("PUBLIC KEY"), "public key exported"); }
            using (var second = store.LoadOrCreate()) Check(second.InstallationId == firstId, "DPAPI identity persists");
            var protectedBytes = File.ReadAllBytes(Path.Combine(temp, "Amniora", "Runner", "identity.v1.dpapi"));
            Check(!System.Text.Encoding.UTF8.GetString(protectedBytes).Contains("PRIVATE KEY"), "no plaintext private key");
            store.DeleteForUnpairOrTest();
            Check(!File.Exists(Path.Combine(temp, "Amniora", "Runner", "identity.v1.dpapi")), "test identity cleanup");
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, true); }

        const string authority = "88888888888888888888888888888888-g11";
        Check(ViewerPolicy.ValidAuthority(authority), "generation authority accepted");
        Check(!ViewerPolicy.ValidAuthority("localhost"), "localhost authority denied");
        Check(ViewerPolicy.IsAllowed(new Uri($"https://{authority}.lab.amniora.invalid/path"), authority), "same generation allowed");
        foreach (var destination in new[] { "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.1/",
            "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "https://example.com/",
            "com.amniora.runner:/activate?ticket=" + ticket, "file:///C:/Windows/win.ini",
            "https://99999999999999999999999999999999-g11.lab.amniora.invalid/" })
            Check(ViewerPolicy.IsDeniedDestination(new Uri(destination), authority), $"viewer denied {destination}");

        Check(ArchitectureContract.WindowsHost(Architecture.X64) == "windows/amd64", "Windows x64 normalization");
        Check(ArchitectureContract.WindowsHost(Architecture.Arm64) == "windows/arm64", "Windows ARM64 contract");
        Check(ArchitectureContract.SupportedGuest("linux/amd64"), "Linux AMD64 guest contract");
        Check(ArchitectureContract.SupportedGuest("linux/arm64"), "Linux ARM64 guest contract");
        Check(!ArchitectureContract.SupportedGuest("windows/amd64"), "host architecture cannot be guest target");

        Check(RunnerUri.TryParse("com.amniora.runner:/connect", out var connect) && connect!.Kind == RunnerUriKind.Connect,
            "connect URI accepted without authority fields");
        var pairUri = $"com.amniora.runner:/pair?request=par_{ticket}&code={ticket}&state={ticket}";
        Check(RunnerUri.TryParse(pairUri, out var pairCallback) && pairCallback!.Kind == RunnerUriKind.PairCallback,
            "strict pairing callback accepted");
        var runnerGate = new ActivationGate();
        const string connectUri = "com.amniora.runner:/connect";
        Check(runnerGate.EvaluateRunnerUri(connectUri, out var firstConnect) == ActivationDecision.Accept,
            "first Connect intent accepted");
        Check(runnerGate.EvaluateRunnerUri(connectUri, out var duplicateConnect) == ActivationDecision.Duplicate,
            "concurrent Connect coalesced while approval opens");
        runnerGate.CompleteRunnerUri(duplicateConnect!);
        Check(runnerGate.EvaluateRunnerUri(connectUri, out _) == ActivationDecision.Duplicate,
            "duplicate Connect cannot release the accepted attempt");
        runnerGate.CompleteRunnerUri(firstConnect!);
        Check(runnerGate.EvaluateRunnerUri(connectUri, out var retryConnect) == ActivationDecision.Accept,
            "same Connect link retries after the previous attempt finishes");
        runnerGate.CompleteRunnerUri(firstConnect!);
        Check(runnerGate.EvaluateRunnerUri(connectUri, out _) == ActivationDecision.Duplicate,
            "stale completion cannot release a newer Connect attempt");
        runnerGate.CompleteRunnerUri(retryConnect!);
        Check(runnerGate.EvaluateRunnerUri(connectUri, out var failedConnect) == ActivationDecision.Accept,
            "Connect starts again after a completed retry");
        try { throw new RunnerProtocolException("PAIRING_INVALID"); }
        catch (RunnerProtocolException) { }
        finally { runnerGate.CompleteRunnerUri(failedConnect!); }
        Check(runnerGate.EvaluateRunnerUri(connectUri, out var recoveredConnect) == ActivationDecision.Accept,
            "failed Connect releases its in-flight intent for recovery");
        runnerGate.CompleteRunnerUri(recoveredConnect!);
        Check(runnerGate.EvaluateRunnerUri(pairUri, out var acceptedCallback) == ActivationDecision.Accept,
            "one-use pairing callback accepted once");
        runnerGate.CompleteRunnerUri(acceptedCallback!);
        Check(runnerGate.EvaluateRunnerUri(pairUri, out _) == ActivationDecision.Duplicate,
            "completion does not weaken pairing callback replay protection");
        Check(runnerGate.EvaluateRunnerUri(uri, out var acceptedCommand) == ActivationDecision.Accept,
            "one-use command activation accepted once");
        runnerGate.CompleteRunnerUri(acceptedCommand!);
        Check(runnerGate.EvaluateRunnerUri(uri, out _) == ActivationDecision.Duplicate,
            "completion does not weaken command ticket replay protection");
        Check(runnerGate.EvaluateRunnerUri("com.amniora.runner:/connect?ticket=" + ticket, out _) == ActivationDecision.Malformed,
            "Connect retries cannot carry command authority");
        Check(RunnerProductProtocol.IsAllowedOrigin(new Uri("https://portfolio.example.test/")),
            "exact production origin accepted");
        Check(RunnerProductProtocol.IsAllowedOrigin(new Uri("http://127.0.0.1:43119/")),
            "loopback rehearsal origin accepted");
        foreach (var deniedOrigin in new[] { "http://portfolio.example.test/", "https://portfolio.example.test/", "https://portfolio.example.test:444/",
            "https://portfolio.example.test/path", "https://portfolio.example.test/?next=evil", "https://user@portfolio.example.test/",
            "https://example.com/", "http://192.168.63.2:43119/" })
            Check(!RunnerProductProtocol.IsAllowedOrigin(new Uri(deniedOrigin)), $"Runner origin denied {deniedOrigin}");
        var originDirectory = Path.Combine(Path.GetTempPath(), "amniora-w1-origin-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(originDirectory);
        try
        {
            Check(RunnerOriginConfiguration.Resolve([], originDirectory).AbsoluteUri == "https://portfolio.example.test/",
                "uninstalled Runner defaults to exact production origin");
            Check(RunnerOriginConfiguration.Resolve(["--origin", "http://127.0.0.1:43119"], originDirectory).Port == 43119,
                "uninstalled development Runner accepts explicit local origin");
            File.WriteAllText(Path.Combine(originDirectory, RunnerOriginConfiguration.FileName), "http://127.0.0.1:43119\n");
            var pinned = RunnerOriginConfiguration.Resolve(["--origin", "https://portfolio.example.test"], originDirectory);
            Check(pinned.GetLeftPart(UriPartial.Authority) == "http://127.0.0.1:43119",
                "installed local origin overrides stale browser production command");
            File.WriteAllText(Path.Combine(originDirectory, RunnerOriginConfiguration.FileName), "https://portfolio.example.test");
            Check(RunnerOriginConfiguration.Resolve(["--origin", "http://127.0.0.1:43119"], originDirectory).Host == "portfolio.example.test",
                "installed production origin cannot be redirected by launch arguments");
            foreach (var invalid in new[] { "", "https://example.com", "http://192.168.1.1:43119", "https://portfolio.example.test/path" })
            {
                File.WriteAllText(Path.Combine(originDirectory, RunnerOriginConfiguration.FileName), invalid);
                try { RunnerOriginConfiguration.Resolve(["--origin", "http://127.0.0.1:43119"], originDirectory);
                    throw new InvalidOperationException("invalid installed origin accepted"); }
                catch (RunnerProtocolException error) { Check(error.SafeCode == "RUNNER_CONFIGURATION_INVALID",
                    "invalid installed origin fails closed without launch-argument fallback"); }
            }
        }
        finally { Directory.Delete(originDirectory, true); }
        var bridgeEnvironment = WindowsProductBridge.SafeChildEnvironment();
        var configuredProduct = Path.Combine(Path.GetTempPath(), "amniora-w1-path-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(configuredProduct, "resources", "bin"));
        try
        {
            File.WriteAllText(Path.Combine(configuredProduct, "product-state-root.v1"), @"C:\Users\example\.amniora\runner");
            Check(WindowsUserPaths.ProductStateRoot(@"C:\Virtualized\Profile", Path.Combine(configuredProduct, "resources", "bin")) ==
                @"C:\Users\example\.amniora\runner", "installed product state ignores packaged-app folder virtualization");
        }
        finally { Directory.Delete(configuredProduct, true); }
        foreach (var name in new[] { "SystemRoot", "WINDIR", "LOCALAPPDATA", "AMNIORA_WINDOWS_STATE_ROOT", "USERPROFILE", "TEMP", "TMP", "PATH" })
            Check(bridgeEnvironment.TryGetValue(name, out var environmentPath) && Path.IsPathFullyQualified(environmentPath),
                $"bridge derives absolute {name} without browser inheritance");

        var readyResult = new JsonObject {
            ["ok"] = true, ["code"] = null,
            ["runner"] = new JsonObject { ["version"] = "0.7.0-windows-w2", ["platform"] = "Windows" },
            ["virtualMachine"] = new JsonObject { ["name"] = "Amniora-Windows-Test", ["operatingSystem"] = "Ubuntu 24.04",
                ["architecture"] = "amd64", ["state"] = "ready" },
            ["guestAgent"] = new JsonObject { ["state"] = "ready" },
            ["docker"] = new JsonObject { ["version"] = "29.8.2", ["state"] = "ready" },
            ["runtime"] = new JsonObject { ["buildId"] = "phase3-amd64-xss-build",
                ["runtimeId"] = "33a71431c3e4435a9ca9e7b1dac45840", ["generation"] = 1,
                ["labName"] = "Northline Desk", ["state"] = "stopped" },
        };
        const string canonicalReady = "{\"code\":null,\"docker\":{\"state\":\"ready\",\"version\":\"29.8.2\"}," +
            "\"guestAgent\":{\"state\":\"ready\"},\"ok\":true,\"runner\":{\"platform\":\"Windows\",\"version\":\"0.7.0-windows-w2\"}," +
            "\"runtime\":{\"buildId\":\"phase3-amd64-xss-build\",\"generation\":1,\"labName\":\"Northline Desk\"," +
            "\"runtimeId\":\"33a71431c3e4435a9ca9e7b1dac45840\",\"state\":\"stopped\"}," +
            "\"virtualMachine\":{\"architecture\":\"amd64\",\"name\":\"Amniora-Windows-Test\"," +
            "\"operatingSystem\":\"Ubuntu 24.04\",\"state\":\"ready\"}}";
        Check(RunnerProductProtocol.CanonicalResult(readyResult) == canonicalReady,
            "ready-state result canonicalization ignores bridge insertion order");

        var diagnosticMessages = new List<string>(); var coordinator = new DiagnosticsCoordinator();
        await coordinator.RefreshAsync(() => Task.FromResult(new RunnerDiagnostics(false, "Not connected", "Not configured", "Not configured", "Not configured", "No active runtime")),
            (_, message) => diagnosticMessages.Add(message), diagnosticMessages.Add);
        Check(diagnosticMessages.Any(message => message.StartsWith("Diagnostics refreshed", StringComparison.Ordinal)), "diagnostics no-change acknowledgement");
        await coordinator.RefreshAsync(() => Task.FromException<RunnerDiagnostics>(new IOException("test")), (_, _) => { }, diagnosticMessages.Add);
        Check(diagnosticMessages.Contains("Diagnostics unavailable"), "diagnostics failure acknowledgement");
        var hold = new TaskCompletionSource<RunnerDiagnostics>(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstRefresh = coordinator.RefreshAsync(() => hold.Task, (_, _) => { }, diagnosticMessages.Add);
        await coordinator.RefreshAsync(() => Task.FromResult(protocolDiagnostics()), (_, _) => { }, diagnosticMessages.Add);
        Check(diagnosticMessages.Contains("Diagnostics refresh already in progress"), "diagnostics double-click coalesced");
        hold.SetResult(protocolDiagnostics()); await firstRefresh;

        using (var router = new SingleInstanceRouter())
        {
            Check(router.IsPrimary, "test owns primary instance");
            var received = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            _ = router.ListenAsync(value => received.TrySetResult(value));
            try { await SingleInstanceRouter.ForwardAsync(new string('X', ActivationUri.MaxBytes + 1)); }
            catch (IOException) { }
            await Task.Delay(100);
            Check(!received.Task.IsCompleted, "oversized named-pipe activation rejected");
            await SingleInstanceRouter.ForwardAsync(uri);
            Check(await received.Task.WaitAsync(TimeSpan.FromSeconds(3)) == uri, "warm activation routed once");
        }

        Console.WriteLine($"Windows W1 native contracts: PASS ({_checks} checks: DPAPI identity, URI validation/deduplication, single-instance routing, generation-bound viewer policy)");
    }

    private static RunnerDiagnostics protocolDiagnostics() => new(false, "Not connected", "Not configured", "Not configured", "Not configured", "No active runtime");
}
