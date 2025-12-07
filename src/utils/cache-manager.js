const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { app } = require('electron');

/**
 * Cache Manager for lazy-downloading app data
 * Downloads and caches large data files (like brain models) to user's cache directory
 */
class CacheManager {
  constructor() {
    this.cacheDir = null;
    this.manifestCache = new Map(); // Cache loaded manifests
    this.downloadQueue = new Map(); // Track ongoing downloads
    this.baseUrl = null; // Remote base URL for downloads
  }

  /**
   * Initialize the cache manager
   * @param {string} baseUrl - Base URL for downloading assets (e.g., https://rave.wiki/rave-wasm)
   */
  init(baseUrl) {
    // Use a consistent cache directory across platforms
    // macOS: ~/Library/Application Support/rave-wasm/app-data
    // Windows: %APPDATA%/rave-wasm/app-data
    // Linux: ~/.config/rave-wasm/app-data
    const userDataPath = app.getPath('appData'); // Gets the per-user app data directory
    this.cacheDir = path.join(userDataPath, 'rave-wasm', 'app-data');
    this.baseUrl = baseUrl || 'https://rave.wiki/rave-wasm';
    
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    console.log(`CacheManager initialized: ${this.cacheDir}`);
    console.log(`Remote base URL: ${this.baseUrl}`);
  }

  /**
   * Get the cache directory path
   * @returns {string}
   */
  getCacheDir() {
    return this.cacheDir;
  }

  /**
   * Get the full path for a cached file
   * @param {string} relativePath - Path relative to app-data (e.g., "freesurfer-models/fsaverage/surf/lh.pial")
   * @returns {string}
   */
  getCachedFilePath(relativePath) {
    return path.join(this.cacheDir, relativePath);
  }

  /**
   * Check if a file exists in cache
   * @param {string} relativePath - Path relative to app-data
   * @returns {boolean}
   */
  isFileCached(relativePath) {
    const filePath = this.getCachedFilePath(relativePath);
    return fs.existsSync(filePath);
  }

  /**
   * Load a manifest file (from bundled assets or cache)
   * @param {string} manifestName - e.g., "fsaverage_manifest.json"
   * @param {string} basePath - Base path of the application
   * @returns {Promise<object|null>}
   */
  async loadManifest(manifestName, basePath) {
    // Check cache first
    if (this.manifestCache.has(manifestName)) {
      return this.manifestCache.get(manifestName);
    }

    // Try to load from bundled site/app-data first
    const bundledPath = path.join(basePath, 'site', 'app-data', 'freesurfer-models', manifestName);
    const cachedManifestPath = path.join(this.cacheDir, 'freesurfer-models', manifestName);
    
    let manifest = null;
    
    // Try bundled location
    if (fs.existsSync(bundledPath)) {
      try {
        const content = fs.readFileSync(bundledPath, 'utf8');
        manifest = JSON.parse(content);
      } catch (err) {
        console.error(`Failed to load bundled manifest ${manifestName}:`, err);
      }
    }
    
    // Try cached location
    if (!manifest && fs.existsSync(cachedManifestPath)) {
      try {
        const content = fs.readFileSync(cachedManifestPath, 'utf8');
        manifest = JSON.parse(content);
      } catch (err) {
        console.error(`Failed to load cached manifest ${manifestName}:`, err);
      }
    }
    
    // Try to download from remote
    if (!manifest) {
      try {
        manifest = await this.downloadManifest(manifestName);
      } catch (err) {
        console.error(`Failed to download manifest ${manifestName}:`, err);
      }
    }

    if (manifest) {
      this.manifestCache.set(manifestName, manifest);
    }
    
    return manifest;
  }

  /**
   * Download a manifest file from remote
   * @param {string} manifestName 
   * @returns {Promise<object>}
   */
  async downloadManifest(manifestName) {
    const url = `${this.baseUrl}/app-data/freesurfer-models/${manifestName}`;
    const content = await this._downloadToString(url);
    const manifest = JSON.parse(content);
    
    // Cache the manifest locally
    const cachedPath = path.join(this.cacheDir, 'freesurfer-models', manifestName);
    const dir = path.dirname(cachedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachedPath, content);
    
    return manifest;
  }

  /**
   * Download a file to string
   * @param {string} url 
   * @returns {Promise<string>}
   */
  _downloadToString(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          this._downloadToString(res.headers.location).then(resolve).catch(reject);
          return;
        }
        
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Download a file from remote to cache
   * @param {string} relativePath - Path relative to app-data
   * @param {function} onProgress - Progress callback (received, total) => void
   * @returns {Promise<string>} - Path to the cached file
   */
  async downloadFile(relativePath, onProgress = null) {
    const cachedPath = this.getCachedFilePath(relativePath);
    
    // Check if already downloading
    if (this.downloadQueue.has(relativePath)) {
      return this.downloadQueue.get(relativePath);
    }
    
    // Check if already cached
    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }
    
    // Ensure directory exists
    const dir = path.dirname(cachedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create download promise
    const downloadPromise = new Promise((resolve, reject) => {
      const url = `${this.baseUrl}/app-data/${relativePath}`;
      const protocol = url.startsWith('https') ? https : http;
      
      console.log(`Downloading: ${url}`);
      
      const request = protocol.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          const redirectUrl = res.headers.location;
          this._downloadToFile(redirectUrl, cachedPath, onProgress)
            .then(() => resolve(cachedPath))
            .catch(reject);
          return;
        }
        
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        
        const totalSize = parseInt(res.headers['content-length'], 10) || 0;
        let receivedSize = 0;
        
        const writeStream = fs.createWriteStream(cachedPath);
        
        res.on('data', (chunk) => {
          receivedSize += chunk.length;
          if (onProgress && totalSize > 0) {
            onProgress(receivedSize, totalSize);
          }
        });
        
        res.pipe(writeStream);
        
        writeStream.on('finish', () => {
          console.log(`Downloaded: ${relativePath}`);
          resolve(cachedPath);
        });
        
        writeStream.on('error', (err) => {
          fs.unlink(cachedPath, () => {}); // Clean up partial file
          reject(err);
        });
        
        res.on('error', (err) => {
          writeStream.close();
          fs.unlink(cachedPath, () => {}); // Clean up partial file
          reject(err);
        });
      });
      
      request.on('error', reject);
    });
    
    // Track the download
    this.downloadQueue.set(relativePath, downloadPromise);
    
    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.downloadQueue.delete(relativePath);
    }
  }

  /**
   * Helper to download to file with redirect support
   */
  _downloadToFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          this._downloadToFile(res.headers.location, destPath, onProgress)
            .then(resolve)
            .catch(reject);
          return;
        }
        
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        
        const totalSize = parseInt(res.headers['content-length'], 10) || 0;
        let receivedSize = 0;
        
        const writeStream = fs.createWriteStream(destPath);
        
        res.on('data', (chunk) => {
          receivedSize += chunk.length;
          if (onProgress && totalSize > 0) {
            onProgress(receivedSize, totalSize);
          }
        });
        
        res.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Ensure all files from a manifest are cached
   * @param {object} manifest - The manifest object
   * @param {function} onProgress - Progress callback (fileIndex, totalFiles, fileName) => void
   * @returns {Promise<void>}
   */
  async ensureManifestCached(manifest, onProgress = null) {
    if (!manifest || !manifest.files) {
      return;
    }
    
    const totalFiles = manifest.files.length;
    let downloadedCount = 0;
    
    for (const file of manifest.files) {
      const relativePath = path.join(manifest.path, file.path);
      
      if (!this.isFileCached(relativePath)) {
        if (onProgress) {
          onProgress(downloadedCount, totalFiles, file.path);
        }
        
        await this.downloadFile(relativePath);
      }
      
      downloadedCount++;
    }
    
    if (onProgress) {
      onProgress(totalFiles, totalFiles, 'Complete');
    }
  }

  /**
   * Get cache statistics
   * @returns {object}
   */
  getCacheStats() {
    if (!this.cacheDir || !fs.existsSync(this.cacheDir)) {
      return { totalSize: 0, fileCount: 0 };
    }
    
    let totalSize = 0;
    let fileCount = 0;
    
    const walkDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          walkDir(filePath);
        } else {
          totalSize += stat.size;
          fileCount++;
        }
      }
    };
    
    walkDir(this.cacheDir);
    
    return { totalSize, fileCount };
  }

  /**
   * Clear the cache
   */
  clearCache() {
    if (this.cacheDir && fs.existsSync(this.cacheDir)) {
      fs.rmSync(this.cacheDir, { recursive: true, force: true });
      fs.mkdirSync(this.cacheDir, { recursive: true });
      this.manifestCache.clear();
      console.log('Cache cleared');
    }
  }
}

module.exports = CacheManager;
