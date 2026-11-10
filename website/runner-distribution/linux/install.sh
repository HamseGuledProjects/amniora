#!/bin/bash
set -euo pipefail

# Rendered release values. The release process substitutes every @@...@@ token,
# signs both architecture manifests, and publishes this script at its immutable URL.
readonly RUNNER_VERSION="@@RUNNER_VERSION@@"
readonly PROTOCOL_VERSION="@@PROTOCOL_VERSION@@"
readonly MINIMUM_COMPATIBLE_VERSION="@@MINIMUM_COMPATIBLE_VERSION@@"
readonly MINIMUM_DOCKER_VERSION="@@MINIMUM_DOCKER_VERSION@@"
readonly DISTRIBUTION_ORIGIN="@@DISTRIBUTION_ORIGIN@@"
readonly BROKER_HOST="@@BROKER_HOST@@"
readonly BROKER_PORT="@@BROKER_PORT@@"
readonly BROKER_SERVER_NAME="@@BROKER_SERVER_NAME@@"
readonly MANIFEST_PUBLIC_KEY_B64="@@MANIFEST_PUBLIC_KEY_B64@@"

readonly INSTALL_ROOT="/opt/amniora-runner"
readonly RELEASES_ROOT="${INSTALL_ROOT}/releases"
readonly CURRENT_LINK="${INSTALL_ROOT}/current"
readonly STATE_ROOT="/var/lib/amniora-runner"
readonly CONFIG_ROOT="/etc/amniora-runner"
readonly RUNTIME_ROOT="/run/amniora-runner"
readonly SERVICE_USER="amniora-runner"
readonly SERVICE_UNIT="/etc/systemd/system/amniora-runner.service"
readonly UNINSTALL_COMMAND="/usr/local/sbin/amniora-runner-uninstall"
readonly IDENTITY_PATH="${STATE_ROOT}/runner-identity.json"
readonly BOOTSTRAP_PATH="${STATE_ROOT}/bootstrap-state.v1"
readonly MEMBERSHIP_MARKER="${STATE_ROOT}/install/docker-membership-created"
readonly USER_MARKER="${STATE_ROOT}/install/service-account-created"

temporary=""
staging=""
identity_backup=""
previous_current=""
current_updated=false
install_complete=false
cleanup() {
  /usr/bin/rm -f -- "${RUNTIME_ROOT}/enrollment" 2>/dev/null || true
  if [[ "$install_complete" != true ]]; then
    if [[ -n "$identity_backup" && -f "$identity_backup" && ! -L "$identity_backup" ]]; then
      /usr/bin/systemctl stop amniora-runner.service >/dev/null 2>&1 || true
      /usr/bin/install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0600 "$identity_backup" "$IDENTITY_PATH" 2>/dev/null || true
    fi
    if [[ "$current_updated" == true ]]; then
      if [[ -n "$previous_current" ]]; then
        /usr/bin/ln -s "$previous_current" "${INSTALL_ROOT}/.rollback-$$" 2>/dev/null || true
        /usr/bin/mv -Tf -- "${INSTALL_ROOT}/.rollback-$$" "$CURRENT_LINK" 2>/dev/null || true
      else
        /usr/bin/rm -f -- "$CURRENT_LINK" 2>/dev/null || true
      fi
    fi
  fi
  [[ -z "$staging" ]] || /usr/bin/rm -rf -- "$staging"
  [[ -z "$temporary" ]] || /usr/bin/rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_command() {
  [[ -x "$1" ]] || die "missing_required_command:${1##*/}"
}

manifest_value() {
  local key="$1" value count
  count=$(/usr/bin/grep -c "^${key}=" "$2" || true)
  [[ "$count" == "1" ]] || die "invalid_signed_manifest"
  value=$(/usr/bin/sed -n "s/^${key}=//p" "$2")
  [[ -n "$value" ]] || die "invalid_signed_manifest"
  printf '%s' "$value"
}

version_at_least() {
  local required="$1" observed="$2" first
  [[ "$observed" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || return 1
  first=$(printf '%s\n%s\n' "$required" "$observed" | /usr/bin/sort -V | /usr/bin/head -n 1)
  [[ "$first" == "$required" ]]
}

mode=""
owner_id=""
replace_identity=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --enrollment-stdin)
      [[ -z "$mode" ]] || die "conflicting_install_mode"
      mode="enroll"
      shift
      ;;
    --update)
      [[ -z "$mode" ]] || die "conflicting_install_mode"
      mode="update"
      shift
      ;;
    --replace-identity)
      replace_identity=true
      shift
      ;;
    --owner)
      [[ $# -ge 2 && -z "$owner_id" ]] || die "invalid_owner"
      owner_id="$2"
      shift 2
      ;;
    *) die "invalid_installer_option" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "Run with sudo."
[[ "$mode" == "enroll" || "$mode" == "update" ]] || die "install_mode_required"
if [[ "$mode" == "enroll" ]]; then
  [[ "$replace_identity" == true ]] || die "explicit_identity_replacement_required"
  [[ "$owner_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || die "invalid_owner"
else
  [[ "$replace_identity" == false && -z "$owner_id" ]] || die "invalid_update_arguments"
  { [[ -f "$IDENTITY_PATH" && ! -L "$IDENTITY_PATH" ]] ||
    [[ -f "${STATE_ROOT}/install/runner-identity.backup" && ! -L "${STATE_ROOT}/install/runner-identity.backup" ]]; } || die "existing_runner_identity_required"
fi

for command in /usr/bin/awk /usr/bin/base64 /usr/bin/chmod /usr/bin/chown /usr/bin/curl /usr/bin/docker \
  /usr/bin/find /usr/bin/getent /usr/bin/grep /usr/bin/head /usr/bin/id /usr/bin/install /usr/bin/ln \
  /usr/bin/mktemp /usr/bin/mv /usr/bin/openssl /usr/bin/readlink /usr/bin/realpath /usr/bin/rm /usr/bin/sed \
  /usr/bin/seq /usr/bin/sha256sum /usr/bin/sleep /usr/bin/sort /usr/bin/stat /usr/bin/systemctl \
  /usr/bin/tar /usr/bin/uname /usr/sbin/groupadd /usr/sbin/useradd /usr/sbin/usermod; do
  require_command "$command"
done

os_release=/etc/os-release
if [[ -L "$os_release" ]]; then
  os_release=$(/usr/bin/realpath -e -- "$os_release")
  [[ "$os_release" == "/usr/lib/os-release" ]] || die "unsupported_operating_system"
fi
[[ -r "$os_release" && -f "$os_release" && ! -L "$os_release" ]] || die "unsupported_operating_system"
[[ "$(/usr/bin/stat -c '%U:%G' "$os_release")" == "root:root" ]] || die "unsupported_operating_system"
os_id=$(/usr/bin/sed -n 's/^ID=//p' "$os_release" | /usr/bin/head -n 1 | /usr/bin/sed 's/^"//;s/"$//')
os_version=$(/usr/bin/sed -n 's/^VERSION_ID=//p' "$os_release" | /usr/bin/head -n 1 | /usr/bin/sed 's/^"//;s/"$//')
[[ "$os_id" == "ubuntu" && "$os_version" == "24.04" ]] || die "unsupported_operating_system"

machine=$(/usr/bin/uname -m)
case "$machine" in
  x86_64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *) die "unsupported_architecture" ;;
esac

/usr/bin/systemctl is-active --quiet docker.service || die "docker_unavailable"
docker_version=$(/usr/bin/docker version --format '{{.Server.Version}}' 2>/dev/null || true)
[[ -n "$docker_version" ]] || die "docker_permission_issue"
version_at_least "$MINIMUM_DOCKER_VERSION" "$docker_version" || die "unsupported_docker_version"

temporary=$(/usr/bin/mktemp -d /tmp/amniora-runner-install.XXXXXXXX)
/usr/bin/chmod 0700 "$temporary"
artifact="amniora-runner-${RUNNER_VERSION}-linux-${architecture}.tar.gz"
manifest="${temporary}/${artifact}.manifest"
signature="${manifest}.sig"
archive="${temporary}/${artifact}"
public_key="${temporary}/manifest-public-key.pem"

for suffix in "$artifact" "${artifact}.manifest" "${artifact}.manifest.sig"; do
  /usr/bin/curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --output "${temporary}/${suffix}" "${DISTRIBUTION_ORIGIN}/runner/releases/${RUNNER_VERSION}/${suffix}"
done
printf '%s' "$MANIFEST_PUBLIC_KEY_B64" | /usr/bin/base64 --decode >"$public_key"
/usr/bin/chmod 0600 "$public_key"
/usr/bin/openssl pkeyutl -verify -pubin -inkey "$public_key" -rawin -in "$manifest" -sigfile "$signature" >/dev/null 2>&1 || die "artifact_manifest_signature_invalid"

[[ "$(/usr/bin/head -n 1 "$manifest")" == "AMNIORA-RUNNER-MANIFEST 1" ]] || die "invalid_signed_manifest"
[[ "$(manifest_value runnerVersion "$manifest")" == "$RUNNER_VERSION" ]] || die "runner_version_mismatch"
[[ "$(manifest_value protocolVersion "$manifest")" == "$PROTOCOL_VERSION" ]] || die "runner_protocol_mismatch"
[[ "$(manifest_value minimumCompatibleVersion "$manifest")" == "$MINIMUM_COMPATIBLE_VERSION" ]] || die "runner_compatibility_mismatch"
[[ "$(manifest_value os "$manifest")" == "linux" ]] || die "runner_operating_system_mismatch"
[[ "$(manifest_value distribution "$manifest")" == "ubuntu-24.04" ]] || die "runner_distribution_mismatch"
[[ "$(manifest_value architecture "$manifest")" == "$architecture" ]] || die "runner_architecture_mismatch"
[[ "$(manifest_value artifact "$manifest")" == "$artifact" ]] || die "runner_artifact_name_mismatch"
expected_archive_sha=$(manifest_value artifactSha256 "$manifest")
[[ "$expected_archive_sha" =~ ^[0-9a-f]{64}$ ]] || die "invalid_signed_manifest"
[[ "$(/usr/bin/sha256sum "$archive" | /usr/bin/awk '{print $1}')" == "$expected_archive_sha" ]] || die "runner_artifact_checksum_mismatch"

while IFS= read -r member; do
  [[ -n "$member" && "$member" != /* && "$member" != *".."* && "$member" =~ ^[A-Za-z0-9._/-]+$ ]] || die "unsafe_runner_artifact_path"
done < <(/usr/bin/tar -tzf "$archive")
while IFS= read -r detail; do
  [[ "${detail:0:1}" == "-" ]] || die "unsafe_runner_artifact_type"
done < <(/usr/bin/tar -tvzf "$archive")

/usr/bin/install -d -o root -g root -m 0755 "$INSTALL_ROOT" "$RELEASES_ROOT"
while IFS= read -r stale_release; do
  [[ -d "$stale_release" && ! -L "$stale_release" ]] || die "unsafe_stale_release_path"
  [[ "$(/usr/bin/stat -c '%U' "$stale_release")" == "root" ]] || die "unsafe_stale_release_owner"
  resolved_stale=$(/usr/bin/realpath -e -- "$stale_release")
  [[ "$resolved_stale" == "${RELEASES_ROOT}/.staging-${RUNNER_VERSION}-"* ||
     "$resolved_stale" == "${RELEASES_ROOT}/.previous-${RUNNER_VERSION}-"* ]] || die "unsafe_stale_release_path"
  /usr/bin/rm -rf -- "$resolved_stale"
done < <(/usr/bin/find "$RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d \( -name ".staging-${RUNNER_VERSION}-*" -o -name ".previous-${RUNNER_VERSION}-*" \) -print)
staging="${RELEASES_ROOT}/.staging-${RUNNER_VERSION}-$$"
/usr/bin/rm -rf -- "$staging"
/usr/bin/install -d -o root -g root -m 0700 "$staging"
/usr/bin/tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$staging"

file_count=0
while IFS= read -r line; do
  [[ "$line" == file=* ]] || continue
  detail=${line#file=}
  read -r expected_sha expected_mode expected_size relative extra <<<"$detail"
  [[ -z "${extra:-}" && "$expected_sha" =~ ^[0-9a-f]{64}$ && "$expected_mode" =~ ^0[0-7]{3}$ && "$expected_size" =~ ^[0-9]+$ ]] || die "invalid_signed_manifest"
  [[ "$relative" =~ ^[A-Za-z0-9._/-]+$ && "$relative" != /* && "$relative" != *".."* ]] || die "invalid_signed_manifest"
  target="${staging}/${relative}"
  [[ -f "$target" && ! -L "$target" ]] || die "runner_artifact_file_missing"
  [[ "$(/usr/bin/sha256sum "$target" | /usr/bin/awk '{print $1}')" == "$expected_sha" ]] || die "runner_artifact_file_tampered"
  [[ "$(/usr/bin/stat -c '%s' "$target")" == "$expected_size" ]] || die "runner_artifact_file_size_mismatch"
  /usr/bin/chmod "$expected_mode" "$target"
  file_count=$((file_count + 1))
done <"$manifest"
[[ $file_count -ge 10 ]] || die "runner_artifact_file_manifest_incomplete"
while IFS= read -r extracted; do
  relative=${extracted#"${staging}/"}
  /usr/bin/awk -v expected_path="$relative" '$1 ~ /^file=[0-9a-f]{64}$/ && $2 ~ /^0[0-7]{3}$/ && $3 ~ /^[0-9]+$/ && $4 == expected_path { matches += 1 } END { exit matches == 1 ? 0 : 1 }' "$manifest" || die "runner_artifact_unexpected_file"
done < <(/usr/bin/find "$staging" -type f -print)

if ! /usr/bin/getent group "$SERVICE_USER" >/dev/null; then
  /usr/sbin/groupadd --system "$SERVICE_USER"
fi
if ! /usr/bin/id "$SERVICE_USER" >/dev/null 2>&1; then
  /usr/sbin/useradd --system --gid "$SERVICE_USER" --home-dir "$STATE_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
  service_user_created=true
else
  service_user_created=false
  [[ "$(/usr/bin/getent passwd "$SERVICE_USER" | /usr/bin/awk -F: '{print $7}')" == "/usr/sbin/nologin" ]] || die "unsafe_existing_service_account"
fi
/usr/bin/install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_ROOT"
/usr/bin/install -d -o root -g root -m 0700 "${STATE_ROOT}/install"
$service_user_created && /usr/bin/install -o root -g root -m 0600 /dev/null "$USER_MARKER"
stale_identity_backup="${STATE_ROOT}/install/runner-identity.backup"
if [[ -f "$stale_identity_backup" && ! -L "$stale_identity_backup" ]]; then
  [[ "$(/usr/bin/stat -c '%U:%G:%a' "$stale_identity_backup")" == "root:root:600" ]] || die "unsafe_identity_backup"
  if [[ ! -e "$IDENTITY_PATH" ]]; then
    /usr/bin/install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0600 "$stale_identity_backup" "$IDENTITY_PATH"
  fi
  /usr/bin/rm -f -- "$stale_identity_backup"
fi
if [[ "$mode" == "update" ]]; then
  [[ -f "$IDENTITY_PATH" && ! -L "$IDENTITY_PATH" ]] || die "existing_runner_identity_required"
fi
if ! /usr/bin/id -nG "$SERVICE_USER" | /usr/bin/grep -qw docker; then
  /usr/sbin/usermod -a -G docker "$SERVICE_USER"
  /usr/bin/install -o root -g root -m 0600 /dev/null "$MEMBERSHIP_MARKER"
fi
/usr/bin/id -nG "$SERVICE_USER" | /usr/bin/grep -qw docker || die "runner_docker_membership_failed"

/usr/bin/chown -R root:"$SERVICE_USER" "$staging"
while IFS= read -r directory; do /usr/bin/chmod 0750 "$directory"; done < <(/usr/bin/find "$staging" -type d -print)
release_target="${RELEASES_ROOT}/${RUNNER_VERSION}"
previous_target="${RELEASES_ROOT}/.previous-${RUNNER_VERSION}-$$"
if [[ -e "$release_target" || -L "$release_target" ]]; then
  /usr/bin/mv -- "$release_target" "$previous_target"
fi
/usr/bin/mv -- "$staging" "$release_target"
staging=""
/usr/bin/rm -rf -- "$previous_target"

if [[ -L "$CURRENT_LINK" ]]; then
  previous_current=$(/usr/bin/readlink "$CURRENT_LINK")
  [[ "$previous_current" =~ ^releases/[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "unsafe_existing_current_link"
elif [[ -e "$CURRENT_LINK" ]]; then
  die "unsafe_existing_current_path"
fi
/usr/bin/ln -s "releases/${RUNNER_VERSION}" "${INSTALL_ROOT}/.current-$$"
/usr/bin/mv -Tf -- "${INSTALL_ROOT}/.current-$$" "$CURRENT_LINK"
current_updated=true
/usr/bin/install -d -o root -g "$SERVICE_USER" -m 0750 "$CONFIG_ROOT" "$RUNTIME_ROOT"
{
  printf 'AMNIORA_BYO_BROKER_HOST=%s\n' "$BROKER_HOST"
  printf 'AMNIORA_BYO_BROKER_PORT=%s\n' "$BROKER_PORT"
  printf 'AMNIORA_BYO_BROKER_SERVER_NAME=%s\n' "$BROKER_SERVER_NAME"
  printf 'AMNIORA_BYO_BROKER_CA_PATH=%s\n' "${CURRENT_LINK}/share/trust/broker-ca.pem"
  printf 'AMNIORA_BYO_STATE_DIR=%s\n' "$STATE_ROOT"
  printf 'AMNIORA_BYO_VERIFICATION_KEYS_PATH=%s\n' "${CURRENT_LINK}/share/trust/package-verification-keys.json"
  printf 'AMNIORA_BYO_RUNTIME_CONTAINER_CONTEXT=%s\n' "${CURRENT_LINK}/share/container"
  printf 'AMNIORA_BYO_BOOTSTRAP_DIAGNOSTICS=1\n'
  [[ -z "$owner_id" ]] || printf 'AMNIORA_BYO_OWNER_ID=%s\n' "$owner_id"
} >"${CONFIG_ROOT}/runner.conf"
/usr/bin/chown root:"$SERVICE_USER" "${CONFIG_ROOT}/runner.conf"
/usr/bin/chmod 0640 "${CONFIG_ROOT}/runner.conf"
/usr/bin/install -o root -g root -m 0644 "${CURRENT_LINK}/share/systemd/amniora-runner.service" "$SERVICE_UNIT"
/usr/bin/install -o root -g root -m 0755 "${CURRENT_LINK}/bin/amniora-runner-uninstall" "$UNINSTALL_COMMAND"
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable amniora-runner.service >/dev/null

if [[ "$mode" == "enroll" ]]; then
  /usr/bin/systemctl stop amniora-runner.service >/dev/null 2>&1 || true
  if [[ -f "$IDENTITY_PATH" && ! -L "$IDENTITY_PATH" ]]; then
    identity_backup="${STATE_ROOT}/install/runner-identity.backup"
    /usr/bin/install -o root -g root -m 0600 "$IDENTITY_PATH" "$identity_backup"
    /usr/bin/rm -f -- "$IDENTITY_PATH"
  fi
  /usr/bin/install -o root -g "$SERVICE_USER" -m 0640 /dev/stdin "${RUNTIME_ROOT}/enrollment"
fi

/usr/bin/rm -f -- "$BOOTSTRAP_PATH"
/usr/bin/systemctl restart amniora-runner.service
connected=false
for _attempt in $(/usr/bin/seq 1 40); do
  if [[ -f "$BOOTSTRAP_PATH" ]] && /usr/bin/grep -qx 'stage=CONNECTED' "$BOOTSTRAP_PATH"; then
    connected=true
    break
  fi
  if [[ -f "$BOOTSTRAP_PATH" ]] && /usr/bin/grep -qx 'stage=FAILED' "$BOOTSTRAP_PATH"; then
    break
  fi
  /usr/bin/sleep 1
done
/usr/bin/rm -f -- "${RUNTIME_ROOT}/enrollment"
if [[ "$connected" != true ]]; then
  /usr/bin/systemctl stop amniora-runner.service >/dev/null 2>&1 || true
  if [[ -n "$identity_backup" && -f "$identity_backup" ]]; then
    /usr/bin/install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0600 "$identity_backup" "$IDENTITY_PATH"
  fi
  die "runner_connectivity_verification_failed"
fi
/usr/bin/rm -f -- "$identity_backup"
/usr/bin/systemctl is-active --quiet amniora-runner.service || die "runner_service_not_active"
[[ -f "$IDENTITY_PATH" && ! -L "$IDENTITY_PATH" ]] || die "runner_identity_missing"
[[ "$(/usr/bin/stat -c '%U:%G:%a' "$IDENTITY_PATH")" == "${SERVICE_USER}:${SERVICE_USER}:600" ]] || die "runner_identity_permissions_invalid"

install_complete=true
printf 'Amniora Runner %s installed. Runner online; Docker ready.\n' "$RUNNER_VERSION"
