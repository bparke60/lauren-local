import AppKit
import WebKit
import AVFoundation
import Speech

final class SpiritPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class LaurenApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate, NSMenuDelegate {
    var window: SpiritPanel!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var menu: NSMenu!
    var wanderItem: NSMenuItem!
    var voiceItem: NSMenuItem!
    var formItems: [NSMenuItem] = []
    var server: Process?
    let audio = AVAudioEngine()
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    var request: SFSpeechAudioBufferRecognitionRequest?
    var recognition: SFSpeechRecognitionTask?
    var listening = false
    var recognizedText = ""
    var speechID = UUID()
    var silenceTimer: Timer?
    var captureTimer: Timer?
    var animation: Timer?
    var motion = PresenceMotion(position: .zero)
    var lastTick = ProcessInfo.processInfo.systemUptime
    var nextTurn = ProcessInfo.processInfo.systemUptime + 18
    var lastReport = 0.0
    var hitPending = false
    var dragging = false
    var dragStart = CGPoint.zero
    var dragOrigin = CGPoint.zero
    var dragPrevious = CGPoint.zero
    var dragVelocity = CGVector.zero
    var busy = false
    var visible = true
    var ready = false
    var menuOpen = false
    var pendingBounce = false
    var observedPointer = NSEvent.mouseLocation
    var pointerActiveAt = ProcessInfo.processInfo.systemUptime
    var wander = UserDefaults.standard.object(forKey: "wander") as? Bool ?? true
    var voice = UserDefaults.standard.object(forKey: "voice") as? Bool ?? true
    var form = UserDefaults.standard.string(forKey: "form") ?? "auto"
    var project: URL { Bundle.main.bundleURL.deletingLastPathComponent() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        makeMenu()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "lauren")
        configuration.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.underPageBackgroundColor = .clear
        web.setValue(false, forKey: "drawsBackground")
        window = SpiritPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 390), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.title = "Lauren"
        window.contentView = web
        window.delegate = self
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.ignoresMouseEvents = true
        if let screen = NSScreen.main {
            motion.position = CGPoint(x: screen.visibleFrame.maxX - 320, y: screen.visibleFrame.minY + 10)
            window.setFrameOrigin(motion.position)
        }
        window.orderFrontRegardless()
        // A transparent companion does not activate another application or take keyboard focus on launch.
        launchServer()
        awaitServer(attempt: 0)
        animation = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(animation!, forMode: .common)
    }

    func makeMenu() {
        let main = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        let quitItem = NSMenuItem(title: "Quit Lauren", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self; appMenu.addItem(quitItem); appItem.submenu = appMenu; main.addItem(appItem); NSApp.mainMenu = main
        menu = NSMenu()
        menu.delegate = self
        add("Come here", #selector(comeHere), key: "l")
        add("Talk to Lauren", #selector(listen), key: " ")
        add("Send a typed message…", #selector(typedMessage))
        menu.addItem(.separator())
        let forms = NSMenu(), formParent = NSMenuItem(title: "Appearance", action: nil, keyEquivalent: "")
        for (title, value) in [("Automatic · body / face", "auto"), ("Full body", "body"), ("Floating face", "face")] {
            let item = NSMenuItem(title: title, action: #selector(selectForm(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = value; item.state = form == value ? .on : .off; forms.addItem(item); formItems.append(item)
        }
        formParent.submenu = forms; menu.addItem(formParent)
        wanderItem = add("Wander around screen", #selector(toggleWander))
        wanderItem.state = wander ? .on : .off
        voiceItem = add("Speak replies locally", #selector(toggleVoice))
        voiceItem.state = voice ? .on : .off
        add("Open tasks & lists", #selector(workspace))
        add("Export travel capsule…", #selector(exportTravelCapsule))
        menu.addItem(.separator())
        add("Hide Lauren", #selector(hide))
        add("Quit Lauren", #selector(quit), key: "q")
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "✦ Lauren"; statusItem.menu = menu
    }
    @discardableResult func add(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.target = self; menu.addItem(item); return item
    }
    func bounds(for screen: NSScreen) -> CGRect {
        let r = screen.visibleFrame
        return CGRect(x: r.minX - 30, y: r.minY - 15, width: max(0, r.width - window.frame.width + 60), height: max(0, r.height - window.frame.height + 100))
    }
    func screenAtPointer() -> NSScreen? { NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main }
    func tick() {
        guard window != nil, visible else { return }
        let now = ProcessInfo.processInfo.systemUptime, dt = min(0.05, max(0, now - lastTick)); lastTick = now
        let pointer = NSEvent.mouseLocation
        if pointer != observedPointer { pointerActiveAt = now; observedPointer = pointer }
        var bounced = false
        if dragging {
            let target = CGPoint(x: dragOrigin.x + pointer.x - dragStart.x, y: dragOrigin.y + pointer.y - dragStart.y)
            if dt > 0 { dragVelocity = CGVector(dx: (target.x - dragPrevious.x) / dt, dy: (target.y - dragPrevious.y) / dt) }
            dragPrevious = target; motion.position = target
        } else if let screen = window.screen ?? NSScreen.main {
            if wander && !busy && !menuOpen && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
                if now > nextTurn {
                    let angle = Double.random(in: 0...(2 * .pi)), speed = Double.random(in: 18...38)
                    motion.cruise = CGVector(dx: cos(angle) * speed, dy: sin(angle) * speed); nextTurn = now + Double.random(in: 14...25)
                }
                bounced = motion.step(seconds: dt, in: bounds(for: screen))
            } else { motion.contain(in: bounds(for: screen)) }
        }
        window.setFrameOrigin(motion.position)
        if bounced { pendingBounce = true }
        if ready { updateHitTest(pointer) }
        if ready && now - lastReport > 0.10 {
            lastReport = now
            js("laurenMotion", ["vx": dragging ? dragVelocity.dx : motion.velocity.dx, "vy": dragging ? dragVelocity.dy : motion.velocity.dy, "dragging": dragging, "bounce": pendingBounce, "quietFor": (now-pointerActiveAt)*1000])
            pendingBounce = false
        }
    }
    func updateHitTest(_ pointer: CGPoint) {
        if dragging { window.ignoresMouseEvents = false; return }
        guard window.frame.contains(pointer) else { window.ignoresMouseEvents = true; return }
        guard !hitPending else { return }
        hitPending = true
        let x = pointer.x - window.frame.minX, y = window.frame.maxY - pointer.y
        web.evaluateJavaScript("window.laurenHitTest?.(\(x),\(y)) ?? false") { [weak self] result, _ in
            guard let self = self else { return }; self.hitPending = false
            self.window.ignoresMouseEvents = !(result as? Bool ?? false)
        }
    }
    @objc func comeHere() {
        stopListening(deliver: false)
        visible = true; window.orderFrontRegardless()
        if let screen = screenAtPointer() {
            let mouse = NSEvent.mouseLocation
            motion.position = CGPoint(x: mouse.x - window.frame.width / 2, y: mouse.y - window.frame.height / 2)
            motion.contain(in: bounds(for: screen)); window.setFrameOrigin(motion.position)
        }
        js("laurenPreference", ["hint": true]); nextTurn = ProcessInfo.processInfo.systemUptime + 18
    }
    @objc func hide() { stopListening(deliver: false); visible = false; window.orderOut(nil) }
    @objc func toggleWander() { wander.toggle(); UserDefaults.standard.set(wander, forKey: "wander"); wanderItem.state = wander ? .on : .off }
    @objc func toggleVoice() { voice.toggle(); UserDefaults.standard.set(voice, forKey: "voice"); voiceItem.state = voice ? .on : .off; js("laurenPreference", ["voice": voice]) }
    @objc func selectForm(_ item: NSMenuItem) {
        form = item.representedObject as? String ?? "auto"; UserDefaults.standard.set(form, forKey: "form")
        for option in formItems { option.state = option === item ? .on : .off }
        js("laurenPreference", ["form": form])
    }
    @objc func workspace() { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:4327/tasks.html")!) }
    func menuWillOpen(_ menu: NSMenu) { menuOpen = true }
    func menuDidClose(_ menu: NSMenu) { menuOpen = false }
    @objc func exportTravelCapsule() {
        let picker = NSOpenPanel()
        picker.title = "Save Lauren’s travel capsule"
        picker.prompt = "Save here"
        picker.canChooseFiles = false; picker.canChooseDirectories = true; picker.canCreateDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        guard picker.runModal() == .OK, let folder = picker.url else { return }
        let formatter = DateFormatter(); formatter.dateFormat = "yyyyMMdd-HHmmss"
        let destination = folder.appendingPathComponent("Lauren-\(formatter.string(from: Date())).lauren.json")
        let task = Process(), output = Pipe()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = ["node", project.appendingPathComponent("scripts/capsule.mjs").path, "export", destination.path]
        task.currentDirectoryURL = project
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        task.environment = environment; task.standardOutput = output; task.standardError = output
        task.terminationHandler = { task in
            let detail = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                if task.terminationStatus == 0 {
                    let alert = NSAlert(); alert.messageText = "Lauren is ready to travel"
                    alert.informativeText = "Saved \(destination.lastPathComponent). It contains memory, conversations, lists, and tasks. The receiving device still needs a compatible Lauren app and local model."
                    alert.runModal()
                } else { self.showError(detail) }
            }
        }
        do { try task.run() } catch { showError(error.localizedDescription) }
    }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func typedMessage() {
        let wasWandering = wander; wander = false; comeHere()
        let prompt = NSAlert(); prompt.messageText = "Tell Lauren"; prompt.informativeText = "A quiet alternative to speaking. The desktop stays free of a permanent text box."
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 330, height: 26)); input.placeholderString = "Message Lauren"
        prompt.accessoryView = input; prompt.addButton(withTitle: "Send"); prompt.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true); prompt.window.initialFirstResponder = input
        if prompt.runModal() == .alertFirstButtonReturn && !input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { js("laurenHeard", input.stringValue) }
        wander = wasWandering
    }
    func launchServer() {
        try? FileManager.default.createDirectory(at: project.appendingPathComponent("data"), withIntermediateDirectories: true)
        let task = Process(); task.executableURL = URL(fileURLWithPath: "/bin/bash"); task.arguments = [project.appendingPathComponent("scripts/start.sh").path]; task.currentDirectoryURL = project
        let log = project.appendingPathComponent("data/desktop.log"); FileManager.default.createFile(atPath: log.path, contents: nil)
        if let handle = try? FileHandle(forWritingTo: log) { task.standardOutput = handle; task.standardError = handle }
        do { try task.run(); server = task } catch { showError(error.localizedDescription) }
    }
    func awaitServer(attempt: Int) {
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:4327/api/health")!) { _, response, _ in
            DispatchQueue.main.async {
                if (response as? HTTPURLResponse)?.statusCode == 200 { self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:4327/companion.html")!)) }
                else if attempt < 40 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.awaitServer(attempt: attempt + 1) } }
                else { self.showError("The local core did not start. Check data/desktop.log.") }
            }
        }.resume()
    }
    func showError(_ text: String) { let alert = NSAlert(); alert.messageText = "Lauren needs a moment"; alert.informativeText = text; alert.runModal() }
    func js(_ name: String, _ value: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]), let args = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web.evaluateJavaScript("window.\(name)?.(...\(args))", completionHandler: nil) }
    }
    func applicationWillTerminate(_ notification: Notification) { animation?.invalidate(); stopListening(deliver: false); if server?.isRunning == true { server?.terminate() } }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func windowShouldClose(_ sender: NSWindow) -> Bool { hide(); return false }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.host == "127.0.0.1" && url.port == 4327 {
            if action.targetFrame == nil || url.path == "/tasks.html" { NSWorkspace.shared.open(url); decisionHandler(.cancel) } else { decisionHandler(.allow) }
        } else { if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, url.host == "127.0.0.1", url.port == 4327, let event = message.body as? [String: Any], let action = event["action"] as? String else { return }
        switch action {
        case "ready": ready = true; js("laurenPreference", ["form": form, "voice": voice, "hint": true])
        case "listen": listen()
        case "activity":
            busy = event["busy"] as? Bool ?? false
            if busy && !dragging, let screen = window.screen ?? NSScreen.main {
                let r = screen.visibleFrame
                motion.contain(in: CGRect(x: r.minX, y: r.minY, width: max(0, r.width-window.frame.width), height: max(0, r.height-window.frame.height)))
                window.setFrameOrigin(motion.position)
            }
        case "dragStart": dragging = true; dragStart = NSEvent.mouseLocation; dragOrigin = window.frame.origin; dragPrevious = dragOrigin; dragVelocity = .zero; window.ignoresMouseEvents = false
        case "dragEnd": dragging = false; motion.release(with: dragVelocity); nextTurn = ProcessInfo.processInfo.systemUptime + 12
        case "menu": let location = NSPoint(x: window.frame.width / 2, y: window.frame.height / 2); menu.popUp(positioning: nil, at: location, in: web)
        default: break
        }
    }
    @objc func listen() {
        if listening { stopListening(deliver: true); return }
        guard !busy else { js("laurenSpeechError", "I’m still working. Give me a moment."); return }
        SFSpeechRecognizer.requestAuthorization { auth in
            guard auth == .authorized else { self.js("laurenSpeechError", "Allow on-device speech in System Settings to talk to me."); return }
            AVCaptureDevice.requestAccess(for: .audio) { allowed in
                DispatchQueue.main.async { if allowed { self.startListening() } else { self.js("laurenSpeechError", "Microphone access is off. You can enable it in System Settings.") } }
            }
        }
    }
    func startListening() {
        guard !listening, let recognizer = recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { js("laurenSpeechError", "On-device English speech isn’t available. The menu has a quiet message option."); return }
        let id = UUID(); speechID = id; recognizedText = ""
        let req = SFSpeechAudioBufferRecognitionRequest(); req.requiresOnDeviceRecognition = true; req.shouldReportPartialResults = true; request = req
        let input = audio.inputNode, format = audio.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { js("laurenSpeechError", "No microphone is available."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }; audio.prepare()
        do { try audio.start(); listening = true; busy = true } catch { input.removeTap(onBus: 0); request = nil; js("laurenSpeechError", error.localizedDescription); return }
        js("laurenSpeechState", "listening")
        recognition = recognizer.recognitionTask(with: req) { result, error in
            DispatchQueue.main.async {
                guard self.speechID == id, self.listening else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    self.recognizedText = text; self.js("laurenTranscript", text)
                    self.silenceTimer?.invalidate()
                    self.silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) { _ in self.stopListening(deliver: true) }
                    if result.isFinal { self.stopListening(deliver: true) }
                } else if error != nil { self.stopListening(deliver: !self.recognizedText.isEmpty) }
            }
        }
        captureTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { _ in self.stopListening(deliver: true) }
    }
    func stopListening(deliver: Bool) {
        let wasListening = listening; let text = recognizedText.trimmingCharacters(in: .whitespacesAndNewlines)
        speechID = UUID(); silenceTimer?.invalidate(); captureTimer?.invalidate(); silenceTimer = nil; captureTimer = nil
        if listening { audio.stop(); audio.inputNode.removeTap(onBus: 0); listening = false; busy = false }
        request?.endAudio(); request = nil; recognition?.cancel(); recognition = nil; recognizedText = ""
        guard wasListening else { return }
        js("laurenSpeechState", "idle")
        if deliver && !text.isEmpty { js("laurenHeard", text) }
        else if deliver { js("laurenSpeechError", "I didn’t catch that. Click me to try again.") }
    }
}
@main
struct LaurenMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = LaurenApp()
        app.delegate = delegate
        app.run()
    }
}
