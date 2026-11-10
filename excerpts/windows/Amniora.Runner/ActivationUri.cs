namespace Amniora.Runner;

internal sealed record Activation(string Ticket);

internal static class ActivationUri
{
    internal const string Scheme = "com.amniora.runner";
    internal const int MaxBytes = 256;
    private static readonly System.Text.RegularExpressions.Regex TicketPattern =
        new("^[A-Za-z0-9_-]{43}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    internal static bool TryParse(string? value, out Activation? activation)
    {
        activation = null;
        if (!RunnerUri.TryParse(value, out var parsed) || parsed!.Kind != RunnerUriKind.Activate ||
            parsed.Ticket is null || !TicketPattern.IsMatch(parsed.Ticket)) return false;
        activation = new Activation(parsed.Ticket); return true;
    }
}
