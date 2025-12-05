// Preserve original PATH before Electron modifies it (important for R detection on Windows)
if (process.env.PATH && !process.env.ORIGINAL_PATH) {
  process.env.ORIGINAL_PATH = process.env.PATH;
}

const { app, BrowserWindow, protocol, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Import modular components
const PluginManager = require('./src/plugins/plugin-manager');
const StaticServerPlugin = require('./src/plugins/static-server-plugin');
const RPlugin = require('./src/plugins/r-plugin');
const ConfigManager = require('./src/config/config-manager');
const WindowManager = require('./src/window/window-manager');
const PortManager = require('./src/utils/port-manager');
const { wrapHandler } = require('./src/utils/ipc-helpers');

// Global instances
const pluginManager = new PluginManager();
const configManager = new ConfigManager();
const windowManager = new WindowManager();
const portManager = new PortManager();

let staticServerPlugin;
let rPlugin;

// Helper function to find icon path
function getIconPath() {
  const iconPaths = [
    path.join(__dirname, 'assets', 'favicon.icns'),
    path.join(__dirname, 'assets', 'favicon.ico'),
    path.join(__dirname, 'site', 'icon.png'),
    path.join(__dirname, 'site', 'favicon.png'),
    path.join(__dirname, 'site', 'favicon.ico')
  ];
  
  console.log('[DEBUG] Searching for icon in paths:', iconPaths);
  
  for (const testPath of iconPaths) {
    console.log('[DEBUG] Checking:', testPath, 'exists:', fs.existsSync(testPath));
    if (fs.existsSync(testPath)) {
      console.log('[DEBUG] Using icon:', testPath);
      return testPath;
    }
  }
  console.log('[DEBUG] No icon found!');
  return null;
}

// Setup command line switches before app is ready
function setupCommandLineSwitches() {
  app.commandLine.appendSwitch('max-http-header-size', '80000');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('disk-cache-size', '10737418240');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192 --wasm-max-mem-pages=65536');
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer,WebAssemblyThreads');
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
  app.commandLine.appendSwitch('http-cache', 'memory');
  app.commandLine.appendSwitch('enable-parallel-downloading');
  app.commandLine.appendSwitch('max-active-webgl-contexts', '16');
  app.commandLine.appendSwitch('renderer-process-limit', '100');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
}

// Setup IPC handlers for launchpad
function setupLaunchpadIPC() {
  // Open app window
  ipcMain.handle('plugin:launchpad:openApp', wrapHandler(async (event, type) => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    if (type === 'r-shiny') {
      // Create R session first
      const rStatus = await rPlugin.detector.getStatus();
      if (!rStatus.detected) {
        throw new Error('R not detected');
      }
      
      // Check if RAVE package is installed
      if (!rStatus.packages || !rStatus.packages.rave) {
        throw new Error('RAVE package not installed. Please install with: install.packages("rave")');
      }
      
      const sessionResult = await rPlugin.sessionManager.createSession(sessionId, rStatus.path);
      if (!sessionResult.success) {
        throw new Error(sessionResult.error || 'Failed to create R session');
      }
      
      // Start RAVE application
      const raveResult = await rPlugin.sessionManager.startRAVE(sessionId);
      if (!raveResult.success) {
        // Clean up session on failure
        rPlugin.sessionManager.terminateSession(sessionId);
        throw new Error(raveResult.error || 'Failed to start RAVE');
      }
      
      // Create window pointing to RAVE server
      const window = windowManager.createAppWindow(__dirname, raveResult.port, sessionId, type);
      
      // Handle window close - terminate R session
      window.on('closed', () => {
        rPlugin.sessionManager.terminateSession(sessionId);
      });
      
      return { success: true, sessionId, port: raveResult.port };
    } else {
      // WASM type - use static server
      const port = staticServerPlugin.getPort();
      const window = windowManager.createAppWindow(__dirname, port, sessionId, type);
      return { success: true, sessionId, port };
    }
  }));

  // Select R path manually
  ipcMain.handle('plugin:launchpad:selectRPath', wrapHandler(async () => {
    const iconPath = getIconPath();
    const result = await dialog.showOpenDialog({
      title: 'Select R Executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
      ],
      ...(iconPath && { icon: iconPath })
    });

    if (result.canceled) {
      return { success: false };
    }

    const customPath = result.filePaths[0];
    
    // Validate the path before setting it
    const testResult = await rPlugin.detector.testRPath(customPath);
    
    if (!testResult.valid || !testResult.version || testResult.version === 'unknown') {
      return {
        success: false,
        error: 'The selected file is not a valid R executable. Please select a valid R installation.',
        path: customPath
      };
    }
    
    // Only set the custom path if it's valid
    await rPlugin.detector.setCustomPath(customPath);
    
    return {
      success: true,
      path: customPath,
      version: testResult.version
    };
  }));

  // Get app paths
  ipcMain.handle('plugin:app:getPaths', wrapHandler(async () => {
    return configManager.getPaths();
  }));

  // Get app version
  ipcMain.handle('app:getVersion', async () => {
    const packageJson = require('./package.json');
    return packageJson.version;
  });

  // Open R console window for installation
  ipcMain.handle('plugin:launchpad:openRConsole', wrapHandler(async (event, sessionId) => {
    const port = staticServerPlugin.getPort();
    const window = windowManager.createRConsoleWindow(__dirname, port, sessionId);
    
    // Handle window close - terminate R session
    window.on('closed', () => {
      rPlugin.sessionManager.terminateSession(sessionId);
    });
    
    return { success: true };
  }));

  // Show confirmation dialog
  ipcMain.handle('plugin:launchpad:showConfirm', wrapHandler(async (event, options) => {
    const iconPath = getIconPath();
    console.log('[DEBUG] showConfirm - iconPath:', iconPath);
    console.log('[DEBUG] showConfirm - options:', options);
    const dialogOptions = {
      type: options.type || 'question',
      title: options.title || 'Confirm',
      message: options.message || '',
      detail: options.detail || '',
      buttons: options.buttons || ['OK', 'Cancel'],
      defaultId: options.defaultId || 0,
      cancelId: options.cancelId || 1,
      ...(iconPath && { icon: iconPath })
    };
    console.log('[DEBUG] showConfirm - dialog options:', dialogOptions);
    const result = await dialog.showMessageBox(dialogOptions);
    
    return { response: result.response };
  }));

  // Show alert dialog
  ipcMain.handle('plugin:launchpad:showAlert', wrapHandler(async (event, options) => {
    const iconPath = getIconPath();
    console.log('[DEBUG] showAlert - iconPath:', iconPath);
    console.log('[DEBUG] showAlert - options:', options);
    const dialogOptions = {
      type: options.type || 'error',
      title: options.title || 'Alert',
      message: options.message || '',
      detail: options.detail || '',
      buttons: ['OK'],
      ...(iconPath && { icon: iconPath })
    };
    console.log('[DEBUG] showAlert - dialog options:', dialogOptions);
    await dialog.showMessageBox(dialogOptions);
    
    return { success: true };
  }));
}

// Initialize application
async function initialize() {
  try {
    console.log('Initializing RAVE Widgets...');
    
    // Initialize config manager
    await configManager.init();
    
    // Create and register plugins
    staticServerPlugin = new StaticServerPlugin();
    rPlugin = new RPlugin(configManager, portManager);
    
    pluginManager.registerPlugin('static-server', staticServerPlugin);
    pluginManager.registerPlugin('r-plugin', rPlugin);
    
    // Initialize static server plugin
    await pluginManager.initPlugin('static-server', __dirname);
    
    // Initialize R plugin
    await pluginManager.initPlugin('r-plugin');
    
    // Register IPC handlers for all plugins
    pluginManager.registerAllIPC(ipcMain);
    
    // Setup launchpad IPC handlers
    setupLaunchpadIPC();
    
    // Register custom protocol
    protocol.registerFileProtocol('app', (request, callback) => {
      const url = request.url.substr(6);
      callback({ path: path.normalize(`${__dirname}/site/${url}`) });
    });
    
    // Create launchpad window first
    const port = staticServerPlugin.getPort();
    const launchpad = windowManager.createLaunchpadWindow(__dirname, port);
    
    // Set callback for R status changes AFTER window is created
    rPlugin.setStatusChangedCallback((status) => {
      windowManager.sendToLaunchpad('plugin:r:statusChanged', status);
    });
    
    // Send initial R status to launchpad after window finishes loading
    launchpad.webContents.once('did-finish-load', () => {
      const initialRStatus = rPlugin.detector.getStatus();
      console.log('Sending initial R status to launchpad:', initialRStatus);
      if (initialRStatus.detected) {
        // Give the page a moment to set up listeners
        setTimeout(() => {
          windowManager.sendToLaunchpad('plugin:r:statusChanged', initialRStatus);
        }, 100);
      }
    });
    
    console.log('RAVE Widgets initialized successfully');
  } catch (error) {
    console.error('Failed to initialize:', error);
    app.quit();
  }
}

// Setup command line switches
setupCommandLineSwitches();

// App lifecycle
app.whenReady().then(initialize).catch((error) => {
  console.error('Error in app.whenReady:', error);
  app.quit();
});

app.on('activate', () => {
  if (!windowManager.launchpadWindow || windowManager.launchpadWindow.isDestroyed()) {
    const port = staticServerPlugin.getPort();
    windowManager.createLaunchpadWindow(__dirname, port);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  pluginManager.cleanup();
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
