import AppKit
import Foundation

private enum RunnerShellError: Error { case configuration, helper }

private struct Configuration {
    let serverOrigin: URL
    static func load() throws -> Configuration {
        let defaults = UserDefaults.standard
        let arguments = CommandLine.arguments
        var supplied: String?
        if let index = arguments.firstIndex(of: "--server-origin"), index + 1 < arguments.count {
            supplied = arguments[index + 1]
        }
        let embedded = Bundle.main.object(forInfoDictionaryKey: "AmnioraServerOrigin") as? String
        guard let text = supplied ?? embedded ?? defaults.string(forKey: "product.serverOrigin"),
              let url = URL(string: text), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty,
              (url.scheme == "https" && url.host == "portfolio.example.test" && url.port == nil) ||
              (url.scheme == "http" && ["127.0.0.1", "localhost"].contains(url.host ?? ""))
        else { throw RunnerShellError.configuration }
        if let supplied { defaults.set(supplied, forKey: "product.serverOrigin") }
        return Configuration(serverOrigin: url)
    }
}

@MainActor
private final class RunnerWindowController: NSWindowController {
    private struct HelperRequest {
        let action: String
        let value: String?
        let completion: (Result<Data, Error>) -> Void
    }
    private let configuration: Configuration
    private let account = NSTextField(labelWithString: "Not connected")
    private let presence = NSTextField(labelWithString: "Offline")
    private let vm = NSTextField(labelWithString: "Checking…")
    private let guest = NSTextField(labelWithString: "Checking…")
    private let docker = NSTextField(labelWithString: "Checking…")
    private let lab = NSTextField(labelWithString: "Stopped")
    private let guidance = NSTextField(wrappingLabelWithString: "")
    private let notice = NSTextField(wrappingLabelWithString: "")
    private let activity = NSTextField(wrappingLabelWithString: "No recent activity")
    private var activityLines: [String] = []
    private var presenceTimer: Timer?
    private var statusTimer: Timer?
    private var working = false
    private var helperQueue: [HelperRequest] = []
    private var activeURLs: Set<String> = []
    private var isConnected = false
    private var presenceOnline = false
    private var diagnosticsInFlight = false
    private var diagnosticsRevision = 0
    private let healthy = NSColor(calibratedRed: 0.28, green: 0.83, blue: 0.58, alpha: 1)
    private let warning = NSColor(calibratedRed: 0.98, green: 0.72, blue: 0.30, alpha: 1)
    private let unavailable = NSColor(calibratedRed: 0.98, green: 0.43, blue: 0.45, alpha: 1)
    private let inactive = NSColor(calibratedRed: 0.55, green: 0.63, blue: 0.71, alpha: 1)

    init(configuration: Configuration) {
        self.configuration = configuration
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Amniora Runner"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        buildInterface()
        refresh()
        presenceTimer = Timer.scheduledTimer(withTimeInterval: 12, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.sendPresence() }
        }
        // A recovered Guest Agent must clear a stale UNAVAILABLE display without a manual Diagnostics click.
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isConnected else { return }
                self.refresh()
            }
        }
    }
    required init?(coder: NSCoder) { nil }

    private func label(_ title: String, _ value: NSTextField) -> NSView {
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 12, weight: .medium)
        heading.textColor = NSColor(calibratedRed: 0.57, green: 0.74, blue: 0.82, alpha: 1)
        value.font = .systemFont(ofSize: 14, weight: .semibold)
        value.textColor = .white
        let stack = NSStackView(views: [heading, value]); stack.orientation = .vertical; stack.alignment = .leading
        stack.spacing = 3
        return stack
    }

    private func button(_ title: String, action: Selector) -> NSButton {
        let value = NSButton(title: title, target: self, action: action)
        value.isBordered = false
        value.font = .systemFont(ofSize: 12, weight: .semibold)
        value.contentTintColor = .white
        value.wantsLayer = true
        value.layer?.cornerRadius = 6
        value.layer?.backgroundColor = NSColor(calibratedRed: 0.07, green: 0.20, blue: 0.30, alpha: 1).cgColor
        value.heightAnchor.constraint(equalToConstant: 32).isActive = true
        return value
    }

    private func status(_ field: NSTextField, _ text: String, tone: NSColor) {
        let line = NSMutableAttributedString(string: "●  \(text)", attributes: [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: NSColor.white
        ])
        line.addAttribute(.foregroundColor, value: tone, range: NSRange(location: 0, length: 1))
        field.attributedStringValue = line
    }

    private func section(_ text: String) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .monospacedSystemFont(ofSize: 11, weight: .semibold)
        field.textColor = NSColor(calibratedRed: 0.57, green: 0.74, blue: 0.82, alpha: 1)
        return field
    }

    private func buildInterface() {
        guard let content = window?.contentView else { return }
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(calibratedRed: 0.018, green: 0.055, blue: 0.10, alpha: 1).cgColor
        let title = NSTextField(labelWithString: "Amniora Runner")
        title.font = .systemFont(ofSize: 25, weight: .bold)
        title.textColor = .white
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "owner test"
        let subtitle = NSTextField(labelWithString: "LOCAL EXECUTION AGENT  ·  v\(version)  ·  OWNER TEST")
        subtitle.textColor = NSColor(calibratedRed: 0.68, green: 0.77, blue: 0.84, alpha: 1)
        subtitle.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
        let accountSection = label("Account", account)
        let presenceSection = label("Amniora connection", presence)
        let vmSection = label("Virtual machine", vm)
        let guestSection = label("Guest agent", guest)
        let dockerSection = label("Docker", docker)
        let labSection = label("Current lab", lab)
        guidance.textColor = NSColor(calibratedRed: 0.80, green: 0.86, blue: 0.90, alpha: 1)
        guidance.maximumNumberOfLines = 2
        guidance.font = .systemFont(ofSize: 12)
        notice.textColor = NSColor(calibratedRed: 0.72, green: 0.83, blue: 0.89, alpha: 1)
        notice.maximumNumberOfLines = 3
        activity.textColor = NSColor(calibratedRed: 0.72, green: 0.83, blue: 0.89, alpha: 1)
        activity.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        activity.maximumNumberOfLines = 5
        let first = NSStackView(views: [button("Connect to Amniora", action: #selector(connect)),
                                        button("Open Amniora", action: #selector(openAmniora))])
        first.orientation = .horizontal; first.spacing = 8
        let second = NSStackView(views: [button("Diagnostics", action: #selector(diagnostics)),
                                         button("Settings", action: #selector(settings)),
                                         button("Unpair", action: #selector(unpair)),
                                         button("Quit", action: #selector(quit))])
        second.orientation = .horizontal; second.spacing = 8
        let stack = NSStackView(views: [title, subtitle, separator(), section("LOCAL EXECUTION STATUS"),
                                        accountSection, presenceSection, vmSection, guestSection, dockerSection,
                                        separator(), section("CURRENT RUNTIME"), labSection, guidance,
                                        separator(), section("ACTIVITY"), activity, notice, first, second])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 11
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 25),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24)])
    }

    private func separator() -> NSBox { let box = NSBox(); box.boxType = .separator; return box }
    private func recordActivity(_ safeMessage: String) {
        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short)
        activityLines.append("\(time)  \(safeMessage)")
        activityLines = Array(activityLines.suffix(5))
        activity.stringValue = activityLines.joined(separator: "\n")
    }
    private func helper(_ action: String, value: String? = nil, coalesce: Bool = true,
                        completion: @escaping (Result<Data, Error>) -> Void) {
        if coalesce && ["presence", "summary"].contains(action) && helperQueue.contains(where: { $0.action == action }) { return }
        helperQueue.append(HelperRequest(action: action, value: value, completion: completion))
        runNextHelper()
    }

    private func runNextHelper() {
        guard !working, !helperQueue.isEmpty else { return }
        let request = helperQueue.removeFirst()
        guard let resources = Bundle.main.resourceURL else {
            request.completion(.failure(RunnerShellError.helper)); runNextHelper(); return
        }
        working = true
        if !["presence", "summary"].contains(request.action) { notice.stringValue = "Working…" }
        let process = Process()
        process.executableURL = resources.appendingPathComponent("bin/node")
        var arguments = [resources.appendingPathComponent("bin/amniora-product-client.cjs").path,
                         request.action, configuration.serverOrigin.absoluteString]
        if let value = request.value { arguments.append(value) }
        process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin", "NODE_ENV": "production", "LANG": "en_US.UTF-8"]
        let output = Pipe(); let errors = Pipe()
        process.standardOutput = output; process.standardError = errors
        process.terminationHandler = { [weak self] process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let errorData = errors.fileHandleForReading.readDataToEndOfFile()
            let errorCode = String(data: errorData, encoding: .utf8)?.split(separator: "\n").first.map(String.init) ?? "RUNNER_FAILED"
            if process.terminationStatus != 0 {
                let safeCode = errorCode.range(of: "^[A-Z][A-Z0-9_]{2,63}$", options: .regularExpression) == nil ? "RUNNER_FAILED" : errorCode
                NSLog("Amniora Runner helper failed: %@", safeCode)
            }
            DispatchQueue.main.async {
                self?.working = false
                request.completion(process.terminationStatus == 0 ? .success(data) : .failure(RunnerShellError.helper))
                self?.runNextHelper()
            }
        }
        do { try process.run() } catch {
            working = false; request.completion(.failure(error)); runNextHelper()
        }
    }

    func handle(url: URL) {
        let raw = url.absoluteString
        guard activeURLs.insert(raw).inserted else {
            notice.stringValue = "That Runner request is already being processed."; return
        }
        let isConnect = url.scheme == "com.amniora.runner" && url.host == nil && url.path == "/connect" &&
            url.query == nil && url.fragment == nil && url.user == nil && url.password == nil
        let action = isConnect ? "pair" : url.path == "/pair" ? "pair-callback" : url.path == "/activate" ? "activate" : ""
        guard !action.isEmpty else {
            activeURLs.remove(raw); notice.stringValue = "That Runner link is not valid."; return
        }
        helper(action, value: isConnect ? nil : raw) { [weak self] result in
            self?.activeURLs.remove(raw)
            self?.notice.stringValue = result.isSuccess ? (action == "pair" ? "Approve the request in your browser." : action == "pair-callback" ? "Connected to Amniora ✓" : "Command completed.") : "The Runner request could not be completed safely."
            self?.recordActivity(result.isSuccess ? (action == "pair" ? "Connection request opened" : action == "pair-callback" ? "Runner connected" : "Website command completed") : "Runner request failed")
            if action == "pair-callback" && result.isSuccess { self?.sendPresence() }
            if action != "pair" { self?.refresh() }
        }
    }

    private func finishDiagnostics(_ message: String, revision: Int) {
        guard diagnosticsRevision == revision else { return }
        diagnosticsInFlight = false
        guard notice.stringValue == "Checking diagnostics…" else { return }
        notice.stringValue = message
        Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.diagnosticsRevision == revision, self.notice.stringValue == message else { return }
                self.notice.stringValue = ""
            }
        }
    }

    private func refresh(diagnosticsFeedback: Bool = false) {
        let feedbackRevision = diagnosticsFeedback ? diagnosticsRevision : nil
        helper("summary", coalesce: !diagnosticsFeedback) { [weak self] result in
            guard let self else { return }
            guard case .success(let data) = result,
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                if let feedbackRevision { finishDiagnostics("Diagnostics unavailable.", revision: feedbackRevision) }
                else { notice.stringValue = "Safe diagnostics are unavailable." }
                return
            }
            let connected = value["connected"] as? Bool == true
            isConnected = connected
            status(account, connected ? "CONNECTED" : "NOT CONNECTED", tone: connected ? healthy : inactive)
            if !connected { presenceOnline = false; status(presence, "OFFLINE", tone: unavailable) }
            let vmText = value["vm"] as? String ?? "Unknown"
            let guestText = value["guest"] as? String ?? "Unknown"
            let dockerText = value["docker"] as? String ?? "Unknown"
            let labText = value["lab"] as? String ?? "Stopped"
            status(vm, vmText, tone: vmText == "Unavailable" ? unavailable : vmText == "Unknown" ? inactive : healthy)
            status(guest, guestText.uppercased(), tone: guestText == "Ready" ? healthy : guestText == "Unknown" ? inactive : unavailable)
            status(docker, dockerText, tone: dockerText.contains("Ready") ? healthy : dockerText == "Unknown" ? inactive : unavailable)
            status(lab, labText.uppercased(), tone: labText.hasPrefix("Running") ? healthy : labText == "Stopped" ? inactive : warning)
            guidance.stringValue = !connected ? "Connect this Runner to your Amniora account." :
                vmText == "Unavailable" ? "Start your supported Ubuntu virtual machine." :
                guestText != "Ready" ? "Amniora Guest Agent could not be reached." :
                !dockerText.contains("Ready") ? "Start Docker inside your virtual machine." :
                "Use portfolio.example.test to launch, open, reset, or stop a lab."
            if let feedbackRevision { finishDiagnostics("Diagnostics refreshed.", revision: feedbackRevision) }
        }
    }

    private func sendPresence() {
        guard isConnected else { presenceOnline = false; status(presence, "OFFLINE", tone: unavailable); return }
        helper("presence") { [weak self] result in
            guard let self else { return }
            let wasOnline = self.presenceOnline
            self.presenceOnline = result.isSuccess
            self.status(self.presence, result.isSuccess ? "ONLINE" : "OFFLINE · CHECK CONNECTION",
                        tone: result.isSuccess ? self.healthy : self.unavailable)
            if result.isSuccess && !wasOnline { self.recordActivity("Amniora connection restored") }
            if !result.isSuccess && wasOnline { self.recordActivity("Amniora connection lost") }
        }
    }

    @objc private func connect() { helper("pair") { [weak self] result in self?.notice.stringValue = result.isSuccess ? "Approve the request in your browser." : "Could not start pairing." } }
    @objc private func openAmniora() { NSWorkspace.shared.open(configuration.serverOrigin); notice.stringValue = "Opened Amniora." }
    @objc private func diagnostics() {
        guard !diagnosticsInFlight else { return }
        diagnosticsInFlight = true
        diagnosticsRevision += 1
        notice.stringValue = "Checking diagnostics…"
        refresh(diagnosticsFeedback: true)
    }
    @objc private func settings() {
        let panel = NSAlert()
        panel.messageText = "Amniora Runner settings"
        panel.informativeText = "Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "owner test"). Lab controls live on portfolio.example.test. This Runner uses only the configured Amniora service and your local supported VM."
        panel.addButton(withTitle: "Done")
        panel.beginSheetModal(for: window!)
    }
    @objc private func unpair() { helper("unpair") { [weak self] result in
        self?.notice.stringValue = result.isSuccess ? "Runner unpaired. Future commands will be rejected." : "Stop the active lab on Amniora before unpairing, or check the connection."
        self?.recordActivity(result.isSuccess ? "Runner unpaired" : "Unpair blocked")
        if result.isSuccess { self?.presence.stringValue = "Offline" }
        self?.refresh()
    } }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
}

private extension Result {
    var isSuccess: Bool { if case .success = self { return true }; return false }
}

@MainActor
private final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private var controller: RunnerWindowController?
    private var pending: [URL] = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            controller = RunnerWindowController(configuration: try Configuration.load())
            controller?.showWindow(nil); NSApplication.shared.activate(ignoringOtherApps: true)
            pending.forEach { controller?.handle(url: $0) }; pending.removeAll()
        } catch { NSApplication.shared.terminate(nil) }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let controller else { pending.append(contentsOf: urls); return }
        controller.showWindow(nil); NSApplication.shared.activate(ignoringOtherApps: true)
        urls.forEach { controller.handle(url: $0) }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller?.showWindow(nil); NSApplication.shared.activate(ignoringOtherApps: true); return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
private struct AmnioraRunnerApplication {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = ApplicationDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
