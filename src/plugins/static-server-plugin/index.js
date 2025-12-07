const http = require('http');
const path = require('path');
const fs = require('fs');
const { lookup } = require('mime-types');
const { wrapHandler } = require('../../utils/ipc-helpers');

/**
 * Static Server Plugin for serving WASM app files
 */
class StaticServerPlugin {
  constructor() {
    this.name = 'static-server';
    this.server = null;
    this.port = null;
    this.basePath = null;
  }

  /**
   * Initialize the plugin
   * @param {string} basePath - Base path for the application
   */
  async init(basePath) {
    this.basePath = basePath;
    this.port = await this._createServer();
    console.log(`StaticServerPlugin initialized on port ${this.port}`);
  }

  /**
   * Modify app.json content to update www/build-manifest.json base_url
   * @param {string} content - Original app.json content
   * @returns {string} - Modified app.json content
   */
  _modifyAppJson(content) {
    try {
      const appData = JSON.parse(content);
      
      // Find and modify the www/build-manifest.json entry
      for (const item of appData) {
        if (item.name === 'www/build-manifest.json' && item.type === 'text') {
          try {
            const manifestData = JSON.parse(item.content);
            // Update base_url to point to the current server
            manifestData.base_url = [`http://localhost:${this.port}`];
            item.content = JSON.stringify(manifestData);
          } catch (manifestErr) {
            console.error('Failed to parse build-manifest.json content:', manifestErr);
          }
          break;
        }
      }
      
      return JSON.stringify(appData);
    } catch (err) {
      console.error('Failed to modify app.json:', err);
      return content;
    }
  }

  /**
   * Create HTTP server
   * @returns {Promise<number>} - The port number
   */
  _createServer() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Enable keep-alive for connection reuse
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=600');
        
        // Parse the URL and remove query string
        let filePath = req.url.split('?')[0];
        
        // Default to index.html
        if (filePath === '/') {
          filePath = '/index.html';
        }
        
        // Try assets folder first (for launchpad.html, etc.), then site folder
        let fullPath = path.join(this.basePath, 'assets', filePath);
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(this.basePath, 'site', filePath);
        }
        
        // Check if file exists first
        fs.stat(fullPath, (err, stats) => {
          if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
          }
          
          // Check if this is an app.json file that needs modification
          const isAppJson = filePath.endsWith('/app.json');
          
          // Set appropriate content type
          const mimeType = lookup(fullPath) || 'application/octet-stream';
          const headers = {
            'Content-Type': mimeType,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Service-Worker-Allowed': '/'
          };
          
          // For app.json files, we need to read, modify, and send
          // so we can't set Content-Length upfront
          if (!isAppJson) {
            headers['Content-Length'] = stats.size;
          }
          headers['Accept-Ranges'] = 'bytes';
          
          // Aggressive caching for WASM and static assets
          if (fullPath.endsWith('.wasm') || fullPath.endsWith('.data') || 
              fullPath.endsWith('.js') || fullPath.endsWith('.css') ||
              fullPath.includes('/packages/') || fullPath.includes('/webr/')) {
            headers['Cache-Control'] = 'public, max-age=31536000, immutable'; // 1 year cache
          } else if (fullPath.endsWith('-sw.js') || fullPath.includes('service-worker') || 
                     fullPath.includes('shinylive-sw')) {
            // Service workers need to check for updates
            headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
            headers['Service-Worker-Allowed'] = '/';
            headers['Content-Type'] = 'application/javascript';
            // Add CORS headers for module service workers
            headers['Access-Control-Allow-Origin'] = '*';
            headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
          } else if (isAppJson) {
            // app.json files should not be cached as they're dynamically modified
            headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
          } else {
            // HTML and other files - short cache
            headers['Cache-Control'] = 'public, max-age=3600'; // 1 hour
          }
          
          // Handle app.json files specially - read, modify, and send
          if (isAppJson) {
            fs.readFile(fullPath, 'utf8', (readErr, content) => {
              if (readErr) {
                console.error('Error reading app.json:', readErr);
                res.writeHead(500);
                res.end('Error reading file');
                return;
              }
              
              const modifiedContent = this._modifyAppJson(content);
              headers['Content-Length'] = Buffer.byteLength(modifiedContent, 'utf8');
              res.writeHead(200, headers);
              res.end(modifiedContent);
            });
            return;
          }
          
          res.writeHead(200, headers);
          
          // Use streaming for better performance on large files
          const readStream = fs.createReadStream(fullPath, { highWaterMark: 1024 * 1024 }); // 1MB chunks
          readStream.pipe(res);
          
          readStream.on('error', (streamErr) => {
            console.error('Stream error:', streamErr);
            if (!res.headersSent) {
              res.writeHead(500);
            }
            res.end();
          });
        });
      });
      
      // Increase server timeout and max header size for large file uploads
      this.server.timeout = 600000; // 10 minutes
      this.server.maxHeadersCount = 100;
      this.server.maxConnections = 1000; // Allow more concurrent connections
      this.server.keepAliveTimeout = 600000; // Keep connections alive for reuse
      
      this.server.listen(0, 'localhost', () => {
        const port = this.server.address().port;
        console.log(`Local server running on http://localhost:${port}`);
        resolve(port);
      });
    });
  }

  /**
   * Get server port
   * @returns {number} - The port number
   */
  getPort() {
    return this.port;
  }

  /**
   * Register IPC handlers
   * @param {ipcMain} ipcMain - Electron ipcMain
   */
  registerIPC(ipcMain) {
    ipcMain.handle('plugin:server:getPort', wrapHandler(async () => {
      return this.port;
    }));
  }

  /**
   * Cleanup on app quit
   */
  cleanup() {
    if (this.server) {
      this.server.close();
      console.log('Static server closed');
    }
  }
}

module.exports = StaticServerPlugin;
