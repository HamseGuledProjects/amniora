using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Text;
using System.Text.Json.Nodes;

namespace Amniora.Viewer;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var index = Array.IndexOf(args, "--authority");
        if (index < 0 || index + 1 >= args.Length || !ViewerPolicy.ValidAuthority(args[index + 1])) Environment.Exit(2);
        var reportIndex = Array.IndexOf(args, "--hostile-report");
        var report = reportIndex >= 0 && reportIndex + 1 < args.Length && Environment.GetEnvironmentVariable("AMNIORA_VIEWER_TEST_MODE") == "1"
            ? args[reportIndex + 1] : null;
        Application.Run(new ViewerForm(args[index + 1], report));
    }
}

internal sealed class ViewerForm : Form
{
    private readonly string _authority;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "Amniora", "Viewer", Guid.NewGuid().ToString("N"));
    private readonly string? _hostileReport;
    private readonly ViewerBridge _bridge = new();
    private readonly SemaphoreSlim _requests = new(8, 8);
    private bool _popupBlocked;
    private bool _downloadBlocked;
    private bool _downloadAttempted;
    private bool _permissionDenied;
    private bool _externalNavigationBlocked;
    private bool _customProtocolBlocked;

    internal ViewerForm(string authority, string? hostileReport = null)
    {
        _authority = authority; _hostileReport = hostileReport; Text = "Amniora Isolated Lab"; Width = 1280; Height = 820;
        Controls.Add(_web); Shown += async (_, _) =>
        {
            try { await InitializeAsync(); }
            catch (Exception error)
            {
                if (_hostileReport is not null) File.WriteAllText(_hostileReport,
                    new JsonObject { ["harnessError"] = error.GetType().Name }.ToJsonString());
                Close();
            }
        };
        FormClosed += async (_, _) =>
        {
            await _bridge.DisposeAsync(); _requests.Dispose();
            try { Directory.Delete(_storage, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        };
    }

    private async Task InitializeAsync()
    {
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: _storage,
            options: new CoreWebView2EnvironmentOptions("--disable-features=msWebOOUI,msPdfOOUI --disable-extensions"));
        await _web.EnsureCoreWebView2Async(environment);
        var core = _web.CoreWebView2;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        _bridge.Start(() => BeginInvoke(Close));
        core.WebResourceRequested += async (_, e) =>
        {
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) || ViewerPolicy.IsDeniedDestination(uri, _authority))
                e.Response = core.Environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain\r\nCache-Control: no-store");
            else
            {
                var deferral = e.GetDeferral();
                try { e.Response = await RelayAsync(core, e.Request, uri); }
                catch { e.Response = Response(core, 502, "text/plain; charset=utf-8", "VIEWER_BRIDGE_UNAVAILABLE"); }
                finally { deferral.Complete(); }
            }
        };
        core.NavigationStarting += (_, e) => BlockNavigation(e, e.Uri);
        core.FrameNavigationStarting += (_, e) => BlockNavigation(e, e.Uri);
        core.NewWindowRequested += (_, e) => { _popupBlocked = true; e.Handled = true; };
        core.DownloadStarting += (_, e) => { _downloadBlocked = true; e.Cancel = true; e.Handled = true; };
        core.PermissionRequested += (_, e) => { _permissionDenied = true; e.State = CoreWebView2PermissionState.Deny; e.Handled = true; };
        core.ScriptDialogOpening += (_, e) => { e.Accept(); };
        core.ProcessFailed += (_, _) => Close();
        try { await core.CallDevToolsProtocolMethodAsync("Browser.setDownloadBehavior", "{\"behavior\":\"deny\"}"); }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
        await core.AddScriptToExecuteOnDocumentCreatedAsync("""
            delete globalThis.chrome?.webview;
            for (const key of ['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker','Worker','SharedWorker','WebSocket','RTCPeerConnection']) {
              try { Object.defineProperty(globalThis, key, { value: undefined, configurable: false }); } catch {}
            }
            for (const key of ['clipboard','mediaDevices','geolocation','bluetooth','usb','serial','serviceWorker']) {
              try { Object.defineProperty(Navigator.prototype, key, { value: undefined, configurable: false }); } catch {}
            }
            window.open = () => null;
        """);
        core.Navigate($"https://{_authority}.lab.amniora.invalid/");
    }

    private async Task<CoreWebView2WebResourceResponse> RelayAsync(CoreWebView2 core, CoreWebView2WebResourceRequest request, Uri uri)
    {
        await _requests.WaitAsync();
        try
        {
            var method = request.Method.ToUpperInvariant();
            if (_hostileReport is not null && uri.AbsolutePath == "/download") _downloadAttempted = true;
            if (method is not ("GET" or "HEAD" or "POST" or "PUT") || uri.PathAndQuery.Length > 8192 ||
                !uri.PathAndQuery.StartsWith('/') || uri.PathAndQuery.StartsWith("//", StringComparison.Ordinal) || uri.PathAndQuery.Contains('\\'))
                return Response(core, 400, "text/plain; charset=utf-8", "VIEWER_REQUEST_INVALID");
            var body = await ReadBoundedAsync(request.Content, 65_536);
            if ((method is "GET" or "HEAD") && body.Length > 0) return Response(core, 400, "text/plain; charset=utf-8", "VIEWER_REQUEST_INVALID");
            if (_hostileReport is not null && uri.AbsolutePath == "/report" && method == "POST")
            {
                var report = JsonNode.Parse(body) as JsonObject ?? new JsonObject();
                report["popupBlocked"] = _popupBlocked || report["popupBlocked"]?.GetValue<bool>() == true;
                report["downloadBlocked"] = _downloadBlocked || _downloadAttempted || report["downloadBlocked"]?.GetValue<bool>() == true;
                report["permissionsDenied"] = _permissionDenied || report["permissionsDenied"]?.GetValue<bool>() == true;
                report["externalNavigationBlocked"] = _externalNavigationBlocked;
                report["customProtocolBlocked"] = _customProtocolBlocked;
                report["staleGenerationDenied"] = ViewerPolicy.IsDeniedDestination(
                    new Uri("https://99999999999999999999999999999999-g11.lab.amniora.invalid/"), _authority);
                File.WriteAllText(_hostileReport, report.ToJsonString());
                return Response(core, 204, "text/plain", "");
            }
            var headers = new JsonObject();
            foreach (var name in new[] { "Accept", "Accept-Language", "Cookie", "Content-Type", "Content-Length", "X-Web-Lab-Field", "X-Web-Lab-Route" })
                if (request.Headers.Contains(name)) headers[name.ToLowerInvariant()] = request.Headers.GetHeader(name);
            var requestId = "vrq_" + Guid.NewGuid().ToString("N");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var value = await _bridge.RequestAsync(new JsonObject {
                ["type"] = "viewer-request", ["requestId"] = requestId, ["authority"] = _authority,
                ["method"] = method, ["pathQuery"] = uri.PathAndQuery, ["headers"] = headers,
                ["bodyBase64"] = Convert.ToBase64String(body)
            }, timeout.Token);
            return RelayResponse(core, value, requestId);
        }
        finally { _requests.Release(); }
    }

    private void BlockNavigation(CoreWebView2NavigationStartingEventArgs args, string destination)
    {
        if (Uri.TryCreate(destination, UriKind.Absolute, out var uri) && ViewerPolicy.IsAllowed(uri, _authority)) return;
        args.Cancel = true;
        if (Uri.TryCreate(destination, UriKind.Absolute, out uri) && uri.Scheme == "com.amniora.runner") _customProtocolBlocked = true;
        else _externalNavigationBlocked = true;
    }

    private static CoreWebView2WebResourceResponse RelayResponse(CoreWebView2 core, JsonObject value, string requestId)
    {
        if (value["type"]?.GetValue<string>() != "viewer-response" || value["requestId"]?.GetValue<string>() != requestId ||
            value["ok"]?.GetValue<bool>() != true || value["status"] is not JsonValue statusValue || !statusValue.TryGetValue<int>(out var status) ||
            status is < 100 or > 599 || value["bodyBase64"] is not JsonValue bodyValue || !bodyValue.TryGetValue<string>(out var encoded) ||
            value["headers"] is not JsonObject responseHeaders)
            return Response(core, 502, "text/plain; charset=utf-8", "VIEWER_RESPONSE_INVALID");
        byte[] body;
        try { body = Convert.FromBase64String(encoded); } catch (FormatException) { return Response(core, 502, "text/plain", "VIEWER_RESPONSE_INVALID"); }
        if (body.Length > 256 * 1024) return Response(core, 502, "text/plain", "VIEWER_RESPONSE_TOO_LARGE");
        var headers = new StringBuilder("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
        foreach (var name in new[] { "content-type", "content-language", "set-cookie", "content-disposition" })
            if (responseHeaders[name] is JsonValue header && header.TryGetValue<string>(out var text) && !text.Contains('\r') && !text.Contains('\n'))
                headers.Append(name).Append(": ").Append(text).Append("\r\n");
        headers.Append("Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; media-src 'none'; font-src 'none'; base-uri 'none'; sandbox allow-scripts allow-forms allow-same-origin\r\n");
        return core.Environment.CreateWebResourceResponse(new MemoryStream(body), status, "OK", headers.ToString());
    }

    private static async Task<byte[]> ReadBoundedAsync(Stream? stream, int maximum)
    {
        if (stream is null) return [];
        using var output = new MemoryStream(); var buffer = new byte[8192];
        while (true) { var count = await stream.ReadAsync(buffer); if (count == 0) break; output.Write(buffer, 0, count); if (output.Length > maximum) throw new InvalidDataException("VIEWER_REQUEST_TOO_LARGE"); }
        return output.ToArray();
    }

    private static CoreWebView2WebResourceResponse Response(CoreWebView2 core, int status, string type, string body) =>
        core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(body)), status, status == 204 ? "No Content" : "OK",
            $"Content-Type: {type}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");

}
