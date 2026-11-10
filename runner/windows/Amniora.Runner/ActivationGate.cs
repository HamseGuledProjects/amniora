namespace Amniora.Runner;

internal enum ActivationDecision { Accept, Duplicate, Malformed }

internal sealed class ActivationGate
{
    private readonly HashSet<string> _seen = new(StringComparer.Ordinal);
    private readonly object _sync = new();
    private RunnerUriValue? _connecting;
    internal ActivationDecision Evaluate(string value, out Activation? activation)
    {
        if (!ActivationUri.TryParse(value, out activation)) return ActivationDecision.Malformed;
        lock (_sync) return _seen.Add(activation!.Ticket) ? ActivationDecision.Accept : ActivationDecision.Duplicate;
    }

    internal ActivationDecision EvaluateRunnerUri(string value, out RunnerUriValue? parsed)
    {
        if (!RunnerUri.TryParse(value, out parsed)) return ActivationDecision.Malformed;
        lock (_sync)
        {
            // Connect is a retryable intent, not a one-use capability. Coalesce
            // only while this attempt creates/opens its secure approval request.
            // Opaque command tickets and callbacks remain lifetime-deduplicated.
            if (parsed!.Kind == RunnerUriKind.Connect)
            {
                if (_connecting is not null) return ActivationDecision.Duplicate;
                _connecting = parsed;
                return ActivationDecision.Accept;
            }
            return _seen.Add(value) ? ActivationDecision.Accept : ActivationDecision.Duplicate;
        }
    }

    internal void CompleteRunnerUri(RunnerUriValue parsed)
    {
        lock (_sync)
        {
            // A duplicate or stale completion cannot unlock a newer attempt.
            if (ReferenceEquals(_connecting, parsed)) _connecting = null;
        }
    }
}
