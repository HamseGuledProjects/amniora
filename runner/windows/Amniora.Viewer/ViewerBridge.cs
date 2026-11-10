using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;

namespace Amniora.Viewer;

internal sealed class ViewerBridge : IAsyncDisposable
{
    internal const int MaximumFrameBytes = 384 * 1024;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> _pending = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _writer = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private Task? _reader;
    private Action? _invalidated;

    internal void Start(Action invalidated)
    {
        _invalidated = invalidated;
        _reader = Task.Run(ReadLoopAsync);
    }

    internal async Task<JsonObject> RequestAsync(JsonObject frame, CancellationToken cancellationToken)
    {
        var requestId = frame["requestId"]?.GetValue<string>() ?? throw new InvalidOperationException("VIEWER_REQUEST_INVALID");
        var completion = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(requestId, completion)) throw new InvalidOperationException("VIEWER_REQUEST_DUPLICATE");
        try
        {
            var line = frame.ToJsonString();
            if (Encoding.UTF8.GetByteCount(line) > MaximumFrameBytes) throw new InvalidOperationException("VIEWER_REQUEST_TOO_LARGE");
            await _writer.WaitAsync(cancellationToken);
            try { await Console.Out.WriteLineAsync(line); await Console.Out.FlushAsync(); }
            finally { _writer.Release(); }
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
        }
        finally { _pending.TryRemove(requestId, out _); }
    }

    private async Task ReadLoopAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(_stop.Token);
                if (line is null || Encoding.UTF8.GetByteCount(line) > MaximumFrameBytes) break;
                if (JsonNode.Parse(line) is not JsonObject value || value["type"] is not JsonValue typeValue ||
                    !typeValue.TryGetValue<string>(out var type)) break;
                if (type == "viewer-control")
                {
                    if (value.Count != 3 || value["action"]?.GetValue<string>() != "invalidate" || value["reason"] is null) break;
                    Invalidate(); return;
                }
                if (type != "viewer-response" || value["requestId"] is not JsonValue idValue ||
                    !idValue.TryGetValue<string>(out var requestId) || !_pending.TryRemove(requestId, out var completion)) break;
                completion.TrySetResult(value);
                if (value["terminal"]?.GetValue<bool>() == true) { Invalidate(); return; }
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { return; }
        catch (Exception) { }
        Invalidate();
    }

    private void Invalidate()
    {
        foreach (var pending in _pending.Values) pending.TrySetException(new IOException("VIEWER_BRIDGE_UNAVAILABLE"));
        _pending.Clear();
        _invalidated?.Invoke();
    }

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();
        if (_reader is not null) { try { await _reader; } catch (OperationCanceledException) { } }
        _writer.Dispose(); _stop.Dispose();
    }
}
