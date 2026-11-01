#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
mkdir -p Lauren.app/Contents/MacOS
swiftc native/PresenceMotion.swift native/Lauren.swift -o Lauren.app/Contents/MacOS/Lauren -framework AppKit -framework WebKit -framework AVFoundation -framework Speech
cat > Lauren.app/Contents/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.lauren.local</string><key>CFBundleName</key><string>Lauren</string><key>CFBundleExecutable</key><string>Lauren</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>4</string><key>CFBundleShortVersionString</key><string>0.4.0</string>
<key>LSUIElement</key><true/><key>NSMicrophoneUsageDescription</key><string>Lauren transcribes your speech on this Mac only when you click her or choose Talk to Lauren.</string><key>NSSpeechRecognitionUsageDescription</key><string>Lauren uses on-device English speech recognition. Cloud speech is disabled.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - Lauren.app
echo "Built Lauren.app. Keep it beside scripts/ and src/."
