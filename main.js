const { app, BrowserWindow, protocol, screen } = require('electron');
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
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Service-Worker-Allowed': '/'
        });
        res.end(data);
      });
    });
    
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

    // Add refresh option
    menu.append(new MenuItem({
      label: 'Refresh',
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        window.webContents.reload();
      }
    }));

    // Add back option if available
    if (window.webContents.canGoBack()) {
      menu.append(new MenuItem({
        label: 'Back',
        accelerator: 'CmdOrCtrl+Left',
        click: () => {
          window.webContents.goBack();
        }
      }));
    }

    // Add forward option if available
    if (window.webContents.canGoForward()) {
      menu.append(new MenuItem({
        label: 'Forward',
        accelerator: 'CmdOrCtrl+Right',
        click: () => {
          window.webContents.goForward();
        }
      }));
    }

    // Add separator
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
    if (!params.isEditable && params.mediaType === 'none') {
      menu.popup();
    }
  });
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
      webSecurity: false, // Allow external URLs and service workers
      allowRunningInsecureContent: false
    },
    ...(iconPath && { icon: iconPath })
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

// Register protocol before app is ready
app.whenReady().then(() => {
  // Register custom protocol to handle service worker and other resources
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6); // Remove 'app://' prefix
    callback({ path: path.normalize(`${__dirname}/site/${url}`) });
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
