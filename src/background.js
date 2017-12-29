import _ from "lodash";
import shortid from "shortid";
import ViramateApi from "./background/ViramateApi";
import LiveReload from "./background/LiveReload";
import PortMessaging from "./lib/messaging/PortMessaging";
import io from "socket.io-client";

const log = (message) => {
  console.log("bg>", message);
};

if (process.env.NODE_ENV !== "production") {
  log("Extension running in development mode");
  LiveReload();
}

var pagePort;
var running = false;
const messaging = new PortMessaging();
const viramateApi = new ViramateApi(document.querySelector("#viramate_api"));
const serverUrl = window.serverUrl || "http://localhost:49544/";
const handleRequest = (request, sender, sendResponse, callbacks) => {
  switch (request.action) {
  case "CHECK":
    sendResponse(running);
    break;
  case "START":
    (callbacks.onStart || _.noop)();
    break;
  case "STOP":
    (callbacks.onStop || _.noop)();
    break;
  case "LOADED":
    chrome.pageAction.show(sender.tab.id);
    (callbacks.onLoad || _.noop)();
    break;
  default:
    sendResponse("UNKNOWN", false);
    return;
  }
  sendResponse("OK");
};

const ports = [];
const pendingActions = [];
const broadcast = (action, payload) => {
  const id = shortid.generate();
  _.each(ports, (port) => {
    port.postMessage({
      id, action, payload,
      type: "broadcast"
    });
  });
};

var subscriber;
var startOnConnect = false;
const socket = io(serverUrl);
const startSocket = (doNotEmit) => {
  if (running) {
    throw new Error("Socket already running!");
  }
  running = true;
  broadcast("START");
  if (!socket.connected) {
    startOnConnect = true;
    socket.connect();
  } else {
    if (!doNotEmit) {
      socket.emit("start");
    }
  }
  log("Started socket");
};
const stopSocket = (doNotEmit) => {
  if (!running) {
    throw new Error("Socket not running!");
  }
  running = false;
  broadcast("STOP");
  if (!doNotEmit) {
    socket.emit("stop");
  }
  log("Stopped socket");
};
socket.on("connect", () => {
  if (startOnConnect) {
    socket.emit("start");
    startOnConnect = false;
  }
  log("Socket connected.");
});
// socket.on("disconnect", () => {
//   log("Socket disconnected. Reconnecting in 5 seconds...");
//   setTimeout(() => {
//     socket.connect();
//   }, 5000);
// });
socket.on("start", () => {
  !running ? startAutopilot(true) : _.noop();
});
socket.on("stop", () => {
  running ? stopAutopilot(true) : _.noop();
});
socket.on("action", (message) => {
  subscriber ? subscriber(message) : pendingActions.push(message);
});

const startPort = (port) => {
  ports.push(port);
};
const stopPort = (port) => {
  const portIndex = ports.indexOf(port);
  if (portIndex >= 0) {
    ports.splice(ports.indexOf(port), 1);
  }
};
const setupPort = (port, listeners) => {
  port.onMessage.addListener(listeners.onMessage);
  port.onDisconnect.addListener(listeners.onDisconnect);
};

const startAutopilot = (doNotEmit) => {
  if (running) return;

  subscriber = (message) => {
    const {action, id, payload, timeout} = message;
    const emitSocket = {
      success(payload) {
        socket.emit("action", {id, action, payload, type: "response"});
      },
      fail(payload) {
        socket.emit("action.fail", {id, action, payload, type: "response"});
      }
    };

    if (action == "viramate") {
      viramateApi.sendApiRequest(payload, id).then(emitSocket.success, emitSocket.fail);
    } else {
      messaging.sendRequest(action, payload, timeout).then(emitSocket.success, emitSocket.fail);
    }
  };

  while (pendingActions.length > 0) {
    const message = pendingActions.pop();
    subscriber(message);
  }

  startSocket(doNotEmit);
};

const stopAutopilot = (doNotEmit) => {
  if (!running) return;
  stopSocket(doNotEmit);
};

const setupMessaging = (messaging, port) => {
  messaging.setup(port, setupPort);
  messaging.onRequest = (msg) => {
    handleRequest(msg, port.sender, (response, success) => {
      messaging.sendResponse(msg.id, msg.action, response, success);
    }, {
      onStart: startAutopilot,
      onStop: stopAutopilot,
      onLoad: () => loadAutopilot(port, messaging)
    });
  };
  messaging.onBroadcast = (msg) => {
    socket.emit("broadcast", msg);
  };
  return messaging;
};

const loadAutopilot = (port) => {
  if (pagePort) { 
    messaging.changePort(port, setupPort, (port) => {
      port.disconnect();
      // have to call stopPort again because onDisconnect event isn't emitted
      stopPort(port);
    }, (port, listeners) => {
      port.onMessage.removeListener(listeners.onMessage);
      port.onDisconnect.removeListener(listeners.onDisconnect);
    });
  } else {
    setupMessaging(messaging, port);
  }
  pagePort = port;
};

chrome.runtime.onConnect.addListener((port) => {
  setupMessaging(new PortMessaging(), port);
  port.onDisconnect.addListener(() => {
    stopPort(port);
  });
  startPort(port);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleRequest(request, sender, sendResponse, {
    onStart: startAutopilot,
    onStop: stopAutopilot,
    onLoad: () => {
      throw new Error("Load event can only be triggered from a long-lived connection");
    }
  });
});
