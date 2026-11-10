// The local demo can talk to its own loopback server, never to an external service.
const net = require('node:net');
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function deny() { const error = new Error('External networking is disabled in the local portfolio demo.'); error.code = 'PORTFOLIO_NETWORK_DISABLED'; throw error; }
function localHost(host) { if (host && !allowed.has(String(host).toLowerCase())) deny(); }
function localPipe(value) {
  const socketPath = String(value);
  if (process.platform === 'win32' ? !socketPath.startsWith('\\\\.\\pipe\\') : !socketPath.startsWith('/') || socketPath.startsWith('//')) deny();
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const parameters = Array.isArray(args[0]) ? args[0] : args;
  const options = parameters[0];
  if (options && typeof options === 'object') {
    if (options.lookup) deny();
    if (options.path) {
      localPipe(options.path);
    } else localHost(options.host || options.hostname);
  } else if (typeof options === 'number' || (typeof options === 'string' && /^\d+$/.test(options))) {
    if (typeof parameters[1] === 'string') localHost(parameters[1]);
  } else if (typeof options === 'string') {
    localPipe(options);
  }
  return connect.apply(this, args);
};
if (globalThis.fetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    localHost(url.hostname);
    return originalFetch(input, init);
  };
}
