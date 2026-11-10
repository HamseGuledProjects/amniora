import type { LinuxAssetBuilder } from "./types";
import { canonicalPrimaryService } from "./simulation";
import { identityFor } from "./noise";
import { renderedSudoPolicyText } from "./sudoPolicy";

export const buildConfigs: LinuxAssetBuilder = ({ world, incident, investigation, simulation }) => {
  const context = {
    input: { category: "Linux", difficulty: "Advanced", duration: "60", title: investigation.incidentId },
    world,
    incident,
    investigation,
    simulation,
    intermediate: false,
    advanced: true,
  };
  const passwordAuth = incident.id === "ssh_bruteforce" ? "yes" : "no";
  const serviceShell =
    incident.id === "service_account_misuse" || incident.id === "data_staging"
      ? "/bin/bash"
      : "/usr/sbin/nologin";
  const sudoExceptionNote = renderedSudoPolicyText(context);
  const sudoReviewNote =
    sudoExceptionNote.startsWith("#")
      ? "No unusual sudo exceptions observed in this summary."
      : `Illustrative exception shown for archive or service operations; verify host-effective policy and approval against supplied sources and ${world.changeId}.`;
  const primaryService = canonicalPrimaryService(simulation).unitName;
  const primaryServiceModel = canonicalPrimaryService(simulation);
  const serviceContextLine = primaryService === investigation.affectedService
    ? `Affected service: ${investigation.affectedService}`
    : `Affected service: ${investigation.affectedService}\nService baseline context: ${primaryService}`;
  const accountLine = (username: string, label: string, fallbackShell = "/bin/bash") => {
    const account = identityFor(context, username);
    const uid = account?.uid || 1000;
    const gid = account?.gid || uid;
    const home = account?.homeDirectory || `/home/${username}`;
    const shell = username === world.serviceUser ? serviceShell : account?.shell || fallbackShell;

    return `${username}:x:${uid}:${gid}:${label}:${home}:${shell}`;
  };

  return {
    file_name: "linux_config_pack.txt",
    file_type: "config",
    file_path: "assets/configs/linux_config_pack.txt",
    content: `# Supplied SSH configuration sample: sshd_config.sample (undated; incident-time effectiveness not established)

Port 22
Protocol 2
PermitRootLogin ${incident.id === "ssh_bruteforce" ? "yes" : "no"}
PasswordAuthentication ${passwordAuth}
PubkeyAuthentication yes
MaxAuthTries 6
AllowUsers ${investigation.adminAccounts.join(" ")} ${world.internUser} ${world.serviceUser} ${world.contractorUser}

# sudoers.sample: illustrative policy summary, not a captured effective sudoers file.
# Verify any host-effective rule against an exported observed sudoers source; permission metadata alone is not policy content.

Defaults env_reset
Defaults mail_badpass
root ALL=(ALL:ALL) ALL
%sudo ALL=(ALL:ALL) ALL
${world.analystUser} ALL=(ALL) NOPASSWD: /usr/bin/systemctl status *, /usr/bin/journalctl *, /usr/bin/stat *
${
  sudoExceptionNote
}

Sudo review note: ${sudoReviewNote}

# passwd.sample

# scope: partial incident-focused local passwd snapshot embedded in config pack
root:x:0:0:root:/root:/bin/bash
${accountLine(world.analystUser, "Security Analyst")}
${accountLine(world.internUser, "Temporary Intern")}
${accountLine(world.serviceUser, "Service Account", serviceShell)}
${accountLine(world.adminUser, "Linux Administrator")}
${accountLine(world.contractorUser, "Maintenance Contractor")}
${accountLine(world.appUser, "Application Runtime", "/usr/sbin/nologin")}

# Expected policy: policy_notes.md

Root SSH login disabled.
Password authentication disabled.
Least privilege required.
Service accounts should use non-interactive shells.
UFW and audit logging should be enabled.

# incident_alignment.md

Case ${investigation.incidentId} requires review of ${investigation.modifiedConfigurations.join(", ")}.
Investigation window: ${investigation.incidentWindowStart}-${investigation.incidentWindowEnd} ${investigation.timezone}
${serviceContextLine}

# Expected service baseline: service_baseline.unit

[Unit]
Description=${primaryServiceModel.description}

[Service]
Type=${primaryServiceModel.serviceType}
ExecStart=${primaryServiceModel.execStart || primaryServiceModel.unitPath}

[Install]
WantedBy=multi-user.target

Expected service baseline:
Unit=${primaryServiceModel.unitName}
LoadState=${primaryServiceModel.loadState}
UnitFileState=${primaryServiceModel.unitFileState}
ActiveState=${primaryServiceModel.activeState}
SubState=${primaryServiceModel.subState}
UnitPath=${primaryServiceModel.unitPath}
`,
  };
};
