import type { LinuxIncident } from "./incidents";

export type LinuxIncidentProfile = {
  risks: string[];
  configFocus: string[];
  permissionFocus: string[];
  serviceFocus: string[];
  analystQuestions: string[];
};

export function getLinuxIncidentProfile(
  incident: LinuxIncident
): LinuxIncidentProfile {
  switch (incident.id) {
    case "ssh_bruteforce":
      return {
        risks: [
          "Successful login after repeated SSH failures",
          "Password authentication enabled",
          "Missing brute-force protection",
          "Root SSH exposure requires review",
        ],
        configFocus: [
          "PasswordAuthentication",
          "PermitRootLogin",
          "MaxAuthTries",
          "AllowUsers",
        ],
        permissionFocus: [
          "auth.log visibility",
          "btmp access",
          "authorized_keys ownership",
        ],
        serviceFocus: ["ssh.service", "fail2ban.service", "rsyslog.service"],
        analystQuestions: [
          "Was the successful login expected?",
          "Which account authenticated after repeated failures?",
          "What control should have slowed or blocked the attempts?",
        ],
      };

    case "misconfigured_sudoers":
      return {
        risks: [
          "Suspicious sudo activity from non-admin user",
          "Temporary sudoers exception still active",
          "Sensitive file access attempted with sudo",
          "Privileged service control exposed",
        ],
        configFocus: [
          "sudoers.sample",
          "sudoers.d temp maintenance rules",
          "NOPASSWD rules",
          "systemctl wildcard access",
        ],
        permissionFocus: [
          "world-writable scripts",
          "temporary maintenance files",
          "sensitive file access",
        ],
        serviceFocus: ["ssh.service", "auditd.service", "ufw.service"],
        analystQuestions: [
          "Which sudo rule allowed the risky action?",
          "Was this maintenance activity or misuse?",
          "Which rule should be removed first?",
        ],
      };

    case "service_account_misuse":
      return {
        risks: [
          "Service account interactive login",
          "Service account has interactive shell",
          "Privileged archive or sync activity",
          "Possible data staging through automation account",
        ],
        configFocus: [
          "passwd.sample shell setting",
          "sudoers service account rule",
          "backup.service ownership",
        ],
        permissionFocus: [
          "authorized_keys permissions",
          "backup scripts",
          "archive output files",
        ],
        serviceFocus: ["backup.service", "cron.service", "ssh.service"],
        analystQuestions: [
          "Should this service account be able to log in interactively?",
          "Was the activity automation or human misuse?",
          "Which credential or shell setting should be remediated?",
        ],
      };

    case "ssh_key_compromise":
      return {
        risks: [
          "Valid SSH key used from an unfamiliar source",
          "Contractor key not tied to an active change record",
          "authorized_keys ownership and provenance require review",
          "Key rotation and source restrictions may be missing",
        ],
        configFocus: [
          "AuthorizedKeysFile",
          "AllowUsers",
          "PasswordAuthentication",
          "from= restrictions",
        ],
        permissionFocus: [
          "authorized_keys ownership",
          ".ssh directory permissions",
          "contractor account status",
        ],
        serviceFocus: ["ssh.service", "auditd.service", "rsyslog.service"],
        analystQuestions: [
          "Which key was used and should it still be trusted?",
          "Does the source IP match the maintenance record?",
          "What immediate key rotation or restriction is required?",
        ],
      };

    case "cron_persistence":
      return {
        risks: [
          "Unapproved cron entry executes outside maintenance window",
          "Script owner does not match documented service ownership",
          "Scheduled execution may provide persistence",
          "Script path permissions require review",
        ],
        configFocus: ["root crontab", "user crontab", "cron.d entries", "script path"],
        permissionFocus: [
          "script write permissions",
          "cron file ownership",
          "temporary directory usage",
        ],
        serviceFocus: ["cron.service", "rsyslog.service", "auditd.service"],
        analystQuestions: [
          "Which scheduled task is undocumented?",
          "Who owns the script and when did it last execute?",
          "What evidence supports benign maintenance versus persistence?",
        ],
      };

    case "systemd_persistence":
      return {
        risks: [
          "Enabled service not present in approved baseline",
          "Unit file path or ExecStart command requires validation",
          "Service may restart automatically after reboot",
          "Change ticket does not explain service enablement",
        ],
        configFocus: ["systemd unit file", "WantedBy target", "ExecStart", "service baseline"],
        permissionFocus: [
          "unit file ownership",
          "binary path permissions",
          "drop-in override permissions",
        ],
        serviceFocus: ["systemd", "auditd.service", "rsyslog.service"],
        analystQuestions: [
          "Which service was enabled and is it approved?",
          "Which account created or modified the unit?",
          "Should the service be disabled before deeper analysis?",
        ],
      };

    case "unauthorized_package_install":
      return {
        risks: [
          "Package installed outside approved change window",
          "Package source requires validation",
          "New service or binary may have expanded attack surface",
          "Change management evidence is incomplete",
        ],
        configFocus: ["apt history", "dpkg log", "package repositories", "change ticket"],
        permissionFocus: ["sudo command attribution", "package-owned files", "new service files"],
        serviceFocus: ["apt-daily.service", "unattended-upgrades.service", "auditd.service"],
        analystQuestions: [
          "Which package was installed and by whom?",
          "Does the installation match a legitimate change?",
          "What rollback or approval action is required?",
        ],
      };

    case "data_staging":
      return {
        risks: [
          "Unexpected archive files in temporary paths",
          "Service account used for manual archive activity",
          "Archive scope may include sensitive directories",
          "Potential preparation for data exfiltration",
        ],
        configFocus: ["backup scripts", "tmp cleanup policy", "rsync command history", "backup inventory"],
        permissionFocus: ["archive ownership", "tmp directory permissions", "backup path access"],
        serviceFocus: ["backup.service", "cron.service", "ssh.service"],
        analystQuestions: [
          "Which data appears staged and why?",
          "Was this consistent with backup automation?",
          "What containment should happen before deleting evidence?",
        ],
      };

    case "log_tampering":
      return {
        risks: [
          "Authentication log gap near suspicious activity",
          "Manual log rotation or truncation requires attribution",
          "Journal and audit evidence must be correlated",
          "Monitoring confidence may be reduced",
        ],
        configFocus: ["rsyslog config", "logrotate config", "auditd status", "journal export"],
        permissionFocus: ["/var/log permissions", "logrotate ownership", "adm group membership"],
        serviceFocus: ["rsyslog.service", "systemd-journald.service", "auditd.service"],
        analystQuestions: [
          "Is the log gap explainable by maintenance?",
          "Which secondary source confirms activity during the gap?",
          "How should monitoring be restored and validated?",
        ],
      };

    case "reverse_shell":
      return {
        risks: [
          "Outbound connection resembles shell activity",
          "Application account spawned unexpected process",
          "Web service logs and process evidence require correlation",
          "Host egress controls may be insufficient",
        ],
        configFocus: ["web server config", "egress firewall", "process snapshot", "application logs"],
        permissionFocus: ["web root permissions", "application user shell", "temporary script permissions"],
        serviceFocus: ["apache2.service", "ssh.service", "ufw.service"],
        analystQuestions: [
          "Which process initiated the outbound session?",
          "Was application activity normal at that time?",
          "What egress or web hardening should be prioritised?",
        ],
      };

    case "docker_compromise":
      return {
        risks: [
          "Container mounted sensitive host paths",
          "Container bind mount may expose host paths outside expected scope",
          "Image provenance and runtime flags require review",
          "Docker group access may be too broad",
        ],
        configFocus: ["docker compose file", "container mounts", "image digest", "daemon config"],
        permissionFocus: ["docker group members", "host path permissions", "container runtime user"],
        serviceFocus: ["docker.service", "containerd.service", "auditd.service"],
        analystQuestions: [
          "Which mount exposed host data?",
          "Which user or service launched the container?",
          "What runtime hardening would reduce recurrence?",
        ],
      };
  }
}
