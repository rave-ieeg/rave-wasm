const RDetector = require('./r-detector');
const RSessionManager = require('./r-session-manager');
const ShellSessionManager = require('./shell-session-manager');
const RAVEInstaller = require('./rave-installer');
const { wrapHandler } = require('../../utils/ipc-helpers');

/**
 * R Plugin for managing R sessions and execution
 */
class RPlugin {
  constructor(configManager, portManager, cacheManager) {
    this.name = 'r-plugin';
    this.configManager = configManager;
    this.portManager = portManager;
    this.cacheManager = cacheManager;
    this.detector = new RDetector(configManager);
    this.sessionManager = new RSessionManager(portManager, this.detector);
    this.shellSessionManager = new ShellSessionManager();
    // Pass sessionManager and shellSessionManager for command execution
    this.installer = new RAVEInstaller(this.sessionManager, this.shellSessionManager);
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
      return await this.sessionManager.createSession(sessionId);
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
      // Terminate all existing R sessions first
      console.log('Terminating all existing R sessions before installation...');
      this.sessionManager.terminateAll();

      // Create installation session (sessionManager gets rPath from detector)
      const installSessionId = `install-${Date.now()}`;
      const sessionResult = await this.sessionManager.createSession(installSessionId);
      
      if (!sessionResult.success) {
        return { success: false, error: sessionResult.error || 'Failed to create R session for installation', sessionId: null };
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
      // Get install script from rave-installer
      const installScript = this.installer.getInstallScript();
      const timeout = this.installer.getInstallTimeout();

      try {
        const result = await this.sessionManager.execute(sessionId, installScript, timeout);
        
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

    // Check prerequisites before installation
    ipcMain.handle('plugin:r:checkPrerequisites', wrapHandler(async (event, forceCheck) => {
      try {
        // Always check prerequisites first - don't early-return if R is missing
        // The prerequisite check will build a comprehensive todoList including R installation
        const prereqResult = await this.installer.checkPrerequisites(forceCheck);
        
        const rPath = this.sessionManager.getRPath();
        
        // If R is detected, also install/update ravemanager (needed for Linux system_requirements)
        let ravemanagerVersion = null;
        if (rPath) {
          console.log('Installing/updating ravemanager before prerequisite check...');
          const ravemanagerResult = await this.installer.installRavemanager();
          
          if (!ravemanagerResult.success) {
            console.warn('Failed to install ravemanager:', ravemanagerResult.error);
            // Don't fail here, just warn - installation might still work
          } else {
            console.log('ravemanager version:', ravemanagerResult.version);
            ravemanagerVersion = ravemanagerResult.version;
          }
        }
        
        return {
          success: true,
          ...prereqResult,
          ravemanagerVersion
        };
      } catch (err) {
        console.error('Prerequisite check failed:', err);
        return {
          success: false,
          error: err.message,
          passed: true, // Don't block installation on error
          issues: [],
          commands: [],
          instructions: 'Could not verify prerequisites. Proceeding with installation.',
          platform: this.installer.platform
        };
      }
    }));

    // === Unified Installation IPC Handlers ===

    // Start unified installation (prerequisites + RAVE packages)
    ipcMain.handle('plugin:installer:start', wrapHandler(async (event) => {
      try {
        // Terminate all existing R sessions first
        console.log('Terminating all existing R sessions before installation...');
        this.sessionManager.terminateAll();

        // Set up progress broadcasting
        const onProgress = (progressEvent) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('plugin:installer:progress', progressEvent);
          }
        };

        // Start installation workflow
        const result = await this.installer.executeInstallation(onProgress);
        
        // Re-check R status after installation
        if (result.success) {
          const newStatus = await this.detector.getStatus();
          if (this.onStatusChangedCallback) {
            this.onStatusChangedCallback(newStatus);
          }
        }
        
        return result;
      } catch (err) {
        console.error('Installation failed:', err);
        return {
          success: false,
          error: err.message,
          completed: 0,
          failed: 0,
          skipped: 0,
          blocked: 0
        };
      }
    }));

    // Proceed with installation despite blocked/failed required step
    ipcMain.handle('plugin:installer:proceedAnyway', wrapHandler(async () => {
      this.installer.proceedAnyway();
      return { success: true };
    }));

    // Abort installation
    ipcMain.handle('plugin:installer:abort', wrapHandler(async () => {
      await this.installer.abort();
      return { success: true };
    }));

    // === Shell Session Manager IPC Handlers ===

    // Create shell session
    ipcMain.handle('plugin:shell:createSession', wrapHandler(async (event, sessionId, options) => {
      return await this.shellSessionManager.createSession(sessionId, options);
    }));

    // Execute shell/Rscript command
    ipcMain.handle('plugin:shell:execute', wrapHandler(async (event, sessionId, command, options) => {
      return await this.shellSessionManager.execute(sessionId, command, options);
    }));

    // Register shell output callback
    ipcMain.handle('plugin:shell:registerOutput', wrapHandler(async (event, sessionId) => {
      this.shellSessionManager.registerOutputCallback(sessionId, (output) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('plugin:shell:output', { sessionId, output });
        }
      });
      return { success: true };
    }));

    // Terminate shell session
    ipcMain.handle('plugin:shell:terminate', wrapHandler(async (event, sessionId) => {
      this.shellSessionManager.terminateSession(sessionId);
      return { success: true };
    }));

    // Respond to command prompt
    ipcMain.handle('plugin:shell:respondToCommandPrompt', wrapHandler(async (event, sessionId, response) => {
      this.shellSessionManager.respondToCommandPrompt(sessionId, response);
      return { success: true };
    }));
  }

  /**
   * Cleanup on app quit
   */
  cleanup() {
    console.log('RPlugin cleaning up...');
    this.detector.stopDetection();
    this.sessionManager.terminateAll();
    this.shellSessionManager.terminateAll();
    this.installer.abort();
  }
}

module.exports = RPlugin;
