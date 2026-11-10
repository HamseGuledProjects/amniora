namespace Amniora.Runner;

internal enum Health { Unknown, Ready, Warning, Error }

internal sealed record RunnerSnapshot(
    Health Runner,
    Health VirtualMachine,
    Health GuestAgent,
    Health Docker,
    string Account,
    string Runtime,
    string Activity)
{
    internal static RunnerSnapshot Starting => new(Health.Ready, Health.Unknown, Health.Unknown, Health.Unknown,
        "Not connected", "No active runtime", "Runner started");
}
