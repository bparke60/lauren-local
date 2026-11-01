#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
mkdir -p work
swiftc native/PresenceMotion.swift test-native/main.swift -o work/check-presence-motion
work/check-presence-motion
