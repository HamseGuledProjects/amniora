# Historical regression source

This directory preserves the original website test, fixture and integration source from the website snapshot. It includes the Linux investigation engine's deterministic generation, evidence, narrative, grading, export and quality tests; web-lab contracts and browser fixtures; and interface/security regressions.

`linux-quality/linuxLegacyProseAudit.json` is an immutable historical regression fixture containing 19 renderer-audit entries. The generator's JSON schemas, prompts, templates and output builders are defined in the TypeScript source under `../lib/ai`, `../lib/lab-assets` and `../lib/web-lab`. Generated provider responses, forensic captures and raw run reports are not input requirements and are not included.

These archived tests were not executed for this portfolio. Some require a separately provisioned database, AI provider, Docker, virtual machine, browser or installed Runner; some create resources, launch processes or clean up test data. No website package script invokes these archived suites. The local demo uses synthetic adapters and requires none of those services.

Original interface assertions may describe the historical beta and can differ from the cancelled-project demo. They are retained as implementation evidence, not claimed passing checks. Private endpoints, project references, home paths and backup fingerprints were replaced with reserved examples or absent-fixture placeholders. External PDF utilities are resolved through the system path or an explicit `POPPLER_BIN` directory.

For checks actually run during portfolio preparation, see [testing and limitations](../../docs/testing-and-limitations.md). The repository-root offline suites are a separate reviewed harness. The website's new local-demo checks are documented in its [README](../README.md).
