using Amniora.Runner;
using Amniora.Viewer;
using System.Runtime.InteropServices;

var checks = 0;
void Check(bool value, string name) { checks++; if (!value) throw new InvalidOperationException(name); }
var token = new string('a', 43); // Synthetic parser input, never an issued activation ticket.
var activation = $"com.amniora.runner:/activate?ticket={token}";
Check(ActivationUri.TryParse(activation, out _), "valid activation");
foreach (var bad in new[] { "https://example.test/activate", activation + "#fragment", activation + "&shell=1",
    $"com.amniora.runner://example.test/activate?ticket={token}", "com.amniora.runner:/activate?ticket=short",
    activation + "&ticket=" + token })
  Check(!ActivationUri.TryParse(bad, out _), "reject malformed activation");
var gate = new ActivationGate();
Check(gate.Evaluate(activation, out _) == ActivationDecision.Accept, "accept first activation");
Check(gate.Evaluate(activation, out _) == ActivationDecision.Duplicate, "coalesce duplicate activation");
Check(gate.EvaluateRunnerUri("com.amniora.runner:/connect", out var first) == ActivationDecision.Accept, "begin connection");
Check(gate.EvaluateRunnerUri("com.amniora.runner:/connect", out _) == ActivationDecision.Duplicate, "coalesce in-flight connection");
gate.CompleteRunnerUri(first!);
Check(gate.EvaluateRunnerUri("com.amniora.runner:/connect", out var second) == ActivationDecision.Accept, "connection may retry");
gate.CompleteRunnerUri(first!);
Check(gate.EvaluateRunnerUri("com.amniora.runner:/connect", out _) == ActivationDecision.Duplicate, "stale completion cannot unlock a newer attempt");
gate.CompleteRunnerUri(second!);
Check(ArchitectureContract.WindowsHost(Architecture.X64) == "windows/amd64", "x64 mapping");
Check(ArchitectureContract.SupportedGuest("linux/amd64"), "AMD64 guest mapping");
Check(!ArchitectureContract.SupportedGuest("windows/amd64"), "guest must be Linux");
var authority = new string('b', 32) + "-g2";
Check(ViewerPolicy.ValidAuthority(authority), "generation authority");
Check(ViewerPolicy.IsAllowed(new Uri($"https://{authority}.lab.amniora.invalid/"), authority), "allow current synthetic viewer origin");
foreach (var denied in new[] { "https://example.test/", "http://127.0.0.1/", $"https://{new string('b', 32)}-g1.lab.amniora.invalid/",
    $"https://{authority}.lab.amniora.invalid:8080/", $"https://user@{authority}.lab.amniora.invalid/" })
  Check(ViewerPolicy.IsDeniedDestination(new Uri(denied), authority), "deny non-current or external origin");
var coordinator = new DiagnosticsCoordinator();
var pending = new TaskCompletionSource<RunnerDiagnostics>();
var loads = 0;
var messages = new List<string>();
var refresh = coordinator.RefreshAsync(() => { loads++; return pending.Task; }, (_, _) => { }, messages.Add);
await coordinator.RefreshAsync(() => { loads++; return pending.Task; }, (_, _) => { }, messages.Add);
Check(loads == 1, "diagnostics must not overlap");
pending.SetResult(new(false, "Not connected", "Unknown", "Unknown", "Unknown", "Stopped"));
await refresh;
Console.WriteLine($"Windows policy contracts: PASS ({checks} checks; no installed Runner, registry or identity-store access)");
