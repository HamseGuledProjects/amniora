namespace Amniora.Viewer;

internal static class ViewerPolicy
{
    private static readonly System.Text.RegularExpressions.Regex AuthorityPattern =
        new("^[a-f0-9]{32}-g[1-9][0-9]{0,9}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    internal static bool ValidAuthority(string value) => AuthorityPattern.IsMatch(value);
    internal static bool IsAllowed(Uri uri, string authority) => uri.Scheme == "https" &&
        string.Equals(uri.Host, $"{authority}.lab.amniora.invalid", StringComparison.Ordinal) && uri.IsDefaultPort &&
        string.IsNullOrEmpty(uri.UserInfo);

    internal static bool IsDeniedDestination(Uri uri, string authority) => !IsAllowed(uri, authority);
}
