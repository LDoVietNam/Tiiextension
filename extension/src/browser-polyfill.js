export const isFirefox = typeof browser !== 'undefined' && !chrome.runtime?.id?.includes('.');
export const isChrome = !isFirefox;

const api = isFirefox ? browser : chrome;

export const runtime = api.runtime;
export const storage = api.storage;
export const tabs = api.tabs;
export const scripting = api.scripting;
export const sidePanel = api.sidePanel;
export const action = api.action;
export const commands = api.commands;
export const nativeMessaging = api.runtime;
export const cookies = api.cookies;
export const downloads = api.downloads;
export const debuggerApi = api.debugger;
export const windows = api.windows;

export function sendMessage(message, options) {
  return api.runtime.sendMessage(message, options);
}

export function onMessage(listener) {
  return api.runtime.onMessage.addListener(listener);
}

export function removeMessageListener(listener) {
  return api.runtime.onMessage.removeListener(listener);
}

export function connect(portName) {
  return api.runtime.connect({ name: portName });
}

export function connectNative(hostName) {
  return api.runtime.connectNative(hostName);
}

export function getManifest() {
  return api.runtime.getManifest();
}

export function getURL(path) {
  return api.runtime.getURL(path);
}

export function onInstalled(listener) {
  return api.runtime.onInstalled.addListener(listener);
}

export function onStartup(listener) {
  return api.runtime.onStartup.addListener(listener);
}

export function setIcon(details) {
  return api.action?.setIcon?.(details) ?? api.browserAction?.setIcon?.(details);
}

export function setTitle(details) {
  return api.action?.setTitle?.(details) ?? api.browserAction?.setTitle?.(details);
}

export function setPopup(details) {
  return api.action?.setPopup?.(details) ?? api.browserAction?.setPopup?.(details);
}

export function openOptionsPage() {
  return api.runtime.openOptionsPage?.() ?? Promise.resolve();
}

export const localStorage = {
  get(keys) {
    return new Promise((resolve) => {
      api.storage.local.get(keys, resolve);
    });
  },
  set(items) {
    return new Promise((resolve) => {
      api.storage.local.set(items, resolve);
    });
  },
  remove(keys) {
    return new Promise((resolve) => {
      api.storage.local.remove(keys, resolve);
    });
  },
  clear() {
    return new Promise((resolve) => {
      api.storage.local.clear(resolve);
    });
  },
  onChanged: api.storage.onChanged,
};

export const sessionStorage = {
  get(keys) {
    return new Promise((resolve) => {
      api.storage.session?.get?.(keys, resolve) ?? api.storage.local.get(keys, resolve);
    });
  },
  set(items) {
    return new Promise((resolve) => {
      api.storage.session?.set?.(items, resolve) ?? api.storage.local.set(items, resolve);
    });
  },
  remove(keys) {
    return new Promise((resolve) => {
      api.storage.session?.remove?.(keys, resolve) ?? api.storage.local.remove(keys, resolve);
    });
  },
};

export function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    api.tabs.query(queryInfo, resolve);
  });
}

export function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    api.tabs.sendMessage(tabId, message, (response) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

export function executeScript(tabId, details) {
  return new Promise((resolve, reject) => {
    if (api.scripting?.executeScript) {
      api.scripting.executeScript({ target: { tabId }, ...details })
        .then(resolve)
        .catch(reject);
    } else {
      api.tabs.executeScript(tabId, details, (result) => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    }
  });
}

export function insertCSS(tabId, details) {
  return new Promise((resolve, reject) => {
    if (api.scripting?.insertCSS) {
      api.scripting.insertCSS({ target: { tabId }, ...details })
        .then(resolve)
        .catch(reject);
    } else {
      api.tabs.insertCSS(tabId, details, () => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    }
  });
}

export function removeCSS(tabId, details) {
  return new Promise((resolve, reject) => {
    if (api.scripting?.removeCSS) {
      api.scripting.removeCSS({ target: { tabId }, ...details })
        .then(resolve)
        .catch(reject);
    } else {
      api.tabs.removeCSS(tabId, details, () => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    }
  });
}

export function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    api.tabs.create(createProperties, (tab) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

export function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    api.tabs.update(tabId, updateProperties, (tab) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

export function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    api.tabs.remove(tabId, () => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

export function getTab(tabId) {
  return new Promise((resolve, reject) => {
    api.tabs.get(tabId, (tab) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

export function getCurrentTab() {
  return new Promise((resolve, reject) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(tabs[0] || null);
      }
    });
  });
}

export function onTabUpdated(listener) {
  return api.tabs.onUpdated.addListener(listener);
}

export function onTabRemoved(listener) {
  return api.tabs.onRemoved.addListener(listener);
}

export function onTabActivated(listener) {
  return api.tabs.onActivated.addListener(listener);
}

export function openSidePanel(tabId) {
  if (api.sidePanel?.open) {
    return api.sidePanel.open({ tabId });
  }
  return Promise.reject(new Error('sidePanel API not available'));
}

export function setSidePanelOptions(options) {
  if (api.sidePanel?.setOptions) {
    return api.sidePanel.setOptions(options);
  }
  return Promise.resolve();
}

export function getSidePanelOptions(tabId) {
  if (api.sidePanel?.getOptions) {
    return api.sidePanel.getOptions({ tabId });
  }
  return Promise.resolve({});
}

export function onCommand(listener) {
  return api.commands?.onCommand?.addListener(listener);
}

export function getAllCommands() {
  return new Promise((resolve) => {
    api.commands?.getAll?.(resolve) ?? resolve([]);
  });
}

export function getCookie(details) {
  return new Promise((resolve, reject) => {
    api.cookies.get(details, (cookie) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(cookie);
      }
    });
  });
}

export function setCookie(details) {
  return new Promise((resolve, reject) => {
    api.cookies.set(details, (cookie) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(cookie);
      }
    });
  });
}

export function removeCookie(details) {
  return new Promise((resolve, reject) => {
    api.cookies.remove(details, (details) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(details);
      }
    });
  });
}

export function getAllCookies(details) {
  return new Promise((resolve, reject) => {
    api.cookies.getAll(details, (cookies) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(cookies);
      }
    });
  });
}

export function onCookieChanged(listener) {
  return api.cookies.onChanged.addListener(listener);
}

export function download(options) {
  return new Promise((resolve, reject) => {
    api.downloads.download(options, (downloadId) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

export function onDownloadChanged(listener) {
  return api.downloads.onChanged.addListener(listener);
}

export function onDownloadCreated(listener) {
  return api.downloads.onCreated.addListener(listener);
}

export function attachDebugger(target, requiredVersion) {
  return new Promise((resolve, reject) => {
    api.debugger.attach(target, requiredVersion, () => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

export function detachDebugger(target) {
  return new Promise((resolve, reject) => {
    api.debugger.detach(target, () => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

export function sendDebuggerCommand(target, command, params) {
  return new Promise((resolve, reject) => {
    api.debugger.sendCommand(target, command, params, (result) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

export function onDebuggerEvent(listener) {
  return api.debugger.onEvent.addListener(listener);
}

export function onDebuggerDetached(listener) {
  return api.debugger.onDetached.addListener(listener);
}

export default {
  isFirefox,
  isChrome,
  runtime,
  storage: localStorage,
  sessionStorage,
  tabs: {
    query: queryTabs,
    sendMessage: sendTabMessage,
    executeScript,
    insertCSS,
    removeCSS,
    create: createTab,
    update: updateTab,
    remove: removeTab,
    get: getTab,
    getCurrent: getCurrentTab,
    onUpdated: onTabUpdated,
    onRemoved: onTabRemoved,
    onActivated: onTabActivated,
  },
  scripting: { executeScript, insertCSS, removeCSS },
  sidePanel: { open: openSidePanel, setOptions: setSidePanelOptions, getOptions: getSidePanelOptions },
  action: { setIcon, setTitle, setPopup, openOptionsPage },
  commands: { onCommand, getAll: getAllCommands },
  cookies: { get: getCookie, set: setCookie, remove: removeCookie, getAll: getAllCookies, onChanged: onCookieChanged },
  downloads: { download, onChanged: onDownloadChanged, onCreated: onDownloadCreated },
  debugger: { attach: attachDebugger, detach: detachDebugger, sendCommand: sendDebuggerCommand, onEvent: onDebuggerEvent, onDetached: onDebuggerDetached },
  nativeMessaging: { connect: connectNative },
  runtime: { sendMessage, onMessage, removeMessageListener, connect, getManifest, getURL, onInstalled, onStartup },
};