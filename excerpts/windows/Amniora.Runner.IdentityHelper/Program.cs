using System.Text.Json;
using Amniora.Runner;

namespace Amniora.Runner.IdentityHelper;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length is < 1 or > 2 || args[0] is not ("identity" or "sign"))
                throw new InvalidOperationException("IDENTITY_HELPER_USAGE_INVALID");
            using var identity = new InstallationIdentityStore().LoadOrCreate();
            string? signature = null;
            if (args[0] == "sign")
            {
                if (args.Length != 2 || args[1].Length is < 1 or > 32_768)
                    throw new InvalidOperationException("IDENTITY_HELPER_PAYLOAD_INVALID");
                signature = identity.Sign(Base64UrlDecode(args[1]));
            }
            else if (args.Length != 1) throw new InvalidOperationException("IDENTITY_HELPER_USAGE_INVALID");

            Console.WriteLine(JsonSerializer.Serialize(new
            {
                installationId = identity.InstallationId,
                publicKey = identity.PublicKeyPem,
                signature,
            }));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message is "IDENTITY_HELPER_USAGE_INVALID" or "IDENTITY_HELPER_PAYLOAD_INVALID"
                ? error.Message : "IDENTITY_HELPER_FAILED");
            return 1;
        }
    }

    private static byte[] Base64UrlDecode(string value)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9_-]+$"))
            throw new InvalidOperationException("IDENTITY_HELPER_PAYLOAD_INVALID");
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        try { return Convert.FromBase64String(padded); }
        catch (FormatException) { throw new InvalidOperationException("IDENTITY_HELPER_PAYLOAD_INVALID"); }
    }
}
