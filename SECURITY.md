# Security

Amniora is a sanitised portfolio edition of a cybersecurity learning project. Active product development has been cancelled. This repository preserves the website and Runner source with a local synthetic demo. It is not a supported hosted service or a security certification.

## Authorised local use

Use the included synthetic fixtures and tests only on systems you own or have explicit permission to test. Deliberately vulnerable training examples belong in isolated local environments. Do not expose them to the public internet or use them against other systems.

The website demo and offline tests do not require production accounts, credentials, installed Runner applications or access to historical Amniora infrastructure. The website launcher binds to loopback and rejects real environment files. Its synthetic workspace is for local review, not a multi-user service. Native source has compile-only instructions; installation, account pairing and VM provisioning are outside this edition's setup.

## Reporting a concern

Do not put credentials, personal data, private recordings or working exploit details in a public issue. If private vulnerability reporting is enabled on this repository, use its **Security → Report a vulnerability** option. Otherwise, open a minimal issue asking for a private reporting channel, without sensitive details.

Include the affected file, the expected boundary and a small synthetic reproduction once a private channel is available. Do not probe historical websites, services or accounts to investigate this portfolio.

There is no promised response time or supported release series. See [the testing and limitations document](docs/testing-and-limitations.md) for the scope of the evidence and remaining constraints.
