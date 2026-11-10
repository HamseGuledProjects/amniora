namespace Amniora.Runner;

internal static class RunnerOriginConfiguration
{
    internal const string FileName = "product-origin.v1";

    internal static Uri Resolve(string[] args, string? applicationDirectory = null)
    {
        var configuration = Path.Combine(applicationDirectory ?? AppContext.BaseDirectory, FileName);
        string value;
        if (File.Exists(configuration))
        {
            // The installer owns the origin. A browser can retain an old protocol command
            // after an upgrade, so its --origin argument must not override this binding.
            value = File.ReadAllText(configuration).Trim();
        }
        else
        {
            var index = Array.IndexOf(args, "--origin");
            if (index >= 0 && index + 1 >= args.Length)
                throw new RunnerProtocolException("RUNNER_CONFIGURATION_INVALID");
            value = index >= 0 ? args[index + 1] : RunnerProductProtocol.ProductionOrigin;
        }
        if (!Uri.TryCreate(value, UriKind.Absolute, out var origin) || !RunnerProductProtocol.IsAllowedOrigin(origin))
            throw new RunnerProtocolException("RUNNER_CONFIGURATION_INVALID");
        return origin;
    }
}
