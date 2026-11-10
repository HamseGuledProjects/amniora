using System.Diagnostics;

internal static class Program
{
    private static readonly string Runner = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", "Amniora Runner", "Amniora.Runner.exe");
    private static readonly string Trace = Path.Combine(Path.GetTempPath(), "Amniora", "Runner", "owner-test-lifecycle.log");
    private static int _checks;
    private static void Check(bool value, string name) { _checks++; if (!value) throw new InvalidOperationException(name); }
    private static string Ticket(char value) => $"com.amniora.runner:/activate?ticket={new string(value, 43)}";
    private static Process[] Running() => Process.GetProcessesByName("Amniora.Runner").Where(item => !item.HasExited).ToArray();
    private static async Task<Process> WaitForRunnerAsync(int? previousPid = null)
    {
        for (var attempt = 0; attempt < 150; attempt++)
        {
            var process = Running().SingleOrDefault();
            if (process is not null && process.Id != previousPid) return process;
            await Task.Delay(100);
        }
        throw new InvalidOperationException("runner_start_timeout");
    }
    private static async Task<Process> WaitForPrimaryActivationAsync(int accepted, int? previousPid = null)
    {
        int? stablePid = null;
        var stableSamples = 0;
        for (var attempt = 0; attempt < 150; attempt++)
        {
            var lines = File.Exists(Trace) ? await File.ReadAllLinesAsync(Trace) : [];
            var running = Running();
            var process = running.Length == 1 ? running[0] : null;
            if (lines.Count(value => value == "Accept") >= accepted && process is not null && process.Id != previousPid)
            {
                if (stablePid == process.Id) stableSamples++;
                else { stablePid = process.Id; stableSamples = 1; }
                if (stableSamples >= 3) return process;
            }
            else { stablePid = null; stableSamples = 0; }
            await Task.Delay(100);
        }
        throw new InvalidOperationException($"primary_activation_timeout accepted={accepted} previousPid={previousPid}");
    }
    private static async Task<bool> WaitForSingleInstanceAsync(int expectedPid)
    {
        for (var attempt = 0; attempt < 150; attempt++)
        {
            var running = Running();
            if (running.Length == 1 && running[0].Id == expectedPid) return true;
            await Task.Delay(100);
        }
        Console.WriteLine($"Lifecycle convergence failed: expected PID {expectedPid}; observed [{string.Join(',', Running().Select(item => item.Id))}]");
        return false;
    }
    private static void Activate(string uri) => Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
    private static async Task<bool> WaitForTraceAsync(int accepted, int duplicate)
    {
        for (var attempt = 0; attempt < 150; attempt++)
        {
            var lines = File.Exists(Trace) ? await File.ReadAllLinesAsync(Trace) : [];
            if (lines.Count(value => value == "Accept") >= accepted &&
                lines.Count(value => value == "Duplicate") >= duplicate) return true;
            await Task.Delay(100);
        }
        return false;
    }

    private static Process StartOwnerTestRunner(params string[] arguments) =>
        StartOwnerTestRunnerAtOrigin("http://127.0.0.1:43119", arguments);

    private static Process StartOwnerTestRunnerAtOrigin(string origin, params string[] arguments)
    {
        var start = new ProcessStartInfo(Runner) { UseShellExecute = false };
        start.Environment["AMNIORA_RUNNER_TEST_MODE"] = "1";
        start.ArgumentList.Add("--origin"); start.ArgumentList.Add(origin);
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        return Process.Start(start) ?? throw new InvalidOperationException("runner_start_failed");
    }

    private static async Task Main()
    {
        Check(File.Exists(Runner), "installed Runner exists");
        foreach (var process in Running()) { process.Kill(true); await process.WaitForExitAsync(); }
        if (File.Exists(Trace)) File.Delete(Trace);
        Environment.SetEnvironmentVariable("AMNIORA_RUNNER_TEST_MODE", "1");
        try
        {
            Activate(Ticket('A'));
            var cold = await WaitForPrimaryActivationAsync(1);
            Check(await WaitForSingleInstanceAsync(cold.Id), "cold URI launches exactly one Runner");
            Activate(Ticket('A')); Activate(Ticket('B'));
            var warmConverged = await WaitForSingleInstanceAsync(cold.Id);
            if (!warmConverged) Console.WriteLine($"Cold Runner exited={cold.HasExited}; trace=[{string.Join(',', File.Exists(Trace) ? await File.ReadAllLinesAsync(Trace) : [])}]");
            Check(warmConverged, "duplicate and distinct warm URIs route to one instance");
            Check(await WaitForTraceAsync(2, 1), "duplicate executes once and distinct activation is not dropped");

            Check(cold.CloseMainWindow(), "window close request delivered");
            await Task.Delay(400);
            Check(!cold.HasExited, "window close keeps tray process alive");
            Activate(Ticket('C'));
            Check(await WaitForSingleInstanceAsync(cold.Id), "URI restores closed-window instance");

            var killedPid = cold.Id; cold.Kill(true); await cold.WaitForExitAsync();
            Activate(Ticket('D'));
            var relaunched = await WaitForPrimaryActivationAsync(4, killedPid);
            Check(relaunched.Id != killedPid && await WaitForSingleInstanceAsync(relaunched.Id), "force kill releases singleton and URI relaunches");

            relaunched.Kill(true); await relaunched.WaitForExitAsync();
            using var gracefulPrimary = StartOwnerTestRunner();
            var graceful = await WaitForRunnerAsync();
            using var gracefulQuit = StartOwnerTestRunner("--owner-test-quit");
            await graceful.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Check(graceful.HasExited, "normal Runner Quit exits gracefully");
            Activate(Ticket('E'));
            var afterQuit = await WaitForPrimaryActivationAsync(5, graceful.Id);
            Check(afterQuit.Id != graceful.Id && await WaitForSingleInstanceAsync(afterQuit.Id), "URI relaunches after normal Quit");

            Process.Start(new ProcessStartInfo(Runner) { UseShellExecute = false, ArgumentList = { "--origin", "http://127.0.0.1:43119",
                "com.amniora.runner:/activate?ticket=short" } });
            Check(await WaitForSingleInstanceAsync(afterQuit.Id), "malformed URI does not create a second instance");
            afterQuit.Kill(true); await afterQuit.WaitForExitAsync();
            var originCount = File.ReadAllLines(Trace).Count(value => value.StartsWith("Origin:", StringComparison.Ordinal));
            using var staleBrowser = StartOwnerTestRunnerAtOrigin("https://portfolio.example.test");
            string[] originLines = [];
            for (var attempt = 0; attempt < 150; attempt++)
            {
                originLines = File.ReadAllLines(Trace).Where(value => value.StartsWith("Origin:", StringComparison.Ordinal)).ToArray();
                if (originLines.Length > originCount) break;
                await Task.Delay(100);
            }
            Check(originLines.Length == originCount + 1 && originLines[^1] == "Origin:http://127.0.0.1:43119",
                "installed origin survives a stale browser production launch command");
            Check(await WaitForSingleInstanceAsync(staleBrowser.Id), "stale browser command retains one local Runner");
            Console.WriteLine($"Windows W1.1 installed URI lifecycle: PASS ({_checks} checks: cold, warm, duplicate, distinct, close/restore, normal Quit, force-kill recovery, malformed)");
        }
        finally
        {
            foreach (var process in Running()) { process.Kill(true); await process.WaitForExitAsync(); }
            Environment.SetEnvironmentVariable("AMNIORA_RUNNER_TEST_MODE", null);
            if (File.Exists(Trace)) File.Delete(Trace);
        }
    }
}
