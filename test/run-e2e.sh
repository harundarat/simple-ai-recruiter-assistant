#!/usr/bin/env bash
set -euo pipefail

repository_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
environment_file="$repository_dir/test/.env.e2e"
compose=(docker compose --project-name evalu8-e2e --env-file "$environment_file")

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

cd "$repository_dir"
set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

cleanup
"${compose[@]}" up --detach --wait db redis chromadb minio
"${compose[@]}" run --rm minio-init
pnpm exec prisma migrate deploy
NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-vm-modules" \
  pnpm exec jest --config ./test/jest-e2e.json --runInBand
