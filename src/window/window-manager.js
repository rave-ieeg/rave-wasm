const { BrowserWindow, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { addContextMenu } = require('../menu/context-menu');

/**
 * Window Manager for creating and managing application windows
 */
class WindowManager {
  constructor() {
    this.launchpadWindow = null;
    this.appWindows = new Map(); // sessionId -> { window, port, sessionId, type }
  }

  /**
   * Find icon path
   * @param {string} basePath - Base path to search from
   * @returns {string|null} - Icon path or null
   */
  _findIconPath(basePath) {
    const iconPaths = [
      path.join(basePath, 'site', 'icon.png'),
      path.join(basePath, 'site', 'favicon.png'),
      path.join(basePath, 'assets', 'favicon.ico'),
      path.join(basePath, 'site', 'favicon.ico')
    ];
    
    for (const testPath of iconPaths) {
      if (fs.existsSync(testPath)) {
        return testPath;
      }
    }
    return null;
  }

  /**
   * Create launchpad window
   * @param {string} basePath - Application base path
   * @param {number} port - Server port
   * @returns {BrowserWindow} - The launchpad window
   */
  createLaunchpadWindow(basePath, port) {
    if (this.launchpadWindow && !this.launchpadWindow.isDestroyed()) {
      this.launchpadWindow.focus();
      return this.launchpadWindow;
    }

    const iconPath = this._findIconPath(basePath);
    
    this.launchpadWindow = new BrowserWindow({
      width: 750,
      height: 700,
      resizable: false,
      webPreferences: {
        preload: path.join(basePath, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:launchpad' // Separate partition from app windows
      },
      ...(iconPath && { icon: iconPath }),
      title: 'RAVE Widgets Launcher'
    });

    this.launchpadWindow.loadURL(`http://localhost:${port}/launchpad.html`);
    
    this.launchpadWindow.on('closed', () => {
      this.launchpadWindow = null;
      // If no app windows are open, quit the application
      if (this.appWindows.size === 0) {
        const { app } = require('electron');
        app.quit();
      }
    });

    return this.launchpadWindow;
  }

  /**
   * Create an app window
   * @param {string} basePath - Application base path
   * @param {number} port - Server port
   * @param {string} sessionId - Session ID for this window
   * @param {string} type - Window type ('wasm' or 'r-shiny')
   * @returns {BrowserWindow} - The app window
   */
  createAppWindow(basePath, port, sessionId, type = 'wasm') {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const iconPath = this._findIconPath(basePath);
    
    const appWindow = new BrowserWindow({
      width: width,
      height: height,
      webPreferences: {
        preload: path.join(basePath, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: type === 'r-shiny' ? false : true, // Disable for R-Shiny to allow iframe navigation
        allowRunningInsecureContent: false,
        partition: type === 'r-shiny' ? 'persist:rave' : 'persist:shinylive', // Separate partition for RAVE
        v8CacheOptions: 'none'
      },
      ...(iconPath && { icon: iconPath }),
      title: type === 'wasm' ? 'RAVE Widgets (WASM)' : 'RAVE Widgets (R Shiny)'
    });

    // Set up the session for increased storage quota
    const partitionName = type === 'r-shiny' ? 'persist:rave' : 'persist:shinylive';
    const sess = session.fromPartition(partitionName);
    
    // Grant storage permissions automatically
    sess.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = ['storage-access', 'persistent-storage'];
      if (allowedPermissions.includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });
    
    // Handle quota requests
    sess.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'persistent-storage' || permission === 'storage-access') {
        return true;
      }
      return false;
    });

    // For R-Shiny, enable console logging and handle frame navigation
    if (type === 'r-shiny') {
      // Log all navigation attempts for debugging
      appWindow.webContents.on('will-navigate', (event, url) => {
        console.log('[Main] Will navigate to:', url);
      });
      
      appWindow.webContents.on('did-navigate', (event, url) => {
        console.log('[Main] Did navigate to:', url);
      });
      
      appWindow.webContents.on('will-frame-navigate', (event, url, isMainFrame) => {
        console.log('[Frame] Will navigate to:', url, '| isMainFrame:', isMainFrame);
      });
      
      appWindow.webContents.on('did-frame-navigate', (event, url, httpResponseCode, httpStatusText, isMainFrame) => {
        console.log('[Frame] Did navigate to:', url, '| HTTP:', httpResponseCode, httpStatusText, '| isMainFrame:', isMainFrame);
      });
      
      // Log console messages from the renderer
      appWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer Console] ${message}`);
      });
    }

    // Load the main app
    appWindow.loadURL(`http://localhost:${port}`);

    // Handle external links
    appWindow.webContents.setWindowOpenHandler(({ url }) => {
      return { 
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: width,
          height: height,
          webPreferences: {
            webSecurity: false
          }
        }
      };
    });

    // Add context menu
    addContextMenu(appWindow, (url) => {
      this.createNewWindow(basePath, url);
    });

    // Store window reference
    this.appWindows.set(sessionId, {
      window: appWindow,
      port,
      sessionId,
      type
    });

    // Cleanup on close
    appWindow.on('closed', () => {
      this.appWindows.delete(sessionId);
    });

    return appWindow;
  }

  /**
   * Create R console window for installation
   * @param {string} basePath - Application base path
   * @param {number} port - Server port
   * @param {string} sessionId - R session ID
   * @returns {BrowserWindow} - The console window
   */
  createRConsoleWindow(basePath, port, sessionId) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const iconPath = this._findIconPath(basePath);
    
    const consoleWindow = new BrowserWindow({
      width: Math.floor(width * 0.7),
      height: Math.floor(height * 0.8),
      webPreferences: {
        preload: path.join(basePath, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:launchpad'
      },
      ...(iconPath && { icon: iconPath }),
      title: 'R Console - RAVE Installation'
    });

    // Load R console page with session ID
    consoleWindow.loadURL(`http://localhost:${port}/r-console.html?sessionId=${sessionId}`);

    // Store window reference
    this.appWindows.set(sessionId, {
      window: consoleWindow,
      port,
      sessionId,
      type: 'r-console'
    });

    // Cleanup on close
    consoleWindow.on('closed', () => {
      this.appWindows.delete(sessionId);
    });

    return consoleWindow;
  }

  /**
   * Create a new window with a given URL
   * @param {string} basePath - Application base path
   * @param {string} url - URL to load
   * @returns {BrowserWindow} - The new window
   */
  createNewWindow(basePath, url) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const iconPath = this._findIconPath(basePath);
    
    const newWindow = new BrowserWindow({
      width: Math.floor(width * 0.8),
      height: Math.floor(height * 0.8),
      webPreferences: {
        preload: path.join(basePath, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition: 'persist:shinylive'
      },
      ...(iconPath && { icon: iconPath })
    });

    newWindow.loadURL(url);

    // Handle external links in the new window too
    newWindow.webContents.setWindowOpenHandler(({ url }) => {
      return { 
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: width,
          height: height,
          webPreferences: {
            webSecurity: false
          }
        }
      };
    });

    // Add context menu
    addContextMenu(newWindow, (url) => {
      this.createNewWindow(basePath, url);
    });

    return newWindow;
  }

  /**
   * Get window by session ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Window info or null
   */
  getWindow(sessionId) {
    return this.appWindows.get(sessionId) || null;
  }

  /**
   * Get all app windows
   * @returns {Map} - Map of session IDs to window info
   */
  getAllWindows() {
    return this.appWindows;
  }

  /**
   * Close window by session ID
   * @param {string} sessionId - Session ID
   */
  closeWindow(sessionId) {
    const windowInfo = this.appWindows.get(sessionId);
    if (windowInfo && !windowInfo.window.isDestroyed()) {
      windowInfo.window.close();
    }
  }

  /**
   * Send message to launchpad
   * @param {string} channel - IPC channel
   * @param {*} data - Data to send
   */
  sendToLaunchpad(channel, data) {
    if (this.launchpadWindow && !this.launchpadWindow.isDestroyed()) {
      this.launchpadWindow.webContents.send(channel, data);
    }
  }
}

module.exports = WindowManager;
