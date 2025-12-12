// Preload script for Electron app
// This runs in a context that has access to both Node.js and the DOM

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI',
  {
    // Listen for installation console window close
    onInstallationConsoleClosed: (callback) => {
      ipcRenderer.on('installation-console-closed', () => callback());
    }
  }
);

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
    
    // Check if running in debug mode
    isDebug: () => ipcRenderer.invoke('app:isDebug'),
    
    // Open DevTools (only works in debug mode)
    openDevTools: () => ipcRenderer.invoke('app:openDevTools'),

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
      
      // Check prerequisites before installation (forceCheck bypasses cache)
      checkPrerequisites: (forceCheck) => ipcRenderer.invoke('plugin:r:checkPrerequisites', forceCheck),
      
      // Clear prerequisite cache
      clearPrerequisiteCache: () => ipcRenderer.invoke('plugin:r:clearPrerequisiteCache'),
      
      // Execute command chain for prerequisite installation
      executeCommandChain: (todoList) => ipcRenderer.invoke('plugin:r:executeCommandChain', todoList),
      
      // Skip current step in command chain
      skipCurrentStep: () => ipcRenderer.invoke('plugin:r:skipCurrentStep'),
      
      // Abort command chain
      abortChain: () => ipcRenderer.invoke('plugin:r:abortChain'),
      
      // Listen for console output
      onConsoleOutput: (callback) => {
        ipcRenderer.on('plugin:r:consoleOutput', (event, data) => callback(data));
      },
      
      // Listen for installation progress
      onInstallProgress: (callback) => {
        ipcRenderer.on('plugin:r:installProgress', (event, data) => callback(data));
      }
    },

    // Static Server Plugin APIs
    server: {
      // Get server port
      getPort: () => ipcRenderer.invoke('plugin:server:getPort')
    },

    // Cache Management APIs
    cache: {
      // Get cache statistics (size, file count)
      getStats: () => ipcRenderer.invoke('plugin:cache:getStats'),
      
      // Get cache directory path
      getCacheDir: () => ipcRenderer.invoke('plugin:cache:getCacheDir'),
      
      // Clear all cached data
      clearCache: () => ipcRenderer.invoke('plugin:cache:clearCache'),
      
      // Ensure a manifest's files are cached
      ensureManifest: (manifestName) => ipcRenderer.invoke('plugin:cache:ensureManifest', manifestName),
      
      // Check if a specific file is cached
      isFileCached: (relativePath) => ipcRenderer.invoke('plugin:cache:isFileCached', relativePath)
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

      // Open installation console window
      openInstallationConsole: () => ipcRenderer.invoke('plugin:launchpad:openInstallationConsole'),
      
      // Show confirmation dialog
      showConfirm: (options) => ipcRenderer.invoke('plugin:launchpad:showConfirm', options),
      
      // Show alert dialog
      showAlert: (options) => ipcRenderer.invoke('plugin:launchpad:showAlert', options),
      
      // Open external URL in default browser
      openExternal: (url) => ipcRenderer.invoke('plugin:launchpad:openExternal', url),
      
      // Listen for R status changes
      onRStatusChanged: (callback) => {
        ipcRenderer.on('plugin:r:statusChanged', (event, status) => callback(status));
      }
    },

    // Unified Installation APIs
    installer: {
      // Start installation workflow
      start: () => ipcRenderer.invoke('plugin:installer:start'),
      
      // Proceed with installation despite blocked/failed required step
      proceedAnyway: () => ipcRenderer.invoke('plugin:installer:proceedAnyway'),
      
      // Abort installation
      abort: () => ipcRenderer.invoke('plugin:installer:abort'),
      
      // Respond to command prompt
      respondToCommandPrompt: (sessionId, response) => 
        ipcRenderer.invoke('plugin:shell:respondToCommandPrompt', sessionId, response),
      
      // Listen for installation progress
      onProgress: (callback) => {
        ipcRenderer.on('plugin:installer:progress', (event, data) => callback(data));
      }
    }
  }
);