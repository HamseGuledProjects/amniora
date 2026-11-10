import AppKit
import Foundation
import WebKit

private let viewerScheme = "amniora-lab"
private let maximumRequestBodyBytes = 65_536
private let maximumResponseBodyBytes = 256 * 1_024
private let maximumBridgeFrameBytes = 384 * 1_024
private let maximumConcurrentRequests = 8

private enum ViewerFailure: Error {
    case configuration
    case requestInvalid
    case bridgeUnavailable
    case responseInvalid
}

private struct ViewerConfiguration {
    let authority: String

    var origin: URL { URL(string: "\(viewerScheme)://\(authority)/")! }

    static func load(_ arguments: [String]) throws -> ViewerConfiguration {
        guard arguments.count == 3, arguments[1] == "--authority",
              arguments[2].range(of: "^[0-9a-f]{32}-g[1-9][0-9]*$", options: .regularExpression) != nil else {
            throw ViewerFailure.configuration
        }
        return ViewerConfiguration(authority: arguments[2])
    }
}

private struct ViewerRequestFrame: Encodable {
    let type = "viewer-request"
    let requestId: String
    let authority: String
    let method: String
    let pathQuery: String
    let headers: [String: String]
    let bodyBase64: String
}

private struct ViewerResponseFrame: Decodable {
    let type: String
    let requestId: String
    let ok: Bool
    let status: Int
    let headers: [String: String]
    let bodyBase64: String
    let errorCode: String?
    let terminal: Bool
}

private protocol ViewerBridgeDelegate: AnyObject {
    func viewerBridgeInvalidated()
}

private final class ViewerBridge {
    weak var delegate: ViewerBridgeDelegate?
    private let input = FileHandle.standardInput
    private let output = FileHandle.standardOutput
    private let state = NSLock()
    private let writer = DispatchQueue(label: "com.amniora.runner.viewer.bridge-writer")
    private var pending: [String: (Result<ViewerResponseFrame, Error>) -> Void] = [:]
    private var closed = false

    func start() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.readLoop() }
    }

    func request(_ frame: ViewerRequestFrame, completion: @escaping (Result<ViewerResponseFrame, Error>) -> Void) {
        state.lock()
        guard !closed, pending[frame.requestId] == nil else {
            state.unlock()
            completion(.failure(ViewerFailure.bridgeUnavailable))
            return
        }
        pending[frame.requestId] = completion
        state.unlock()
        writer.async { [weak self] in
            guard let self else { return }
            do {
                let encoded = try JSONEncoder().encode(frame)
                guard encoded.count <= maximumBridgeFrameBytes else { throw ViewerFailure.requestInvalid }
                try self.output.write(contentsOf: encoded + Data([0x0a]))
            } catch {
                self.finish(frame.requestId, with: .failure(ViewerFailure.bridgeUnavailable))
            }
        }
    }

    private func readLoop() {
        var buffered = Data()
        while true {
            let chunk = input.availableData
            if chunk.isEmpty { break }
            buffered.append(chunk)
            if buffered.count > maximumBridgeFrameBytes * 2 { break }
            while let newline = buffered.firstIndex(of: 0x0a) {
                let line = buffered.prefix(upTo: newline)
                buffered.removeSubrange(...newline)
                if line.count > maximumBridgeFrameBytes { close(); return }
                receive(Data(line))
            }
        }
        close()
    }

    private func receive(_ data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { close(); return }
        if type == "viewer-control" {
            guard Set(object.keys) == Set(["type", "action", "reason"]), object["action"] as? String == "invalidate" else {
                close(); return
            }
            DispatchQueue.main.async { [weak self] in self?.delegate?.viewerBridgeInvalidated() }
            return
        }
        guard type == "viewer-response", let frame = try? JSONDecoder().decode(ViewerResponseFrame.self, from: data),
              frame.type == "viewer-response", frame.status >= 100, frame.status <= 599,
              frame.requestId.range(of: "^vrq_[A-Za-z0-9_-]{16,64}$", options: .regularExpression) != nil else {
            close(); return
        }
        finish(frame.requestId, with: .success(frame))
        if frame.terminal {
            DispatchQueue.main.async { [weak self] in self?.delegate?.viewerBridgeInvalidated() }
        }
    }

    private func finish(_ requestId: String, with result: Result<ViewerResponseFrame, Error>) {
        state.lock()
        let callback = pending.removeValue(forKey: requestId)
        state.unlock()
        callback?(result)
    }

    private func close() {
        state.lock()
        guard !closed else { state.unlock(); return }
        closed = true
        let callbacks = Array(pending.values)
        pending.removeAll()
        state.unlock()
        callbacks.forEach { $0(.failure(ViewerFailure.bridgeUnavailable)) }
        DispatchQueue.main.async { [weak self] in self?.delegate?.viewerBridgeInvalidated() }
    }
}

private func requestBody(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody {
        guard body.count <= maximumRequestBodyBytes else { throw ViewerFailure.requestInvalid }
        return body
    }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 8_192)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count < 0 { throw ViewerFailure.requestInvalid }
        if count == 0 { break }
        result.append(buffer, count: count)
        if result.count > maximumRequestBodyBytes { throw ViewerFailure.requestInvalid }
    }
    return result
}

private final class LabSchemeHandler: NSObject, WKURLSchemeHandler {
    private let configuration: ViewerConfiguration
    private let bridge: ViewerBridge
    private let lock = NSLock()
    private var active = 0

    init(configuration: ViewerConfiguration, bridge: ViewerBridge) {
        self.configuration = configuration
        self.bridge = bridge
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        lock.lock()
        guard active < maximumConcurrentRequests else {
            lock.unlock()
            fail(urlSchemeTask, status: 429, code: "VIEWER_CONCURRENCY_LIMIT")
            return
        }
        active += 1
        lock.unlock()
        do {
            let request = urlSchemeTask.request
            guard let url = request.url, url.scheme == viewerScheme, url.host == configuration.authority,
                  url.user == nil, url.password == nil, url.port == nil else { throw ViewerFailure.requestInvalid }
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            guard let components, components.scheme == viewerScheme, components.host == configuration.authority,
                  components.fragment == nil else { throw ViewerFailure.requestInvalid }
            let path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
            let pathQuery = components.percentEncodedQuery.map { "\(path)?\($0)" } ?? path
            guard pathQuery.utf8.count <= 8_192, pathQuery.first == "/", !pathQuery.hasPrefix("//"),
                  !pathQuery.contains("\\"), pathQuery.unicodeScalars.allSatisfy({ $0.value >= 0x21 && $0.value <= 0x7e }) else {
                throw ViewerFailure.requestInvalid
            }
            let method = (request.httpMethod ?? "GET").uppercased()
            guard ["GET", "HEAD", "POST", "PUT"].contains(method) else { throw ViewerFailure.requestInvalid }
            let body = try requestBody(request)
            if (method == "GET" || method == "HEAD") && !body.isEmpty { throw ViewerFailure.requestInvalid }
            var headers: [String: String] = [:]
            let allowed = Set(["accept", "accept-language", "cookie", "content-type", "content-length",
                               "x-web-lab-field", "x-web-lab-route"])
            for (name, value) in request.allHTTPHeaderFields ?? [:] where allowed.contains(name.lowercased()) {
                headers[name.lowercased()] = value
            }
            let requestId = "vrq_" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
            let frame = ViewerRequestFrame(requestId: requestId, authority: configuration.authority,
                                           method: method, pathQuery: pathQuery, headers: headers,
                                           bodyBase64: body.base64EncodedString())
            bridge.request(frame) { [weak self, weak urlSchemeTask] result in
                DispatchQueue.main.async {
                    guard let self, let task = urlSchemeTask else { return }
                    defer { self.completed() }
                    switch result {
                    case .success(let response): self.complete(task, requestURL: url, response: response)
                    case .failure: self.fail(task, status: 502, code: "VIEWER_BRIDGE_UNAVAILABLE")
                    }
                }
            }
        } catch {
            completed()
            fail(urlSchemeTask, status: 400, code: "VIEWER_REQUEST_INVALID")
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // The bounded relay may already be in flight. Its eventual response is discarded by WebKit.
    }

    private func completed() {
        lock.lock(); active = max(0, active - 1); lock.unlock()
    }

    private func complete(_ task: WKURLSchemeTask, requestURL: URL, response: ViewerResponseFrame) {
        var headers = response.headers
        headers["content-security-policy"] = "default-src 'none'; script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; " +
            "frame-src 'none'; worker-src 'none'; object-src 'none'; media-src 'none'; font-src 'none'; " +
            "base-uri 'none'; sandbox allow-scripts allow-forms allow-same-origin"
        guard let body = Data(base64Encoded: response.bodyBase64), body.count <= maximumResponseBodyBytes,
              let http = HTTPURLResponse(url: requestURL, statusCode: response.status,
                                         httpVersion: "HTTP/1.1", headerFields: headers) else {
            fail(task, status: 502, code: "VIEWER_RESPONSE_INVALID")
            return
        }
        task.didReceive(http)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }

    private func fail(_ task: WKURLSchemeTask, status: Int, code: String) {
        let body = Data(code.utf8)
        let response = HTTPURLResponse(url: task.request.url ?? configuration.origin, statusCode: status,
                                       httpVersion: "HTTP/1.1",
                                       headerFields: ["Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8"])
        if let response { task.didReceive(response); task.didReceive(body); task.didFinish() }
        else { task.didFailWithError(ViewerFailure.responseInvalid) }
    }
}

private final class LockedDownWebView: WKWebView {
    override func menu(for event: NSEvent) -> NSMenu? { nil }
}

private final class ViewerDelegate: NSObject, WKNavigationDelegate, WKUIDelegate, ViewerBridgeDelegate {
    private let configuration: ViewerConfiguration
    private let onInvalidated: () -> Void
    private var recentNavigations: [Date] = []

    init(configuration: ViewerConfiguration, onInvalidated: @escaping () -> Void) {
        self.configuration = configuration
        self.onInvalidated = onInvalidated
    }

    private func allowed(_ url: URL?) -> Bool {
        guard let url, url.scheme == viewerScheme, url.host == configuration.authority,
              url.user == nil, url.password == nil, url.port == nil else { return false }
        return true
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let now = Date()
        recentNavigations.removeAll { now.timeIntervalSince($0) > 5 }
        guard navigationAction.targetFrame != nil, !navigationAction.shouldPerformDownload,
              allowed(navigationAction.request.url), recentNavigations.count < 32 else {
            decisionHandler(.cancel); return
        }
        recentNavigations.append(now)
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(allowed(navigationResponse.response.url) && navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        completionHandler(nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }

    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }

    func viewerBridgeInvalidated() { onInvalidated() }
}

private final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private let configuration: ViewerConfiguration
    private let bridge = ViewerBridge()
    private var window: NSWindow?
    private var webView: WKWebView?
    private var viewerDelegate: ViewerDelegate?

    init(configuration: ViewerConfiguration) { self.configuration = configuration }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .nonPersistent()
        webConfiguration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = .all
        webConfiguration.setURLSchemeHandler(LabSchemeHandler(configuration: configuration, bridge: bridge),
                                             forURLScheme: viewerScheme)
        let capabilityGuard = #"""
        (() => {
          'use strict';
          const lock = (target, name, value) => {
            try { Object.defineProperty(target, name, { value, writable: false, configurable: false }); } catch {}
          };
          for (const name of ['WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection',
                              'Worker', 'SharedWorker', 'Notification', 'showOpenFilePicker',
                              'showSaveFilePicker', 'showDirectoryPicker']) lock(globalThis, name, undefined);
          for (const name of ['clipboard', 'mediaDevices', 'geolocation', 'bluetooth', 'usb', 'serial',
                              'serviceWorker', 'credentials']) lock(Navigator.prototype, name, undefined);
          lock(Navigator.prototype, 'sendBeacon', () => false);
          lock(Navigator.prototype, 'registerProtocolHandler', () => { throw new DOMException('Denied', 'SecurityError'); });
          lock(globalThis, 'open', () => null);
          lock(globalThis, 'print', () => undefined);
          const originalExecCommand = Document.prototype.execCommand;
          lock(Document.prototype, 'execCommand', function(command, ...rest) {
            if (String(command).toLowerCase() === 'copy' || String(command).toLowerCase() === 'cut') return false;
            return originalExecCommand.call(this, command, ...rest);
          });
        })();
        """#
        webConfiguration.userContentController.addUserScript(WKUserScript(
            source: capabilityGuard, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page
        ))

        let rules = #"""
        [
          {"trigger":{"url-filter":"^https?:"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^wss?:"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^file:"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^ftp:"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^data:"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^blob:"},"action":{"type":"block"}}
        ]
        """#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "amniora-phase4-deny-network", encodedContentRuleList: rules) {
            [weak self] list, error in
            DispatchQueue.main.async {
                guard let self, error == nil, let list else { self?.terminate(); return }
                webConfiguration.userContentController.add(list)
                self.open(webConfiguration)
            }
        }
    }

    private func open(_ webConfiguration: WKWebViewConfiguration) {
        let frame = NSRect(x: 0, y: 0, width: 1180, height: 820)
        let view = LockedDownWebView(frame: frame, configuration: webConfiguration)
        view.allowsMagnification = false
        if #available(macOS 13.3, *) { view.isInspectable = false }
        view.unregisterDraggedTypes()
        let delegate = ViewerDelegate(configuration: configuration) { [weak self] in self?.terminate() }
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Amniora Isolated Lab"
        window.sharingType = .none
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
        self.webView = view
        self.viewerDelegate = delegate
        bridge.delegate = delegate
        bridge.start()
        view.load(URLRequest(url: configuration.origin, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                             timeoutInterval: 10))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    private func terminate() {
        guard let webView else { NSApp.terminate(nil); return }
        webView.stopLoading()
        webView.configuration.websiteDataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
                                                           modifiedSince: .distantPast) { NSApp.terminate(nil) }
    }
}

do {
    let configuration = try ViewerConfiguration.load(CommandLine.arguments)
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    let delegate = ApplicationDelegate(configuration: configuration)
    application.delegate = delegate
    application.run()
} catch {
    FileHandle.standardError.write(Data("VIEWER_START_FAILED\n".utf8))
    exit(1)
}
