// Agent Continue Content Script
// Keeps the chat tab active and protected against background tab discarding/freezing in Chrome / Edge.

let keepalivePort = null;

function connectKeepalive() {
  if (keepalivePort) return;
  try {
    keepalivePort = chrome.runtime.connect({ name: 'agent-continue-keepalive' });
    keepalivePort.onDisconnect.addListener(() => {
      keepalivePort = null;
      // Reconnect after brief delay
      setTimeout(connectKeepalive, 3000);
    });
  } catch {
    setTimeout(connectKeepalive, 5000);
  }
}

connectKeepalive();
