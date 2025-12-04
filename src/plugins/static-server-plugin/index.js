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
          
          // Set appropriate content type
          const mimeType = lookup(fullPath) || 'application/octet-stream';
          const headers = {
            'Content-Type': mimeType,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Service-Worker-Allowed': '/',
            'Content-Length': stats.size,
            'Accept-Ranges': 'bytes'
          };
          
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
          } else {
            // HTML and other files - short cache
            headers['Cache-Control'] = 'public, max-age=3600'; // 1 hour
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
