import AppKit
import WebKit
import AVFoundation
import Speech

final class LaurenApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var server: Process?
    var audio = AVAudioEngine()
    var request: SFSpeechAudioBufferRecognitionRequest?
    var recognition: SFSpeechRecognitionTask?
    var listening = false
    var timeout: Timer?
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    var project: URL { Bundle.main.bundleURL.deletingLastPathComponent() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        let quitItem = NSMenuItem(title:"Quit Lauren",action:#selector(quit),keyEquivalent:"q")
        quitItem.target = self
        applicationMenu.addItem(quitItem)
        applicationItem.submenu = applicationMenu
        mainMenu.addItem(applicationItem)
        NSApp.mainMenu = mainMenu
        let menu = NSMenu()
        menu.addItem(withTitle: "Show Lauren", action: #selector(show), keyEquivalent: "l")
        menu.addItem(withTitle: "Open workspace", action: #selector(workspace), keyEquivalent: "")
        menu.addItem(withTitle: "Keep above other windows", action: #selector(toggleFloat(_:)), keyEquivalent: "")
        menu.items.last?.state = .on
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Lauren", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "✦ Lauren"
        statusItem.menu = menu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "lauren")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 360,height: 540),styleMask: [.titled,.closable,.miniaturizable,.resizable],backing: .buffered,defer: false)
        window.title = "Lauren"
        window.contentView = web
        window.delegate = self
        window.level = .floating
        window.minSize = NSSize(width: 280,height: 350)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("LaurenCompanion")
        if let screen = NSScreen.main { window.setFrameOrigin(NSPoint(x:screen.visibleFrame.maxX-390,y:screen.visibleFrame.minY+35)) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        launchServer()
        awaitServer(attempt: 0)
    }
    func launchServer() {
        try? FileManager.default.createDirectory(at:project.appendingPathComponent("data"),withIntermediateDirectories:true)
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/bash")
        task.arguments = [project.appendingPathComponent("scripts/start.sh").path]
        task.currentDirectoryURL = project
        let logs = project.appendingPathComponent("data/desktop.log")
        FileManager.default.createFile(atPath: logs.path, contents: nil)
        if let handle = try? FileHandle(forWritingTo: logs) { task.standardOutput = handle; task.standardError = handle }
        do { try task.run(); server = task } catch { showError("Could not start Lauren: \(error.localizedDescription)") }
    }
    func awaitServer(attempt: Int) {
        let url = URL(string: "http://127.0.0.1:4327/api/health")!
        URLSession.shared.dataTask(with: url) { data, response, error in
            DispatchQueue.main.async {
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    self.web.load(URLRequest(url: URL(string:"http://127.0.0.1:4327/companion.html")!))
                } else if attempt < 40 {
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { self.awaitServer(attempt:attempt+1) }
                } else { self.showError("The local core did not start. See data/desktop.log in the Lauren project.") }
            }
        }.resume()
    }
    func showError(_ text: String) {
        let alert = NSAlert();alert.messageText = "Lauren needs a moment";alert.informativeText = text;alert.runModal()
    }
    @objc func show() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true) }
    @objc func workspace() { NSWorkspace.shared.open(URL(string:"http://127.0.0.1:4327/tasks.html")!) }
    @objc func toggleFloat(_ item:NSMenuItem) { item.state = item.state == .on ? .off : .on;window.level = item.state == .on ? .floating : .normal }
    @objc func quit() { NSApp.terminate(nil) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil);return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool { false }
    func applicationWillTerminate(_ notification: Notification) { stopListening();if server?.isRunning == true { server?.terminate() } }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        guard let url = action.request.url else { decisionHandler(.cancel);return }
        if url.host == "127.0.0.1" && url.port == 4327 {
            if action.targetFrame == nil || url.path == "/tasks.html" { NSWorkspace.shared.open(url);decisionHandler(.cancel) } else { decisionHandler(.allow) }
        } else { if ["https","http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) };decisionHandler(.cancel) }
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "127.0.0.1", message.body as? String == "listen" else { return }
        if listening { stopListening();return }
        SFSpeechRecognizer.requestAuthorization { auth in
            guard auth == .authorized else { self.js("laurenSpeechError", "Speech permission is required. Text still works.");return }
            AVCaptureDevice.requestAccess(for: .audio) { allowed in
                DispatchQueue.main.async { if allowed { self.startListening() } else { self.js("laurenSpeechError","Microphone permission is required.") } }
            }
        }
    }
    func js(_ function:String,_ text:String) {
        guard let data = try? JSONSerialization.data(withJSONObject:[text]),let args = String(data:data,encoding:.utf8) else{return}
        DispatchQueue.main.async { self.web.evaluateJavaScript("window.\(function)?.(...\(args))",completionHandler:nil) }
    }
    func startListening() {
        guard !listening, let recognizer = recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            js("laurenSpeechError","On-device English speech is unavailable. Text still works; cloud speech stays off.");return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = true
        request = req
        let input = audio.inputNode
        let format = input.outputFormat(forBus:0)
        guard format.sampleRate > 0, format.channelCount > 0 else { js("laurenSpeechError","No microphone is available.");return }
        input.installTap(onBus:0,bufferSize:1024,format:format) { buffer,_ in req.append(buffer) }
        audio.prepare()
        do { try audio.start();listening = true } catch { input.removeTap(onBus:0);request = nil;js("laurenSpeechError",error.localizedDescription);return }
        js("laurenSpeechError","Listening on device · tap Mic to stop")
        recognition = recognizer.recognitionTask(with:req) { result,error in
            if let result = result { self.js("laurenTranscript",result.bestTranscription.formattedString) }
            if error != nil || result?.isFinal == true { DispatchQueue.main.async { self.stopListening() } }
        }
        timeout = Timer.scheduledTimer(withTimeInterval:25,repeats:false) { _ in self.stopListening() }
    }
    func stopListening() {
        timeout?.invalidate();timeout = nil
        if listening { audio.stop();audio.inputNode.removeTap(onBus:0);listening = false }
        request?.endAudio();request = nil;recognition?.cancel();recognition = nil
    }
}
let app = NSApplication.shared
let delegate = LaurenApp()
app.delegate = delegate
app.run()
