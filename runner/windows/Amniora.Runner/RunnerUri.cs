namespace Amniora.Runner;

internal enum RunnerUriKind { Connect, PairCallback, Activate }
internal sealed record RunnerUriValue(RunnerUriKind Kind, string Raw, string? Ticket = null,
    string? RequestId = null, string? Code = null, string? State = null);

internal static class RunnerUri
{
    private static readonly System.Text.RegularExpressions.Regex Opaque =
        new("^[A-Za-z0-9_-]{43}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    private static readonly System.Text.RegularExpressions.Regex Pair =
        new("^par_[A-Za-z0-9_-]{43}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    internal static bool TryParse(string? value, out RunnerUriValue? parsed)
    {
        parsed = null;
        if (string.IsNullOrWhiteSpace(value) || System.Text.Encoding.UTF8.GetByteCount(value) > ActivationUri.MaxBytes ||
            !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Scheme, ActivationUri.Scheme, StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) return false;
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        var keys = query.AllKeys.Order(StringComparer.Ordinal).ToArray();
        if (uri.AbsolutePath == "/connect" && keys.Length == 0)
        {
            parsed = new RunnerUriValue(RunnerUriKind.Connect, value); return true;
        }
        if (uri.AbsolutePath == "/activate" && keys is ["ticket"] && Opaque.IsMatch(query["ticket"] ?? ""))
        {
            parsed = new RunnerUriValue(RunnerUriKind.Activate, value, Ticket: query["ticket"]); return true;
        }
        if (uri.AbsolutePath == "/pair" && keys is ["code", "request", "state"] &&
            Pair.IsMatch(query["request"] ?? "") && Opaque.IsMatch(query["code"] ?? "") && Opaque.IsMatch(query["state"] ?? ""))
        {
            parsed = new RunnerUriValue(RunnerUriKind.PairCallback, value, RequestId: query["request"],
                Code: query["code"], State: query["state"]); return true;
        }
        return false;
    }
}
