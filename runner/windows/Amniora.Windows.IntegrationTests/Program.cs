using Amniora.Runner;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

internal static class Program
{
    private static int _checks;
    private static void Check(bool value, string name) { _checks++; if (!value) throw new InvalidOperationException(name); }
    private static JsonObject Data(JsonObject envelope) => envelope["data"] as JsonObject ?? throw new InvalidOperationException("missing_data");
    private static async Task<JsonObject> Json(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonObject>() ?? throw new InvalidOperationException("invalid_json");

    private static async Task Main(string[] args)
    {
        var origin = new Uri("http://127.0.0.1:43119/");
        var installed = args.Contains("--installed", StringComparer.Ordinal);
        var leavePaired = args.Contains("--leave-paired", StringComparer.Ordinal);
        var root = installed ? null : Path.Combine(Path.GetTempPath(), "amniora-w1-integration-" + Guid.NewGuid().ToString("N"));
        if (root is not null) Directory.CreateDirectory(root);
        try
        {
            using var identity = new InstallationIdentityStore(root).LoadOrCreate();
            var state = new ProtectedProductStateStore(root);
            using var protocol = new RunnerProductProtocol(origin, identity, state);
            var cookies = new CookieContainer();
            using var site = new HttpClient(new HttpClientHandler { CookieContainer = cookies }) { BaseAddress = origin };
            using var login = await site.PostAsync("/login", null); Check(login.StatusCode == HttpStatusCode.NoContent, "disposable test login");

            if (args.Contains("--unpair-only", StringComparer.Ordinal))
            {
                Check(protocol.Diagnostics().Connected, "installed Runner starts paired");
                await protocol.UnpairAsync();
                Check(!protocol.Diagnostics().Connected, "installed Runner connection removed after server revocation");
                var unpairedSnapshot = Data(await Json(await site.GetAsync("/api/site/snapshot")));
                Check(!unpairedSnapshot["paired"]!.GetValue<bool>(), "website observes installed Runner revocation");
                Console.WriteLine($"Windows W1.1 installed unpair contract: PASS ({_checks} checks)");
                return;
            }

            var approval = await protocol.BeginPairingAsync(openSystemBrowser: false);
            var requestId = approval.AbsolutePath.Split('/').Last(); var pairingState = System.Web.HttpUtility.ParseQueryString(approval.Query)["state"]!;
            using var approved = await site.PostAsJsonAsync("/api/site/approve", new { requestId, state = pairingState });
            var activationUri = Data(await Json(approved))["activationUri"]!.GetValue<string>();
            Check(RunnerUri.TryParse(activationUri, out var callback) && callback!.Kind == RunnerUriKind.PairCallback, "server pairing callback");
            await protocol.CompletePairingAsync(callback!);
            Check(protocol.Diagnostics().Connected, "account and installation bound");

            if (args.Contains("--expired-only", StringComparer.Ordinal))
            {
                using var expiringIssue = await site.PostAsJsonAsync("/api/site/command", new { operation = "STATUS", clientEntitlement = "owner" });
                var uri = Data(await Json(expiringIssue))["activationUri"]!.GetValue<string>();
                Check(RunnerUri.TryParse(uri, out var expiredActivation), "expired ticket URI issued");
                await Task.Delay(TimeSpan.FromSeconds(46));
                try { await protocol.RedeemAndSubmitAsync(expiredActivation!); throw new InvalidOperationException("expired ticket accepted"); }
                catch (RunnerProtocolException error) { Check(error.SafeCode == "TICKET_EXPIRED", "live expired ticket denied"); }
                await protocol.UnpairAsync();
                Console.WriteLine($"Windows W1.1 local expired-ticket contract: PASS ({_checks} checks)");
                return;
            }

            await protocol.SendPresenceAsync();
            var snapshot = Data(await Json(await site.GetAsync("/api/site/snapshot")));
            Check(snapshot["paired"]!.GetValue<bool>(), "website observes pairing");
            Check(snapshot["runner"]?["presenceExpiresAt"] is not null, "website observes signed presence");

            using var issued = await site.PostAsJsonAsync("/api/site/command", new { operation = "STATUS", clientEntitlement = "owner" });
            var command = Data(await Json(issued)); var commandUri = command["activationUri"]!.GetValue<string>();
            Check(RunnerUri.TryParse(commandUri, out var activation) && activation!.Kind == RunnerUriKind.Activate, "opaque command URI");
            await protocol.RedeemAndSubmitAsync(activation!);
            snapshot = Data(await Json(await site.GetAsync("/api/site/snapshot")));
            Check(snapshot["lastCompletedCommand"]?["operation"]?.GetValue<string>() == "STATUS", "signed result visible to website");
            Check(snapshot["failure"]?.GetValue<string>() == "VM_NOT_CONFIGURED", "truthful W1 no-VM result");
            try { await protocol.RedeemAndSubmitAsync(activation!); throw new InvalidOperationException("replay accepted"); }
            catch (RunnerProtocolException error) { Check(error.SafeCode == "TICKET_REPLAYED", "ticket replay denied"); }

            if (!leavePaired)
            {
                await protocol.UnpairAsync();
                Check(!protocol.Diagnostics().Connected, "local connection removed after server revocation");
                try { await protocol.SendPresenceAsync(); throw new InvalidOperationException("revoked presence accepted"); }
                catch (RunnerProtocolException error) { Check(error.SafeCode == "PAIRING_REVOKED", "revoked Runner denied"); }
            }
            Console.WriteLine($"Windows W1.1 local product protocol: PASS ({_checks} checks: PKCE, Ed25519 binding, presence, redemption, signed result, replay, revocation)");
        }
        finally { if (root is not null && Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
