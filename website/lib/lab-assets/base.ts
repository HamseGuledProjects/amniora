import type { AssetPackInput, LabAsset } from "./types";

export function buildReadme({
  title,
  category,
  difficulty,
  duration,
}: AssetPackInput) {
  const setupLabel = difficulty === "Beginner"
    ? "Recommended beginner setup"
    : `Recommended ${difficulty.toLowerCase()} investigation setup`;
  return `# ${title === "CyberLab Asset Pack" ? "Amniora Asset Pack" : title}

## Amniora Asset Pack

Category: ${category}
Difficulty: ${difficulty}
Estimated Duration: ${duration}

## Recommended Environment

Use an isolated local virtual machine that you own and control.

${setupLabel}:
- Ubuntu 24.04 LTS VM
- VirtualBox or VMware
- No production systems
- No public targets
- No real organisations

## How to Use

1. Extract this asset pack.
2. Open the lab inside Amniora.
3. Read the objective and scenario.
4. Use the files in the assets/ folder to complete the tasks.
5. Only run commands inside your own local VM or authorised lab.
6. Use Amniora AI Task Guidance if you need Explain, Hint, Command or Quiz support.

## Important

Amniora does not provide, host or manage your virtual machine.
You are responsible for your own local lab environment.
Do not use these assets on production systems or networks you do not own.
`;
}

export function buildDisclaimer() {
  return `Amniora Asset Pack Disclaimer

This asset pack is provided only for educational cybersecurity training.

Amniora does not provide, host, configure, or manage virtual machines.

You are responsible for:
- Installing your own VM platform
- Installing your own operating system
- Keeping your lab isolated
- Running assets only in environments you own or are authorised to use

Do not use these assets, commands, tasks, or generated material against real systems, public targets, production networks, or third-party services without explicit permission.

Amniora is not responsible for misuse of generated labs or assets outside authorised learning environments.
`;
}

export function buildSetupScript() {
  return `#!/usr/bin/env bash
set -e

mkdir -p "$HOME/CyberLab/assets"

if [ -d "assets" ]; then
  cp -r assets/* "$HOME/CyberLab/assets/"
fi

echo "Amniora assets copied to: $HOME/CyberLab/assets"
echo "Open Amniora and follow the saved lab tasks."
`;
}

export function buildManifest({
  title,
  category,
  difficulty,
  duration,
  generatedAt,
}: AssetPackInput) {
  return JSON.stringify(
    {
      cyberlab_version: "1.0",
      title,
      category,
      difficulty,
      duration,
      generated_at: generatedAt || new Date().toISOString(),
      environment: "user-managed local VM or lab folder",
    },
    null,
    2
  );
}

export function buildBaseAssets(input: AssetPackInput): LabAsset[] {
  return [
    {
      file_name: "README.md",
      file_type: "markdown",
      file_path: "README.md",
      content: buildReadme(input),
    },
    {
      file_name: "DISCLAIMER.txt",
      file_type: "text",
      file_path: "DISCLAIMER.txt",
      content: buildDisclaimer(),
    },
    {
      file_name: "setup.sh",
      file_type: "shell",
      file_path: "setup.sh",
      content: buildSetupScript(),
    },
    {
      file_name: "manifest.json",
      file_type: "json",
      file_path: "manifest.json",
      content: buildManifest(input),
    },
  ];
}
