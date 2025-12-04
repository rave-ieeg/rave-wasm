const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Configuration Manager for persisting app settings
 */
class ConfigManager {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.configPath = path.join(this.userDataPath, 'config.json');
    this.cachePath = path.join(this.userDataPath, 'cache');
    this.dataPath = path.join(this.userDataPath, 'data');
    
    this.config = {};
    this.initialized = false;
  }

  /**
   * Initialize config manager and create necessary directories
   */
  async init() {
    if (this.initialized) return;

    // Create directories
    await this._ensureDir(this.userDataPath);
    await this._ensureDir(this.cachePath);
    await this._ensureDir(this.dataPath);

    // Load existing config
    await this.load();
    
    this.initialized = true;
    console.log('ConfigManager initialized');
    console.log('  Config path:', this.configPath);
    console.log('  Cache path:', this.cachePath);
    console.log('  Data path:', this.dataPath);
  }

  /**
   * Ensure directory exists
   * @param {string} dirPath - Directory path
   */
  async _ensureDir(dirPath) {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, { recursive: true }, (err) => {
        if (err && err.code !== 'EEXIST') {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Load configuration from file
   */
  async load() {
    return new Promise((resolve) => {
      fs.readFile(this.configPath, 'utf8', (err, data) => {
        if (err) {
          if (err.code === 'ENOENT') {
            // Config file doesn't exist yet
            this.config = {};
            resolve();
          } else {
            console.error('Error loading config:', err);
            this.config = {};
            resolve();
          }
        } else {
          try {
            this.config = JSON.parse(data);
            resolve();
          } catch (parseErr) {
            console.error('Error parsing config:', parseErr);
            this.config = {};
            resolve();
          }
        }
      });
    });
  }

  /**
   * Save configuration to file
   */
  async save() {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(this.config, null, 2);
      fs.writeFile(this.configPath, data, 'utf8', (err) => {
        if (err) {
          console.error('Error saving config:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} - Configuration value
   */
  get(key, defaultValue = null) {
    return this.config.hasOwnProperty(key) ? this.config[key] : defaultValue;
  }

  /**
   * Set a configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   */
  set(key, value) {
    this.config[key] = value;
  }

  /**
   * Delete a configuration key
   * @param {string} key - Configuration key
   */
  delete(key) {
    delete this.config[key];
  }

  /**
   * Get all paths
   * @returns {Object} - Object containing all paths
   */
  getPaths() {
    return {
      userData: this.userDataPath,
      config: this.configPath,
      cache: this.cachePath,
      data: this.dataPath
    };
  }

  /**
   * Clear cache directory
   */
  async clearCache() {
    return new Promise((resolve, reject) => {
      fs.rm(this.cachePath, { recursive: true, force: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          // Recreate the directory
          this._ensureDir(this.cachePath).then(resolve).catch(reject);
        }
      });
    });
  }
}

module.exports = ConfigManager;
