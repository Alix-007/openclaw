#!/usr/bin/env bash
# Exercise the host Fleet CLI against an official cell image on disposable CI.
set -euo pipefail
umask 022

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "${GITHUB_ACTIONS:-}" != true || -f /.dockerenv ]]; then
  echo "Fleet Docker proof requires a disposable GitHub Actions Linux host." >&2
  exit 1
fi
endpoint="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
[[ "$endpoint" == unix:///* ]]
socket="${endpoint#unix://}"
[[ -S "$socket" ]]
docker info --format '{{json .SecurityOptions}}' | jq -e 'all(.[]; contains("rootless") | not)'
docker version --format '{{.Server.Version}}'
socket_gid="$(stat -c %g "$socket")"
node_bin="$(command -v node)"
sudo -n setpriv --reuid=1501 --regid=1501 --groups="$socket_gid" "$node_bin" --version

# The host CLI and its dependencies come from this exact checkout. Cell code
# stays pinned to the official image, so changing the host profile is isolated.
pnpm build
image_tag="ghcr.io/openclaw/openclaw:2026.8.2"
timeout 600s docker pull "$image_tag"
image="$(docker image inspect "$image_tag" --format '{{index .RepoDigests 0}}')"
printf 'Fleet host source: %s\nCell image: %s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD)" "$image"

umask 077
scratch="$(mktemp -d /tmp/openclaw-fleet-cache-e2e.XXXXXX)"
chmod 755 "$scratch"
tenant=""
case_dir=""
uid=1501
interrupted=false

fleet() {
  timeout 180s sudo -n setpriv --reuid="$uid" --regid="$uid" --groups="$socket_gid" \
    env -i PATH="$PATH" HOME="$case_dir/home" OPENCLAW_HOME="$case_dir/home" \
    OPENCLAW_STATE_DIR="$case_dir/state" XDG_CACHE_HOME="$case_dir/host-cache" \
    DOCKER_HOST="$endpoint" "$node_bin" "$ROOT_DIR/openclaw.mjs" fleet "$@"
}

capture() {
  local stage="$1"
  echo "==> Fleet $tenant $stage"
  fleet status "$tenant" --json
  fleet logs "$tenant"
  docker inspect "openclaw-cell-$tenant" | jq '.[0] | {
    Id, State, Image, user: .Config.User,
    environment: [.Config.Env[] | select(startswith("OPENCLAW_GATEWAY_TOKEN=") | not)],
    labels: .Config.Labels, mounts: .Mounts,
    resources: {memory: .HostConfig.Memory, cpus: .HostConfig.NanoCpus},
    capDrop: .HostConfig.CapDrop, securityOpt: .HostConfig.SecurityOpt,
    networkMode: .HostConfig.NetworkMode, ports: .HostConfig.PortBindings
  }'
}

cleanup_cell() {
  if [[ -z "$tenant" ]]; then
    return
  fi
  fleet rm "$tenant" --force --purge-data
  if docker container inspect "openclaw-cell-$tenant" >/dev/null 2>&1; then
    echo "Fleet proof left a cell container behind: $tenant" >&2
    return 1
  fi
  if docker network inspect "openclaw-cell-$tenant-net" >/dev/null 2>&1; then
    echo "Fleet proof left a cell network behind: $tenant" >&2
    return 1
  fi
  tenant=""
}

cleanup() {
  local result=$?
  trap - EXIT
  if (( result != 0 )) && [[ -n "$tenant" && "$interrupted" == false ]]; then
    capture failure || echo "Fleet failure diagnostics were incomplete for $tenant." >&2
  fi
  if ! cleanup_cell; then
    echo "Fleet proof cleanup failed; retained scratch: $scratch" >&2
    exit 1
  fi
  sudo -n rm -rf -- "$scratch"
  exit "$result"
}
trap cleanup EXIT
trap 'interrupted=true; exit 130' INT
trap 'interrupted=true; exit 143' TERM

assert_cell() {
  local expected_cache="$1"
  local expected_keys="$2"
  local expected_tmp="$3"
  docker inspect "openclaw-cell-$tenant" | \
    "$node_bin" "$ROOT_DIR/scripts/e2e/lib/fleet-cache/assert-cell.mjs" \
      "$expected_cache" "$expected_keys" "$expected_tmp" "$case_dir/state" "$tenant"
  local expected_uid="$uid"
  if (( uid == 0 )); then
    expected_uid=1000
  fi
  docker exec "openclaw-cell-$tenant" node -e '
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const cache = process.env.XDG_CACHE_HOME;
    assert.equal(process.getuid(), Number(process.argv[1]));
    assert.equal(fs.statSync(cache).uid, process.getuid());
    const cacheProbe = fs.mkdtempSync(path.join(cache, "write-probe-"));
    const tempProbe = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-write-probe-"));
    for (const directory of [cacheProbe, tempProbe]) {
      fs.writeFileSync(path.join(directory, "probe"), "writable");
      fs.rmSync(directory, { recursive: true });
    }
    console.log(JSON.stringify({uid: process.getuid(), gid: process.getgid(),
      cache, tmpdir: os.tmpdir(), cacheWrite: true, temporaryWrite: true}));
  ' "$expected_uid"
}

run_case() {
  local name="$1"
  uid="$2"
  local expected_cache="$3"
  local expected_keys="$4"
  local expected_tmp="$5"
  shift 5
  tenant="fleet-cache-${scratch##*.}-$name"
  tenant="${tenant,,}"
  case_dir="$scratch/$name"
  mkdir -p "$case_dir/home" "$case_dir/state" "$case_dir/host-cache"
  sudo -n chown -R "$uid:$uid" "$case_dir"
  local create_result=0
  fleet create "$tenant" --image "$image" --gateway-token fleet-cache-synthetic-token \
    "$@" --json > "$scratch/create.json" || create_result=$?
  capture create
  if (( create_result != 0 )); then
    echo "Fleet create failed for $name (host UID $uid): $create_result" >&2
    return "$create_result"
  fi
  assert_cell "$expected_cache" "$expected_keys" "$expected_tmp"
  fleet upgrade "$tenant" --image "$image"
  capture upgrade
  assert_cell "$expected_cache" "$expected_keys" "$expected_tmp"
  fleet stop "$tenant"
  fleet backup "$tenant" --out "$case_dir/backup.tgz" --json
  fleet restore "$tenant" --from "$case_dir/backup.tgz" --json > "$scratch/restore.json"
  jq -e '.started == false' "$scratch/restore.json" >/dev/null
  fleet start "$tenant"
  local port
  port="$(docker inspect "openclaw-cell-$tenant" --format '{{(index (index .NetworkSettings.Ports "18789/tcp") 0).HostPort}}')"
  local deadline=$((SECONDS + 60))
  until curl --fail --silent --max-time 1 "http://127.0.0.1:$port/healthz"; do
    if (( SECONDS >= deadline )); then
      capture restore-timeout
      return 1
    fi
    sleep 1
  done
  capture restore
  assert_cell "$expected_cache" "$expected_keys" "$expected_tmp"
  fleet restore "$tenant" --from "$case_dir/backup.tgz" --force --json > "$scratch/restore.json"
  jq -e '.started == true' "$scratch/restore.json" >/dev/null
  capture forced-restore
  assert_cell "$expected_cache" "$expected_keys" "$expected_tmp"
  cleanup_cell
}

run_case mismatch 1501 /home/node/.openclaw/cache '' ''
run_case override 1501 /home/node/.openclaw/operator-cache XDG_CACHE_HOME '' \
  --env XDG_CACHE_HOME=/home/node/.openclaw/operator-cache
run_case equal 1501 /home/node/.openclaw/cache XDG_CACHE_HOME '' \
  --env XDG_CACHE_HOME=/home/node/.openclaw/cache
run_case temporary 1501 /home/node/.openclaw/cache TMPDIR /tmp --env TMPDIR=/tmp
run_case image-user 1000 /home/node/.openclaw/cache '' ''
run_case root-invoker 0 /home/node/.openclaw/cache '' ''
