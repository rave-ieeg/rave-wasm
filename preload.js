// Preload script for Electron app
// This runs in a context that has access to both Node.js and the DOM

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    // Platform and version info
    platform: process.platform,
    versions: {
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron
    },
    
    // Get app version
    getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

    // R Plugin APIs
    r: {
      // Get R detection status
      getStatus: () => ipcRenderer.invoke('plugin:r:getStatus'),
      
      // Set custom R path
      setCustomPath: (path) => ipcRenderer.invoke('plugin:r:setCustomPath', path),
      
      // Create R session
      createSession: (sessionId) => ipcRenderer.invoke('plugin:r:createSession', sessionId),
      
      // Execute R code
      execute: (sessionId, code, timeout) => ipcRenderer.invoke('plugin:r:execute', sessionId, code, timeout),
      
      // Get session status
      getSessionStatus: (sessionId) => ipcRenderer.invoke('plugin:r:getSessionStatus', sessionId),
      
      // Terminate session
      terminateSession: (sessionId) => ipcRenderer.invoke('plugin:r:terminateSession', sessionId),
      
      // Get all sessions
      getAllSessions: () => ipcRenderer.invoke('plugin:r:getAllSessions'),
      
      // Start RAVE application
      startRAVE: (sessionId) => ipcRenderer.invoke('plugin:r:startRAVE', sessionId),
      
      // Install RAVE packages (returns session ID for console window)
      installRAVE: () => ipcRenderer.invoke('plugin:r:installRAVE'),
      
      // Register for console output
      registerConsoleOutput: (sessionId) => ipcRenderer.invoke('plugin:r:registerConsoleOutput', sessionId),
      
      // Execute RAVE installation commands
      executeRAVEInstall: (sessionId) => ipcRenderer.invoke('plugin:r:executeRAVEInstall', sessionId),
      
      // Listen for console output
      onConsoleOutput: (callback) => {
        ipcRenderer.on('plugin:r:consoleOutput', (event, data) => callback(data));
      }
    },

    // Static Server Plugin APIs
    server: {
      // Get server port
      getPort: () => ipcRenderer.invoke('plugin:server:getPort')
    },

    // App APIs
    app: {
      // Get application paths
      getPaths: () => ipcRenderer.invoke('plugin:app:getPaths')
    },

    // Launchpad APIs
    launchpad: {
      // Open an app (wasm or r-shiny)
      openApp: (type) => ipcRenderer.invoke('plugin:launchpad:openApp', type),
      
      // Select R path manually
      selectRPath: () => ipcRenderer.invoke('plugin:launchpad:selectRPath'),
      
      // Open R console window
      openRConsole: (sessionId) => ipcRenderer.invoke('plugin:launchpad:openRConsole', sessionId),
      
      // Show confirmation dialog
      showConfirm: (options) => ipcRenderer.invoke('plugin:launchpad:showConfirm', options),
      
      // Show alert dialog
      showAlert: (options) => ipcRenderer.invoke('plugin:launchpad:showAlert', options),
      
      // Listen for R status changes
      onRStatusChanged: (callback) => {
        ipcRenderer.on('plugin:r:statusChanged', (event, status) => callback(status));
      }
    },
  }
);
