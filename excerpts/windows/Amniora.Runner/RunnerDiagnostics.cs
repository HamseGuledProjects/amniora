namespace Amniora.Runner;

internal sealed record RunnerDiagnostics(bool Connected, string Account, string VirtualMachine,
    string GuestAgent, string Docker, string Runtime);
