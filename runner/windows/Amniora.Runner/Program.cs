using Microsoft.Win32;

namespace Amniora.Runner;

internal static class Program
{
    private const string OwnerTestQuit = "__AMNIORA_OWNER_TEST_QUIT__";

    [STAThread]
    private static async Task Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var origin = RunnerOriginConfiguration.Resolve(args);
        using var router = new SingleInstanceRouter();
        var activation = args.SingleOrDefault(value => value.StartsWith($"{ActivationUri.Scheme}:", StringComparison.OrdinalIgnoreCase));
        var ownerTestControl = Environment.GetEnvironmentVariable("AMNIORA_RUNNER_TEST_MODE") == "1";
        var ownerTestQuit = ownerTestControl && args.Contains("--owner-test-quit", StringComparer.Ordinal);
        if (!router.IsPrimary)
        {
            if (ownerTestQuit) await SingleInstanceRouter.ForwardAsync(OwnerTestQuit);
            else if (activation is not null) await SingleInstanceRouter.ForwardAsync(activation);
            return;
        }

        RegisterProtocolForCurrentUser(origin);
        if (ownerTestControl) OwnerTestTrace($"Origin:{origin.GetLeftPart(UriPartial.Authority)}");
        using var identity = new InstallationIdentityStore().LoadOrCreate();
        using var protocol = new RunnerProductProtocol(origin, identity);
        using var form = new RunnerForm();
        var gate = new ActivationGate();
        async Task HandleAsync(string value)
        {
            if (ownerTestControl && value == OwnerTestQuit) { form.QuitForOwnerTest(); return; }
            form.RestoreWindow();
            var decision = gate.EvaluateRunnerUri(value, out var parsed);
            if (ownerTestControl) OwnerTestTrace(decision.ToString());
            if (decision == ActivationDecision.Malformed) { form.SetActivity("Rejected malformed activation URI"); return; }
            if (decision == ActivationDecision.Duplicate) { form.SetActivity("Ignored duplicate activation"); return; }
            try
            {
                if (parsed!.Kind == RunnerUriKind.Connect) { form.SetActivity("Opening secure pairing approval"); await protocol.BeginPairingAsync(); }
                else if (parsed.Kind == RunnerUriKind.PairCallback) { form.SetActivity("Completing secure pairing"); await protocol.CompletePairingAsync(parsed); }
                else { form.SetActivity("Redeeming opaque one-use ticket"); await protocol.RedeemAndSubmitAsync(parsed); }
                form.ApplyDiagnostics(protocol.Diagnostics(), parsed.Kind == RunnerUriKind.PairCallback ? "Connected to Amniora" :
                    parsed.Kind == RunnerUriKind.Activate ? "Website command completed" : "Approve the request in your browser");
            }
            catch (RunnerProtocolException error)
            {
                if (ownerTestControl) OwnerTestTrace($"Error:{error.SafeCode}");
                form.SetActivity($"Request failed safely: {error.SafeCode}");
            }
            catch
            {
                if (ownerTestControl) OwnerTestTrace("Error:RUNNER_FAILED");
                form.SetActivity("Request failed safely: RUNNER_FAILED");
            }
            finally { gate.CompleteRunnerUri(parsed!); }
        }
        _ = router.ListenAsync(value => _ = HandleAsync(value));
        if (activation is not null) _ = HandleAsync(activation);
        var diagnostics = new DiagnosticsCoordinator();
        form.DiagnosticsRequested += async () => await diagnostics.RefreshAsync(
            () => protocol.RefreshDiagnosticsAsync(), form.ApplyDiagnostics, form.SetActivity);
        form.UnpairRequested += async () =>
        {
            try { form.SetActivity("Revoking Runner pairing…"); await protocol.UnpairAsync();
                form.ApplyDiagnostics(protocol.Diagnostics(), "Runner unpaired; future commands will be rejected"); }
            catch (RunnerProtocolException error) { form.SetActivity($"Unpair blocked safely: {error.SafeCode}"); }
        };
        using var presenceStop = new CancellationTokenSource();
        _ = PresenceLoopAsync(protocol, form, presenceStop.Token);
        Application.Run(form);
        presenceStop.Cancel();
    }

    private static async Task PresenceLoopAsync(RunnerProductProtocol protocol, RunnerForm form, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(12));
        while (!cancellationToken.IsCancellationRequested)
        {
            try { await protocol.SendPresenceAsync(cancellationToken); form.ApplyDiagnostics(protocol.Diagnostics(), "Amniora presence online"); }
            catch (RunnerProtocolException error) when (error.SafeCode == "PAIRING_REVOKED") { }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch { form.SetActivity("Amniora presence unavailable"); }
            try { if (!await timer.WaitForNextTickAsync(cancellationToken)) break; }
            catch (OperationCanceledException) { break; }
        }
    }

    private static void OwnerTestTrace(string value)
    {
        try
        {
            var directory = Path.Combine(Path.GetTempPath(), "Amniora", "Runner");
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "owner-test-lifecycle.log"), value + Environment.NewLine);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void RegisterProtocolForCurrentUser(Uri origin)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("RUNNER_PATH_UNAVAILABLE");
        using var scheme = Registry.CurrentUser.CreateSubKey($"Software\\Classes\\{ActivationUri.Scheme}");
        scheme.SetValue(null, "URL:Amniora Runner Protocol"); scheme.SetValue("URL Protocol", "");
        using var command = scheme.CreateSubKey("shell\\open\\command");
        command.SetValue(null, $"\"{executable}\" --origin \"{origin.GetLeftPart(UriPartial.Authority)}\" \"%1\"");
    }
}
