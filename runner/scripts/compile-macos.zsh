#!/bin/zsh
# Compilation only: no signing, application registration, installation or launch.
set -euo pipefail
script_directory=${0:A:h}
repository_root=${script_directory:h}
mkdir -p "$repository_root/.tmp"
build_root=$(mktemp -d "$repository_root/.tmp/macos-compile.XXXXXX")
xcrun swiftc "$repository_root/prototypes/local-first-runner/macos/AmnioraKeychainSigner.swift" \
  -o "$build_root/amniora-keychain-signer" -framework CryptoKit -framework Security
xcrun swiftc "$repository_root/prototypes/local-first-runner/macos/AmnioraLabViewer.swift" \
  -o "$build_root/AmnioraLabViewer" -framework AppKit -framework WebKit
xcrun swiftc "$repository_root/prototypes/local-first-runner/macos/AmnioraRunnerPhase5.swift" \
  -parse-as-library -o "$build_root/AmnioraRunner" -framework AppKit
printf '%s\n' "Compiled unsigned executables into $build_root. Nothing was installed or launched."
