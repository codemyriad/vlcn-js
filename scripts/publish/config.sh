#!/usr/bin/env bash

# Configuration for publishing the codemyriad fork of vlcn-js.

REGISTRY_URL="${REGISTRY_URL:-https://npm.codemyriad.io/}"
DEV_DIST_TAG="${DEV_DIST_TAG:-dev}"
MYRIAD_DIST_TAG="${MYRIAD_DIST_TAG:-myriad}"

# Packages are ordered topologically so workspace protocol dependencies
# resolve to already-published versions during the run.
PUBLISH_PACKAGES=(
  "@vlcn.io/xplat-api:packages/xplat-api"
  "@vlcn.io/ws-common:packages/ws-common"
  "@vlcn.io/wa-sqlite:deps/wa-sqlite"
  "@vlcn.io/crsqlite:deps/cr-sqlite/core"
  "@vlcn.io/logger-provider:packages/logger-provider"
  "@vlcn.io/rx-tbl:packages/rx-tbl"
  "@vlcn.io/ws-client:packages/ws-client"
  "@vlcn.io/crsqlite-wasm:packages/crsqlite-wasm"
  "@vlcn.io/ws-server:packages/ws-server"
  "@vlcn.io/ws-browserdb:packages/ws-browserdb"
)
