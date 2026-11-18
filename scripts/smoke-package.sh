#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$root"
npm pack --pack-destination "$scratch"
cp -R "$root/examples/managed-agent" "$scratch/project"
cd "$scratch/project"
npm install "$scratch"/*.tgz --no-audit --no-fund
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { channel } from "./channels/photon.ts";

assert.equal(channel.kind, "photon");
NODE
mkdir -p vendor/photon-langchain
tar -xzf "$scratch"/*.tgz -C vendor/photon-langchain --strip-components 1
npm install ./vendor/photon-langchain --no-audit --no-fund
npm run build
cd .mda/build
npm ci --no-audit --no-fund
node --input-type=module -e 'import { channels } from "managed-deepagents"; if (typeof channels.http !== "function") throw new Error("Missing HTTP channel SDK")'
