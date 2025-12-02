const { app, BrowserWindow, protocol, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { lookup } = require('mime-types');

let mainWindow;
let server;

// Create a local HTTP server to serve files (needed for service workers)
function createLocalServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Parse the URL and remove query string
      let filePath = req.url.split('?')[0];
      
      // Default to index.html
      if (filePath === '/') {
        filePath = '/index.html';
      }
      
      // Construct full file path
      const fullPath = path.join(__dirname, 'site', filePath);
      
      // Read and serve the file
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }
        
        // Set appropriate content type
        const mimeType = lookup(fullPath) || 'application/octet-stream';
        const headers = {
          'Content-Type': mimeType,
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Service-Worker-Allowed': '/',
          'Cache-Control': 'no-cache'
        };
        
        // Add special headers for service worker files
        if (fullPath.endsWith('-sw.js') || fullPath.includes('service-worker') || fullPath.includes('shinylive-sw')) {
          headers['Service-Worker-Allowed'] = '/';
          headers['Content-Type'] = 'application/javascript';
        }
        
        res.writeHead(200, headers);
        res.end(data);
      });
    });
    
    // Increase server timeout and max header size for large file uploads
    server.timeout = 600000; // 10 minutes
    server.maxHeadersCount = 100;
    
    server.listen(0, 'localhost', () => {
      const port = server.address().port;
      console.log(`Local server running on http://localhost:${port}`);
      resolve(port);
    });
  });
}

// Function to add context menu to a window
function addContextMenu(window) {
  window.webContents.on('context-menu', (event, params) => {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();

    // If right-clicking on a link, add link-specific options
    if (params.linkURL) {
      menu.append(new MenuItem({
        label: 'Open Link in New Window',
        click: () => {
          createNewWindow(params.linkURL);
        }
      }));

      menu.append(new MenuItem({
        label: 'Copy Link Address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.linkURL);
        }
      }));

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Add refresh option
    menu.append(new MenuItem({
      label: 'Refresh',
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        window.webContents.reload();
      }
    }));

    // Add back option if available
    if (window.webContents.navigationHistory.canGoBack()) {
      menu.append(new MenuItem({
        label: 'Back',
        accelerator: 'CmdOrCtrl+Left',
        click: () => {
          window.webContents.navigationHistory.goBack();
        }
      }));
    }

    // Add forward option if available
    if (window.webContents.navigationHistory.canGoForward()) {
      menu.append(new MenuItem({
        label: 'Forward',
        accelerator: 'CmdOrCtrl+Right',
        click: () => {
          window.webContents.navigationHistory.goForward();
        }
      }));
    }

    // Add separator
    menu.append(new MenuItem({ type: 'separator' }));

    // Add DevTools option
    menu.append(new MenuItem({
      label: 'Inspect Element',
      accelerator: 'CmdOrCtrl+Shift+I',
      click: () => {
        window.webContents.inspectElement(params.x, params.y);
      }
    }));

    // Add toggle DevTools option
    menu.append(new MenuItem({
      label: 'Toggle Developer Tools',
      accelerator: 'CmdOrCtrl+Alt+I',
      click: () => {
        window.webContents.toggleDevTools();
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    // Add close option
    menu.append(new MenuItem({
      label: 'Close Window',
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        window.close();
      }
    }));

    // Only show the menu if the page didn't handle the context menu
    // (params.editFlags indicates the page didn't prevent default)
    if (!params.isEditable && params.mediaType === 'none' || params.linkURL) {
      menu.popup();
    }
  });
}

// Function to create a new window with a given URL
function createNewWindow(url) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // Determine icon path based on platform and available files
  let iconPath = null;
  const iconPaths = [
    path.join(__dirname, 'site', 'icon.png'),
    path.join(__dirname, 'site', 'favicon.png'),
    path.join(__dirname, 'assets', 'favicon.ico'),
    path.join(__dirname, 'site', 'favicon.ico')
  ];
  
  for (const testPath of iconPaths) {
    if (fs.existsSync(testPath)) {
      iconPath = testPath;
      break;
    }
  }
  
  const newWindow = new BrowserWindow({
    width: Math.floor(width * 0.8),
    height: Math.floor(height * 0.8),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: 'persist:shinylive' // Use persistent session for service workers
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

  // Add context menu to the new window
  addContextMenu(newWindow);

  return newWindow;
}

// Enable CORS and set up custom protocol for local files
async function createWindow() {
  // Get primary display dimensions
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // Start local server
  const port = await createLocalServer();
  
  // Determine icon path based on platform and available files
  let iconPath = null;
  const iconPaths = [
    path.join(__dirname, 'site', 'icon.png'),
    path.join(__dirname, 'site', 'favicon.png'),
    path.join(__dirname, 'assets', 'favicon.ico'),
    path.join(__dirname, 'site', 'favicon.ico')
  ];
  
  for (const testPath of iconPaths) {
    if (fs.existsSync(testPath)) {
      iconPath = testPath;
      break;
    }
  }
  
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Enable web security for proper service worker support
      allowRunningInsecureContent: false,
      partition: 'persist:shinylive', // Use persistent session for service workers
      v8CacheOptions: 'none' // Disable V8 code cache to reduce memory pressure
    },
    ...(iconPath && { icon: iconPath })
  });

  // Set up the session for increased storage quota
  const sess = session.fromPartition('persist:shinylive');
  
  // Grant storage permissions automatically
  sess.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['storage-access', 'persistent-storage'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });
  
  // Handle quota requests - grant large quota for service workers
  sess.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'persistent-storage' || permission === 'storage-access') {
      return true;
    }
    return false;
  });

  // Load from local HTTP server instead of file:// protocol
  mainWindow.loadURL(`http://localhost:${port}`);

  // Open DevTools in development (optional)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  // Handle external links - allow them to open in new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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

  // Listen for new windows being created
  app.on('browser-window-created', (event, newWindow) => {
    addContextMenu(newWindow);
  });

  // Add context menu to main window
  addContextMenu(mainWindow);
}

// Add command line switches before app is ready
app.commandLine.appendSwitch('max-http-header-size', '80000');
app.commandLine.appendSwitch('disable-http-cache'); // Reduce cache-related database operations
app.commandLine.appendSwitch('ignore-certificate-errors'); // For localhost
app.commandLine.appendSwitch('disk-cache-size', '10737418240'); // 10GB disk cache for large files
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192 --max-string-length=536870888'); // Increase limits
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion'); // Reduce background processing
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer'); // Better WASM support
app.commandLine.appendSwitch('enable-experimental-web-platform-features'); // Enable newer web APIs

// Register protocol before app is ready
app.whenReady().then(() => {
  // Register custom protocol to handle service worker and other resources
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6); // Remove 'app://' prefix
    callback({ path: path.normalize(`${__dirname}/site/${url}`) });
  });

  createWindow().catch((error) => {
    console.error('Error creating window:', error);
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error('Error creating window on activate:', error);
      });
    }
  });
}).catch((error) => {
  console.error('Error in app.whenReady:', error);
});

app.on('window-all-closed', function () {
  // Close the server when app quits
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') app.quit();
});

// Handle any errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
