namespace Amniora.Runner;

internal sealed class DiagnosticsCoordinator
{
    private int _active;
    internal async Task RefreshAsync(Func<Task<RunnerDiagnostics>> load,
        Action<RunnerDiagnostics, string> success, Action<string> acknowledgement)
    {
        if (Interlocked.Exchange(ref _active, 1) == 1) { acknowledgement("Diagnostics refresh already in progress"); return; }
        acknowledgement("Checking diagnostics…");
        try { success(await load(), $"Diagnostics refreshed {DateTimeOffset.Now:HH:mm:ss}"); }
        catch { acknowledgement("Diagnostics unavailable"); }
        finally { Volatile.Write(ref _active, 0); }
    }
}
