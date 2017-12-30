import {actions} from "./contentscript/actions";
import external from "./contentscript/external";
import PortMessaging from "./lib/messaging/PortMessaging";
import shortid from "shortid";

const token = shortid.generate();
const hashSubscribers = new Set();
const channel = new MessageChannel();
const port = new PortMessaging();
port.middleware("receive", (evt, next, fail) => {
  const message = evt.data;
  if (message.token !== token) {
    fail(new Error("Invalid token!"));
  } else {
    next(message);
  }
});
port.middleware("send", (message, next) => {
  message.token = token;
  next(message);
});
port.setup(channel.port1, (port, listeners) => {
  port.onmessage = listeners.onMessage;
});

const requestExternal = ::port.sendRequest;
const handleRequest = (request, sendResponse) => {
  var rejected = false;
  var callHandler;
  const {id, action, payload, timeout} = request;
  const handler = actions[action];
  const done = (payload) => {
    sendResponse({id, type: "response", action, payload, success: true});
  };
  const fail = (payload) => {
    payload = payload instanceof Error ? payload.message : payload;
    sendResponse({id, type: "response", action, payload, success: false});
  };
  const retry = (callback, timeout) => {
    if (!isNaN(callback)) {
      timeout = callback;
      callback = null;
    }
    if (!rejected) {
      setTimeout(callback || callHandler, timeout || 1000 / 125);
    } else {
      fail("Rejected!");
    }
  };

  callHandler = () => {
    if (handler) {
      return handler.call({
        actions, requestExternal, hashSubscribers
      }, payload, done, fail, retry);
    } else {
      return new Error("Action '" + action + "' not found!");
    }
  };

  var result = callHandler();

  if (result instanceof Error) {
    fail(actions.error(action));
  } else if (result !== undefined) {
    done(result);
  }
};

const injectScript = (constructor, callback) => {
  const parent = (document.head || document.documentElement);
  const js = "(" + constructor.toString() + ")(this, " + JSON.stringify(token) + ")";
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.innerHTML = js;
  parent.appendChild(script);
  callback(token);

  if (process.env.NODE_ENV === "production") {
    window.setTimeout(() => {
      parent.removeChild(script);
    }, 1);
  }
};

const extensionPort = new PortMessaging();
extensionPort.setup(chrome.runtime.connect(), (port, listeners) => {
  port.onMessage.addListener(listeners.onMessage);
  port.onDisconnect.addListener(listeners.onDisconnect);
});
const requestExtension = ::extensionPort.sendRequest;
extensionPort.onRequest = (request) => {
  handleRequest(request, (response) => {
    extensionPort.sendMessage(response);
  });
};
port.onBroadcast = ({action, payload}) => {
  extensionPort.sendBroadcast(shortid.generate(), action, payload);
};

injectScript(external, (token) => {
  window.postMessage({token}, "*", [channel.port2]);
});

const portSetup = () => {
  requestExtension("LOADED").then(() => {
    console.log("Connected to extension");
  }, ::console.error);
  window.removeEventListener("load", portSetup);
};

window.addEventListener("load", portSetup);
window.addEventListener("hashchange", (evt) => {
  extensionPort.sendBroadcast(shortid.generate(), "hashchange", {
    oldUrl: evt.oldURL,
    newUrl: evt.newURL
  });
});
