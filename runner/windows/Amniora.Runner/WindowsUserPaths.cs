namespace Amniora.Runner;

internal static class WindowsUserPaths
{
    private const string StateRootConfiguration = "product-state-root.v1";

    internal static string ProductStateRoot(string? userProfile = null, string? applicationDirectory = null)
    {
        var directory = new DirectoryInfo(applicationDirectory ?? AppContext.BaseDirectory);
        for (var depth = 0; depth < 4 && directory is not null; depth++, directory = directory.Parent)
        {
            var configuration = Path.Combine(directory.FullName, StateRootConfiguration);
            if (!File.Exists(configuration)) continue;
            var configured = File.ReadAllText(configuration).Trim();
            if (string.IsNullOrWhiteSpace(configured) || !Path.IsPathFullyQualified(configured))
                throw new RunnerProtocolException("RUNNER_CONFIGURATION_INVALID");
            return Path.GetFullPath(configured);
        }

        var profile = userProfile ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(profile) || !Path.IsPathFullyQualified(profile))
            throw new RunnerProtocolException("RUNNER_CONFIGURATION_INVALID");
        return Path.GetFullPath(Path.Combine(profile, ".amniora", "runner"));
    }
}
