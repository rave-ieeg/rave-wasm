# RAVE Widgets - Modular Electron Backend

## Architecture Overview

The Electron backend has been refactored into a modular plugin-based architecture for better maintainability and extensibility.

## Directory Structure

```
src/
├── plugins/
│   ├── plugin-manager.js           # Plugin registry and lifecycle management
│   ├── static-server-plugin/
│   │   └── index.js                # HTTP server for serving WASM app
│   └── r-plugin/
│       ├── index.js                # R plugin coordinator
│       ├── r-detector.js           # Auto-detect R installations
│       └── r-session-manager.js    # Manage multiple R sessions
├── window/
│   └── window-manager.js           # Manage launchpad and app windows
├── menu/
│   └── context-menu.js             # Context menu functionality
├── config/
│   └── config-manager.js           # Persistent configuration storage
└── utils/
    ├── ipc-helpers.js              # IPC helper utilities
    └── port-manager.js             # Port allocation and reuse
```

## Plugins

### Static Server Plugin
- Serves WASM app files via HTTP server
- Handles MIME types, caching headers, and streaming
- Auto-allocates random port on startup

### R Plugin
- **R Detector**: Auto-detects R installations on macOS, Linux, and Windows
  - Searches common paths (`/usr/local/bin/R`, `C:\Program Files\R\`, etc.)
  - Background detection every 5 seconds until found
  - Supports manual R path configuration
  
- **R Session Manager**: Manages multiple parallel R sessions
  - Each app window can have its own R session
  - Sessions created on-demand when user opens R-enabled window
  - Auto-terminates session when window closes
  - Crash detection with restart dialog

## Launchpad

The launchpad is the main entry point that always shows on startup:
- **Open Portable Widgets (WASM)**: Launch app with WebAssembly-based R
- **Open with R Shiny**: Launch app with native R session (disabled until R detected)
- **Set R Path Manually**: Browse for R executable if auto-detection fails

## Window Management

- Launchpad window persists and allows opening multiple app windows
- Each app window can be either:
  - **WASM mode**: Uses WebR running in browser
  - **R Shiny mode**: Uses native R session for hosting Shiny apps

## Configuration & Persistence

Configuration and data are stored in the user's application data directory:
- **Config**: `~/Library/Application Support/rave-wasm-electron/config.json`
- **Cache**: `~/Library/Application Support/rave-wasm-electron/cache/`
- **Data**: `~/Library/Application Support/rave-wasm-electron/data/`

## IPC APIs

### R Plugin APIs
```javascript
// Get R detection status
window.electron.r.getStatus()

// Set custom R path
window.electron.r.setCustomPath(path)

// Create R session
window.electron.r.createSession(sessionId)

// Execute R code
window.electron.r.execute(sessionId, code, timeout)

// Get session status
window.electron.r.getSessionStatus(sessionId)

// Terminate session
window.electron.r.terminateSession(sessionId)

// Get all active sessions
window.electron.r.getAllSessions()
```

### Launchpad APIs
```javascript
// Open app window (type: 'wasm' or 'r-shiny')
window.electron.launchpad.openApp(type)

// Select R path manually
window.electron.launchpad.selectRPath()

// Listen for R status changes
window.electron.launchpad.onRStatusChanged(callback)
```

### App APIs
```javascript
// Get application paths
window.electron.app.getPaths()
```

## Development

### Running in Development
```bash
npm start
```

### Building for Production
```bash
# Build for all platforms
npm run build:all

# Build for specific platform
npm run build:mac
npm run build:win
npm run build:linux
```

## Adding New Plugins

1. Create plugin directory: `src/plugins/my-plugin/`
2. Create `index.js` with plugin class:
   ```javascript
   class MyPlugin {
     constructor() {
       this.name = 'my-plugin';
     }
     
     async init() {
       // Initialize plugin
     }
     
     registerIPC(ipcMain) {
       // Register IPC handlers
       ipcMain.handle('plugin:my-plugin:action', async () => {
         // Handle action
       });
     }
     
     cleanup() {
       // Cleanup on app quit
     }
   }
   
   module.exports = MyPlugin;
   ```

3. Register plugin in `main.js`:
   ```javascript
   const MyPlugin = require('./src/plugins/my-plugin');
   const myPlugin = new MyPlugin();
   pluginManager.registerPlugin('my-plugin', myPlugin);
   await pluginManager.initPlugin('my-plugin');
   ```

4. Expose APIs in `preload.js`:
   ```javascript
   myPlugin: {
     action: () => ipcRenderer.invoke('plugin:my-plugin:action')
   }
   ```

## Notes

- R sessions are created on-demand (not at app startup)
- Each R-enabled window gets its own isolated R session
- Sessions are automatically terminated when windows close
- Port allocation uses a pool system (8100-8200) with reuse
- Background R detection stops once R is found
- Custom R paths are persisted in config.json
