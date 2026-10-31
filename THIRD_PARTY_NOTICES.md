# Third-Party Notices

## Character Assets

No third-party character model is included. Lauren's current cyberpunk-anime
sprite atlas was created specifically for this project, and the animation
renderer is project-owned code. No visible attribution or payment is required.

## Local vision assets

The optional full-screen camera prototype uses MediaPipe Tasks Vision 0.10.35 (Apache-2.0): https://github.com/google-ai-edge/mediapipe. After running `scripts/setup-vision.sh`, the package's JavaScript and WebAssembly runtime files are self-hosted under `public/vendor/tasks-vision/`.

EfficientDet Lite object detection and MediaPipe hand landmark models are stored under `public/vendor/models/`. Upstream project and model information: https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector and https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker. Model distribution terms remain those of the upstream assets.

Qwen, Gemma, Kokoro, and their weights are not bundled in this source repository. They retain their own upstream licenses and use conditions. Apple speech recognition is provided by macOS.
