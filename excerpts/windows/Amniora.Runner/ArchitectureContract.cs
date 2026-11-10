using System.Runtime.InteropServices;

namespace Amniora.Runner;

internal static class ArchitectureContract
{
    internal static string WindowsHost(Architecture architecture) => architecture switch {
        Architecture.X64 => "windows/amd64", Architecture.Arm64 => "windows/arm64",
        _ => throw new PlatformNotSupportedException("RUNNER_ARCHITECTURE_UNSUPPORTED"),
    };
    internal static bool SupportedGuest(string value) => value is "linux/amd64" or "linux/arm64";
}
