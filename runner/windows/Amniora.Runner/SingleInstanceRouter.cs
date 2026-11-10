using System.IO.Pipes;
using System.Text;

namespace Amniora.Runner;

internal sealed class SingleInstanceRouter : IDisposable
{
    private const string Name = "Amniora.Runner.W1.7f5f4b6c";
    private readonly Mutex _mutex;
    private readonly CancellationTokenSource _stop = new();
    internal bool IsPrimary { get; }

    internal SingleInstanceRouter()
    {
        _mutex = new Mutex(true, $"Local\\{Name}", out var created);
        IsPrimary = created;
    }

    internal static async Task ForwardAsync(string uri)
    {
        using var pipe = new NamedPipeClientStream(".", Name, PipeDirection.Out, PipeOptions.Asynchronous,
            System.Security.Principal.TokenImpersonationLevel.Identification);
        await pipe.ConnectAsync(10_000);
        var bytes = Encoding.UTF8.GetBytes(uri);
        await pipe.WriteAsync(BitConverter.GetBytes(bytes.Length));
        await pipe.WriteAsync(bytes);
    }

    internal async Task ListenAsync(Action<string> onActivation)
    {
        while (!_stop.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(Name, PipeDirection.In, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            try
            {
                await pipe.WaitForConnectionAsync(_stop.Token);
                var lengthBytes = new byte[4];
                await pipe.ReadExactlyAsync(lengthBytes, _stop.Token);
                var length = BitConverter.ToInt32(lengthBytes);
                if (length is < 1 or > ActivationUri.MaxBytes) continue;
                var bytes = new byte[length];
                await pipe.ReadExactlyAsync(bytes, _stop.Token);
                onActivation(Encoding.UTF8.GetString(bytes));
            }
            catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
            catch (IOException) { }
        }
    }

    public void Dispose() { _stop.Cancel(); _mutex.Dispose(); _stop.Dispose(); }
}
