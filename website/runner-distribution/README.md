# Historical Linux distribution source

This directory preserves the Linux Runner service, launch/uninstall scripts, installer template and release JSON from the website snapshot. The related build and installer-rendering implementations are in `../scripts/runner-distribution`.

The release JSON is historical metadata with reserved example endpoints. Runtime archive checksums remain as original public dependency integrity pins. No published release, current download service or verified installer is claimed. Signing keys, trust material, application packages, virtual-machine media and release binaries are not included.

These sources are not part of the local website startup. They can download runtime archives, build or sign packages, install services, remove installation files or operate a Runner when separately configured. None of those actions were performed for this portfolio. The production control provisioning script is excluded.

For the later macOS and Windows application source and compile-only validation, see the repository's [Runner directory](../../runner/README.md). The two snapshots are kept separate because the later native work is not an asserted production merge into this website snapshot.
