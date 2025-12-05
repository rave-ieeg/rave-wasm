const RDetector = require('./r-detector');
const RSessionManager = require('./r-session-manager');
const { wrapHandler } = require('../../utils/ipc-helpers');

/**
 * R Plugin for managing R sessions and execution
 */
class RPlugin {
  constructor(configManager, portManager) {
    this.name = 'r-plugin';
    this.configManager = configManager;
    this.portManager = portManager;
    this.detector = new RDetector(configManager);
    this.sessionManager = new RSessionManager(portManager);
    this.onStatusChangedCallback = null;
  }

  /**
   * Initialize the plugin
   */
  async init() {
    console.log('RPlugin initializing...');
    
    // Start background R detection
    this.detector.startBackgroundDetection((result) => {
      console.log('R detected:', result);
      if (this.onStatusChangedCallback) {
        this.onStatusChangedCallback(result);
      }
    });
  }

  /**
   * Set callback for R status changes
   * @param {Function} callback - Callback function
   */
  setStatusChangedCallback(callback) {
    this.onStatusChangedCallback = callback;
  }

  /**
   * Register IPC handlers
   * @param {ipcMain} ipcMain - Electron ipcMain
   */
  registerIPC(ipcMain) {
    // Get R status
    ipcMain.handle('plugin:r:getStatus', wrapHandler(async () => {
      return await this.detector.getStatus();
    }));

    // Set custom R path
    ipcMain.handle('plugin:r:setCustomPath', wrapHandler(async (event, customPath) => {
      const result = await this.detector.setCustomPath(customPath);
      
      // Notify about status change
      if (result.valid && this.onStatusChangedCallback) {
        this.onStatusChangedCallback({
          detected: true,
          path: customPath,
          version: result.version
        });
      }
      
      return result;
    }));

    // Create R session
    ipcMain.handle('plugin:r:createSession', wrapHandler(async (event, sessionId) => {
      const status = await this.detector.getStatus();
      if (!status.detected) {
        return { success: false, error: 'R not detected' };
      }

      return await this.sessionManager.createSession(sessionId, status.path);
    }));

    // Execute R code
    ipcMain.handle('plugin:r:execute', wrapHandler(async (event, sessionId, code, timeout) => {
      return await this.sessionManager.execute(sessionId, code, timeout);
    }));

    // Get session status
    ipcMain.handle('plugin:r:getSessionStatus', wrapHandler(async (event, sessionId) => {
      return this.sessionManager.getSessionStatus(sessionId);
    }));

    // Terminate session
    ipcMain.handle('plugin:r:terminateSession', wrapHandler(async (event, sessionId) => {
      this.sessionManager.terminateSession(sessionId);
      return { success: true };
    }));

    // Get all sessions
    ipcMain.handle('plugin:r:getAllSessions', wrapHandler(async () => {
      return this.sessionManager.getAllSessions();
    }));

    // Start RAVE application
    ipcMain.handle('plugin:r:startRAVE', wrapHandler(async (event, sessionId) => {
      return await this.sessionManager.startRAVE(sessionId);
    }));

    // Install RAVE packages
    ipcMain.handle('plugin:r:installRAVE', wrapHandler(async () => {
      const status = await this.detector.getStatus();
      if (!status.detected) {
        return { success: false, error: 'R not detected' };
      }

      // Terminate all existing R sessions first
      console.log('Terminating all existing R sessions before installation...');
      this.sessionManager.terminateAll();

      // Create installation session
      const installSessionId = `install-${Date.now()}`;
      const sessionResult = await this.sessionManager.createSession(installSessionId, status.path);
      
      if (!sessionResult.success) {
        return { success: false, error: 'Failed to create R session for installation', sessionId: null };
      }

      // Return session ID so window can be opened
      return { success: true, sessionId: installSessionId, port: sessionResult.port };
    }));

    // Register console output callback
    ipcMain.handle('plugin:r:registerConsoleOutput', wrapHandler(async (event, sessionId) => {
      this.sessionManager.registerConsoleOutput(sessionId, (data) => {
        // Send output to renderer
        event.sender.send('plugin:r:consoleOutput', data);
      });
      return { success: true };
    }));

    // Execute RAVE installation commands
    ipcMain.handle('plugin:r:executeRAVEInstall', wrapHandler(async (event, sessionId) => {
      // Follow instructions from https://rave.wiki/posts/installation/installation.html
      const installScript = `
# RAVE Installation Script
# Following https://rave.wiki/posts/installation/installation.html

cat("\\n===== Step 1: Installing ravemanager =====\\n")
install.packages('ravemanager', repos = 'https://rave-ieeg.r-universe.dev')

cat("\\n===== Step 2: Running ravemanager::install() =====\\n")
ravemanager::install()

cat("\\nDone finalizing installations!\\n")
cat("\\nINSTALLATION_COMPLETE\\n")
`;

      try {
        const result = await this.sessionManager.execute(sessionId, installScript, 600000); // 10 minute timeout
        
        if (result.success && result.output.includes('INSTALLATION_COMPLETE')) {
          // Clean up session
          this.sessionManager.terminateSession(sessionId);
          
          // Re-check package status
          const newStatus = await this.detector.getStatus();
          if (this.onStatusChangedCallback) {
            this.onStatusChangedCallback(newStatus);
          }
          return { success: true, packages: newStatus.packages };
        } else {
          this.sessionManager.terminateSession(sessionId);
          return { success: false, error: result.error || 'Installation failed or timed out' };
        }
      } catch (err) {
        this.sessionManager.terminateSession(sessionId);
        return { success: false, error: err.message };
      }
    }));
  }

  /**
   * Cleanup on app quit
   */
  cleanup() {
    console.log('RPlugin cleaning up...');
    this.detector.stopDetection();
    this.sessionManager.terminateAll();
  }
}

module.exports = RPlugin;
