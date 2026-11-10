using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Amniora.Viewer.HostileTests;

internal static class Program
{
    private static async Task Main()
    {
        const string authority = "88888888888888888888888888888888-g11";
        var report = Path.Combine(Path.GetTempPath(), "amniora-viewer-report-" + Guid.NewGuid().ToString("N") + ".json");
        var viewer = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "Amniora.Viewer", "bin", "Release",
            "net8.0-windows10.0.19041.0", "win-x64", "Amniora.Viewer.exe"));
        var start = new ProcessStartInfo(viewer) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true };
        start.ArgumentList.Add("--authority"); start.ArgumentList.Add(authority);
        start.ArgumentList.Add("--hostile-report"); start.ArgumentList.Add(report);
        start.Environment["AMNIORA_VIEWER_TEST_MODE"] = "1";
        using var process = Process.Start(start) ?? throw new InvalidOperationException("viewer_start_failed");
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var relay = RelayAsync(process, timeout.Token);
            var invalidation = InvalidateWhenReportedAsync(process, report, timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            await relay;
            var invalidated = await invalidation;
            if (process.ExitCode != 0 || !File.Exists(report)) throw new InvalidOperationException("viewer_harness_failed");
            var value = JsonNode.Parse(await File.ReadAllTextAsync(report, timeout.Token)) as JsonObject ?? throw new InvalidOperationException("viewer_report_invalid");
            value["stoppedGenerationDenied"] = invalidated && process.ExitCode == 0;
            if (value["harnessError"] is not null) throw new InvalidOperationException(value["harnessError"]!.ToString());
            var failed = value.Where(item => item.Value?.GetValue<bool>() != true).Select(item => item.Key).ToArray();
            if (failed.Length > 0) throw new InvalidOperationException("viewer_hostile_failed:" + string.Join(',', failed));
            await MalformedRelayClosesAsync(viewer, authority, timeout.Token);
            Console.WriteLine($"Windows W1.1 hostile WebView2: PASS ({value.Count} live engine probes plus malformed-relay fail-closed)");
        }
        finally
        {
            if (!process.HasExited) process.Kill(true);
            if (File.Exists(report)) File.Delete(report);
        }
    }

    private static async Task MalformedRelayClosesAsync(string viewer, string authority, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(viewer) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true };
        start.ArgumentList.Add("--authority"); start.ArgumentList.Add(authority);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("viewer_malformed_start_failed");
        try
        {
            if (await process.StandardOutput.ReadLineAsync(cancellationToken) is null) throw new InvalidOperationException("viewer_malformed_no_request");
            await process.StandardInput.WriteLineAsync("{}".AsMemory(), cancellationToken);
            await process.StandardInput.FlushAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0) throw new InvalidOperationException("viewer_malformed_not_fail_closed");
        }
        finally { if (!process.HasExited) process.Kill(true); }
    }

    private static async Task<bool> InvalidateWhenReportedAsync(Process process, string report, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 200 && !cancellationToken.IsCancellationRequested; attempt++)
        {
            if (File.Exists(report))
            {
                await process.StandardInput.WriteLineAsync("{\"type\":\"viewer-control\",\"action\":\"invalidate\",\"reason\":\"runtime-stopped\"}".AsMemory(), cancellationToken);
                await process.StandardInput.FlushAsync(cancellationToken);
                return true;
            }
            await Task.Delay(50, cancellationToken);
        }
        return false;
    }

    private static async Task RelayAsync(Process process, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await process.StandardOutput.ReadLineAsync(cancellationToken);
            if (line is null) return;
            var frame = JsonNode.Parse(line) as JsonObject ?? throw new InvalidOperationException("viewer_request_invalid");
            if (frame["type"]?.GetValue<string>() != "viewer-request") throw new InvalidOperationException("viewer_request_type");
            var requestId = frame["requestId"]!.GetValue<string>();
            var path = frame["pathQuery"]!.GetValue<string>();
            var body = path switch { "/" => HostileDocument, "/same-lab" => "same-lab-ok", "/download" => "blocked-download", _ => "not-found" };
            var type = path switch { "/" => "text/html; charset=utf-8", "/download" => "application/octet-stream", _ => "text/plain; charset=utf-8" };
            var response = new JsonObject {
                ["type"] = "viewer-response", ["requestId"] = requestId, ["ok"] = true,
                ["status"] = path is "/" or "/same-lab" or "/download" ? 200 : 404,
                ["headers"] = new JsonObject { ["content-type"] = type,
                    ["content-disposition"] = path == "/download" ? "attachment; filename=blocked.bin" : null },
                ["bodyBase64"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(body)), ["errorCode"] = null, ["terminal"] = false
            };
            await process.StandardInput.WriteLineAsync(response.ToJsonString().AsMemory(), cancellationToken);
            await process.StandardInput.FlushAsync(cancellationToken);
        }
    }

    private const string HostileDocument = """
<!doctype html><meta charset="utf-8"><title>Amniora hostile viewer matrix</title><a id="download" download href="/download">download</a><main id="result">running</main><script>
(async()=>{globalThis.__xss='executed';const timeout=ms=>new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms));
const denied=async u=>{try{const r=await Promise.race([fetch(u),timeout(800)]);return r.status===403||!r.ok}catch{return true}};
const frameDenied=u=>new Promise(resolve=>{const f=document.createElement('iframe');const t=setTimeout(()=>{f.remove();resolve(true)},800);f.onerror=()=>{clearTimeout(t);f.remove();resolve(true)};f.onload=()=>{clearTimeout(t);let escaped=false;try{escaped=/^(https?|file|com\.amniora)/.test(f.contentWindow.location.href)&&!f.contentWindow.location.href.includes(location.host)}catch{escaped=true}f.remove();resolve(!escaped)};f.src=u;document.body.append(f)});
const destinations=['http://localhost:9/','http://127.0.0.1:9/','http://[::1]:9/','http://192.168.1.1/','http://10.0.0.1/','http://169.254.169.254/latest/meta-data/','https://example.com/','https://escape.invalid/'];
const blocked=await Promise.all(destinations.map(denied));document.querySelector('#download').click();await new Promise(resolve=>setTimeout(resolve,200));
const results={xssExecutes:globalThis.__xss==='executed',sameLabWorks:await fetch('/same-lab').then(r=>r.text())==='same-lab-ok',localhostBlocked:blocked[0],ipv4LoopbackBlocked:blocked[1],ipv6LoopbackBlocked:blocked[2],privateLanBlocked:blocked[3]&&blocked[4],metadataBlocked:blocked[5],internetBlocked:blocked[6],dnsEscapeBlocked:blocked[7],externalNavigationBlocked:await frameDenied('https://example.com/'),popupBlocked:window.open('https://example.com/')===null,downloadBlocked:location.pathname==='/',customProtocolBlocked:await frameDenied('com.amniora.runner:/connect'),nativeBridgeAbsent:!(globalThis.chrome&&globalThis.chrome.webview)&&!globalThis.__TAURI__&&!globalThis.process&&!globalThis.require,filesystemUnavailable:typeof showOpenFilePicker==='undefined'&&typeof showSaveFilePicker==='undefined',amnioraSessionUnavailable:!document.cookie.includes('amniora')&&!localStorage.getItem('supabase.auth.token'),serviceWorkerContained:!navigator.serviceWorker,permissionsDenied:!navigator.mediaDevices&&!navigator.geolocation&&!navigator.clipboard};
document.querySelector('#result').textContent=JSON.stringify(results);await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(results)});
})().catch(async e=>{await fetch('/report',{method:'POST',body:JSON.stringify({harnessError:String(e&&e.message||e)})}).catch(()=>{})});
</script>
""";
}
