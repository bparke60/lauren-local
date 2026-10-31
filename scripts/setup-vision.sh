#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
mkdir -p public/vendor/tasks-vision public/vendor/models
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
curl --fail --location --silent --show-error 'https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz' -o "$scratch/vision.tgz"
tar -xzf "$scratch/vision.tgz" -C "$scratch"
cp -R "$scratch/package/wasm" public/vendor/tasks-vision/
cp "$scratch/package/vision_bundle.mjs" public/vendor/tasks-vision/
if [ -f "$scratch/package/LICENSE" ]; then cp "$scratch/package/LICENSE" public/vendor/tasks-vision/; fi
curl --fail --location --silent --show-error 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite' -o public/vendor/models/efficientdet_lite0.tflite
curl --fail --location --silent --show-error 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/1/efficientdet_lite2.tflite' -o public/vendor/models/efficientdet_lite2.tflite
curl --fail --location --silent --show-error 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' -o public/vendor/models/hand_landmarker.task
printf '%s\n' 'Optional camera assets installed locally.'
