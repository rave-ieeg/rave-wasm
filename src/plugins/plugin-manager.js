/**
 * Plugin Manager for registering and managing plugins
 */
class PluginManager {
  constructor() {
    this.plugins = new Map();
  }

  /**
   * Register a plugin
   * @param {string} name - Plugin name
   * @param {Object} plugin - Plugin instance
   */
  registerPlugin(name, plugin) {
    if (this.plugins.has(name)) {
      console.warn(`Plugin ${name} already registered, overwriting...`);
    }
    this.plugins.set(name, plugin);
    console.log(`Plugin registered: ${name}`);
  }

  /**
   * Initialize a plugin
   * @param {string} name - Plugin name
   * @param {...any} args - Arguments to pass to plugin.init()
   */
  async initPlugin(name, ...args) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (typeof plugin.init === 'function') {
      await plugin.init(...args);
    }
  }

  /**
   * Register IPC handlers for a plugin
   * @param {string} name - Plugin name
   * @param {ipcMain} ipcMain - Electron ipcMain
   */
  registerPluginIPC(name, ipcMain) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (typeof plugin.registerIPC === 'function') {
      plugin.registerIPC(ipcMain);
      console.log(`IPC handlers registered for plugin: ${name}`);
    }
  }

  /**
   * Register IPC handlers for all plugins
   * @param {ipcMain} ipcMain - Electron ipcMain
   */
  registerAllIPC(ipcMain) {
    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.registerIPC === 'function') {
        plugin.registerIPC(ipcMain);
        console.log(`IPC handlers registered for plugin: ${name}`);
      }
    }
  }

  /**
   * Get a plugin by name
   * @param {string} name - Plugin name
   * @returns {Object|null} - Plugin instance or null
   */
  getPlugin(name) {
    return this.plugins.get(name) || null;
  }

  /**
   * Cleanup all plugins
   */
  cleanup() {
    console.log('Cleaning up all plugins...');
    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.cleanup === 'function') {
        try {
          plugin.cleanup();
        } catch (err) {
          console.error(`Error cleaning up plugin ${name}:`, err);
        }
      }
    }
  }
}

module.exports = PluginManager;
