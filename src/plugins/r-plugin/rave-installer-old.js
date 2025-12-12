const { spawn } = require('child_process');
const os = require('os');

/**
 * RAVE Installer for managing prerequisites and installation
 * Handles prerequisite checks for macOS, Windows, and Linux
 * 
 * Uses cacheManager for storing prerequisite check results (cached data).
 * Prerequisite caches are stored under the app-data/json-cache directory
 * and will be cleared when user clicks "Clear Cache".
 * 
 * Uses sessionManager for R execution in headless mode (no UI dialogs).
 */
class RAVEInstaller {
  constructor(cacheManager, sessionManager) {
    this.cacheManager = cacheManager;
    this.sessionManager = sessionManager;
    this.platform = process.platform;
    this.osVersion = os.release();
    // Secure in-memory password storage (never written to disk)
    this._sudoPassword = null;
    this._passwordTimeout = null;
    // Chain control
    this._chainSkipSignal = null;
    this._chainAborted = false;
  }

  /**
   * Get cache key for prerequisite results
   * Includes platform and OS version to invalidate when OS is upgraded
   * @returns {string}
   */
  _getCacheKey() {
    return `prerequisites-${this.platform}-${this.osVersion}`;
  }

  /**
   * Get cached prerequisite results if valid
   * Only passed results are cached (for 1 day)
   * Failed results are never cached so users can fix and retry
   * @returns {Object|null}
   */
  _getCachedPrerequisites() {
    const cacheKey = this._getCacheKey();
    const cached = this.cacheManager.getJsonCache(cacheKey);
    if (cached && cached.timestamp && cached.passed) {
      // Cache is valid for 1 day (only for passed results)
      const age = Date.now() - cached.timestamp;
      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (age < ONE_DAY) {
        return cached;
      }
    }
    return null;
  }

  /**
   * Save prerequisite results to cache
   * Only caches passed results - failed results should not be cached
   * so users can fix issues and retry without waiting for cache expiration
   * @param {Object} result
   */
  _cachePrerequisites(result) {
    // Only cache if prerequisites passed
    if (!result.passed) {
      console.log('Prerequisites check failed - not caching result');
      return;
    }
    
    const cacheKey = this._getCacheKey();
    const cacheData = {
      ...result,
      timestamp: Date.now(),
      osVersion: this.osVersion
    };
    this.cacheManager.setJsonCache(cacheKey, cacheData);
    console.log('Prerequisites check passed - cached for 1 day');
  }

  /**
   * Clear prerequisite cache (force re-check)
   */
  clearCache() {
    const cacheKey = this._getCacheKey();
    this.cacheManager.removeJsonCache(cacheKey);
  }

  /**
   * Prompt for sudo password using macOS native dialog
   * @returns {Promise<{success: boolean, password: string|null, error: string|null}>}
   */
  async _promptForPassword() {
    if (this.platform !== 'darwin') {
      return { success: false, password: null, error: 'Password prompt only supported on macOS' };
    }

    return new Promise((resolve) => {
      const script = `osascript -e 'display dialog "RAVE installation requires administrator access to install system dependencies." with title "Administrator Password Required" default answer "" with icon caution with hidden answer' -e 'text returned of result'`;
      
      const proc = spawn('sh', ['-c', script], { windowsHide: true });
      
      let output = '';
      let errorOutput = '';
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const password = output.trim();
          resolve({ success: true, password, error: null });
        } else {
          resolve({ success: false, password: null, error: 'Password prompt cancelled' });
        }
      });
      
      proc.on('error', (err) => {
        resolve({ success: false, password: null, error: err.message });
      });
      
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, password: null, error: 'Password prompt timeout' });
      }, 120000); // 2 minute timeout for password entry
    });
  }

  /**
   * Verify sudo password is correct
   * @param {string} password - Password to verify
   * @returns {Promise<boolean>}
   */
  async _verifyPassword(password) {
    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', `echo "${password}" | sudo -S true 2>&1`], { windowsHide: true });
      
      let output = '';
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('close', (code) => {
        // Check if password was accepted (no "Sorry" message)
        const isValid = code === 0 && !output.toLowerCase().includes('sorry');
        resolve(isValid);
      });
      
      proc.on('error', () => {
        resolve(false);
      });
      
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Clear sudo password from memory and stop timeout
   */
  _clearPassword() {
    if (this._sudoPassword) {
      // Overwrite password string in memory
      this._sudoPassword = null;
    }
    if (this._passwordTimeout) {
      clearTimeout(this._passwordTimeout);
      this._passwordTimeout = null;
    }
    console.log('Sudo password cleared from memory');
  }

  /**
   * Start 30-minute timeout to auto-clear password
   */
  _startPasswordTimeout() {
    if (this._passwordTimeout) {
      clearTimeout(this._passwordTimeout);
    }
    this._passwordTimeout = setTimeout(() => {
      console.log('Password timeout - clearing from memory');
      this._clearPassword();
    }, 30 * 60 * 1000); // 30 minutes
  }

  /**
   * Check if R is installed
   * @returns {Promise<{installed: boolean, version: string|null, path: string|null}>}
   */
  async _checkR() {
    try {
      const status = await this.sessionManager.detector.getStatus();
      return {
        installed: status.detected,
        version: status.version,
        path: status.path
      };
    } catch (err) {
      console.error('Failed to check R installation:', err);
      return { installed: false, version: null, path: null };
    }
  }

  /**
   * Check if RStudio is installed (optional)
   * @returns {Promise<{installed: boolean, version: string|null}>}
   */
  async _checkRStudio() {
    return new Promise((resolve) => {
      if (this.platform === 'darwin') {
        // First check common installation paths
        const fs = require('fs');
        const commonPaths = [
          '/Applications/RStudio.app',
          '/Applications/Posit/RStudio.app',
          `${require('os').homedir()}/Applications/RStudio.app`
        ];
        
        for (const path of commonPaths) {
          try {
            if (fs.existsSync(path)) {
              resolve({ installed: true, version: null });
              return;
            }
          } catch (err) {
            // Continue checking other paths
          }
        }
        
        // If not found in common paths, try Spotlight search
        const proc = spawn('mdfind', ['kMDItemCFBundleIdentifier == "org.rstudio.RStudio"'], { windowsHide: true });
        
        let output = '';
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          resolve({ installed: code === 0 && output.trim().length > 0, version: null });
        });

        proc.on('error', () => {
          resolve({ installed: false, version: null });
        });

        setTimeout(() => {
          proc.kill();
          resolve({ installed: false, version: null });
        }, 5000);
      } else if (this.platform === 'win32') {
        // Check common RStudio paths on Windows
        const fs = require('fs');
        const rstudioPaths = [
          'C:\\Program Files\\RStudio\\rstudio.exe',
          'C:\\Program Files (x86)\\RStudio\\rstudio.exe'
        ];
        const installed = rstudioPaths.some(p => {
          try {
            return fs.existsSync(p);
          } catch {
            return false;
          }
        });
        resolve({ installed, version: null });
      } else {
        // Linux - check if rstudio is in PATH
        const proc = spawn('which', ['rstudio'], { windowsHide: true });
        
        let output = '';
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          resolve({ installed: code === 0 && output.trim().length > 0, version: null });
        });

        proc.on('error', () => {
          resolve({ installed: false, version: null });
        });

        setTimeout(() => {
          proc.kill();
          resolve({ installed: false, version: null });
        }, 5000);
      }
    });
  }

  /**
   * Check if RAVE packages are installed
   * @returns {Promise<{installed: boolean, version: string|null}>}
   */
  async _checkRAVEPackages() {
    const sessionId = `rave-check-${Date.now()}`;
    
    try {
      const sessionResult = await this.sessionManager.createSession(sessionId, null, { headless: true });
      if (!sessionResult.success) {
        return { installed: false, version: null };
      }

      const checkCode = `
tryCatch({
  if(require('rave', quietly = TRUE)) {
    cat('RAVE_INSTALLED:', as.character(packageVersion('rave')), '\\n')
  } else {
    cat('RAVE_NOT_FOUND\\n')
  }
}, error = function(e) {
  cat('RAVE_NOT_FOUND\\n')
})
`;

      const result = await this.sessionManager.execute(sessionId, checkCode, 30000);
      this.sessionManager.terminateSession(sessionId);

      if (result.success && result.output) {
        if (result.output.includes('RAVE_INSTALLED:')) {
          const match = result.output.match(/RAVE_INSTALLED:\s*(\S+)/);
          const version = match ? match[1] : 'unknown';
          return { installed: true, version };
        }
      }
      
      return { installed: false, version: null };
    } catch (err) {
      this.sessionManager.terminateSession(sessionId);
      console.error('Failed to check RAVE packages:', err);
      return { installed: false, version: null };
    }
  }

  /**
   * Install or update ravemanager package using sessionManager
   * Uses sessionManager.getRPath() for R executable path
   * @returns {Promise<{success: boolean, version: string|null, error: string|null}>}
   */
  async installRavemanager() {
    const sessionId = `ravemanager-install-${Date.now()}`;
    
    try {
      // Create headless session (sessionManager gets rPath from detector)
      const sessionResult = await this.sessionManager.createSession(sessionId, null, { headless: true });
      if (!sessionResult.success) {
        return { success: false, version: null, error: sessionResult.error };
      }

      console.log('Installing/updating ravemanager package...');
      
      const installCode = `
tryCatch({
  install.packages('ravemanager', repos = 'https://rave-ieeg.r-universe.dev', quiet = TRUE)
  if(require('ravemanager', quietly = TRUE)) {
    cat('RAVEMANAGER_INSTALLED:', as.character(packageVersion('ravemanager')), '\\n')
  } else {
    cat('RAVEMANAGER_FAILED\\n')
  }
}, error = function(e) {
  cat('RAVEMANAGER_ERROR:', e$message, '\\n')
})
`;

      // Execute with 3 minute timeout
      const result = await this.sessionManager.execute(sessionId, installCode, 180000);
      
      // Clean up session
      this.sessionManager.terminateSession(sessionId);

      if (result.success && result.output) {
        if (result.output.includes('RAVEMANAGER_INSTALLED:')) {
          const match = result.output.match(/RAVEMANAGER_INSTALLED:\s*(\S+)/);
          const version = match ? match[1] : 'unknown';
          console.log('ravemanager installed successfully, version:', version);
          return { success: true, version, error: null };
        } else if (result.output.includes('RAVEMANAGER_ERROR:')) {
          const match = result.output.match(/RAVEMANAGER_ERROR:\s*(.+)/);
          const error = match ? match[1] : 'Unknown error';
          console.error('ravemanager installation error:', error);
          return { success: false, version: null, error };
        } else if (result.output.includes('RAVEMANAGER_FAILED')) {
          return { success: false, version: null, error: 'Failed to load ravemanager after installation' };
        }
      }
      
      return { success: false, version: null, error: result.error || 'Installation failed' };
    } catch (err) {
      // Clean up session on error
      this.sessionManager.terminateSession(sessionId);
      console.error('Failed to install ravemanager:', err);
      return { success: false, version: null, error: err.message };
    }
  }

  /**
   * Get the RAVE installation script
   * Following instructions from https://rave.wiki/posts/installation/installation.html
   * @returns {string}
   */
  getInstallScript() {
    return `
# RAVE Installation Script
# Following https://rave.wiki/posts/installation/installation.html

cat("\\n===== Step 1: Installing ravemanager =====\\n")
install.packages('ravemanager', repos = 'https://rave-ieeg.r-universe.dev')

cat("\\n===== Step 2: Running ravemanager::install() =====\\n")
ravemanager::install()

cat("\\nDone finalizing installations!\\n")
cat("\\nINSTALLATION_COMPLETE\\n")
`;
  }

  /**
   * Get the installation timeout in milliseconds
   * @returns {number}
   */
  getInstallTimeout() {
    return 600000; // 10 minutes
  }

  /**
   * Open Terminal.app and execute a chain of commands (macOS only)
   * Commands run in the same terminal window to reuse sudo authentication
   * @param {Array} commands - Array of {command: string, label: string}
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async openTerminalForCommandChain(commands) {
    if (this.platform !== 'darwin') {
      return { success: false, message: 'Terminal.app only available on macOS' };
    }

    return new Promise((resolve) => {
      // Build a script that runs all commands in sequence with && (stops on first failure)
      const commandScript = commands.map((cmd, idx) => {
        const safeCmd = cmd.command.replace(/'/g, "'\\''" ); // Escape single quotes for shell
        return `echo "\\n==== Step ${idx + 1}: ${cmd.label} ===="; ${safeCmd}`;
      }).join(' && ');
      
      // Final script with completion message
      const finalScript = `${commandScript} && echo "\\n==== All installations complete! ====" && echo "You can close this window." || echo "\\n==== Installation failed. Please check the errors above. ===="; read -p "Press Enter to close this window..."`;
      
      // Create AppleScript to open Terminal and run the command chain
      const appleScript = `
tell application "Terminal"
  activate
  do script "${finalScript.replace(/"/g, '\\"')}"
end tell
`;
      
      const proc = spawn('osascript', ['-e', appleScript], { windowsHide: true });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ 
            success: true, 
            message: `Terminal opened with ${commands.length} installation steps. Please complete the installation in the Terminal window.` 
          });
        } else {
          resolve({ 
            success: false, 
            message: `Failed to open Terminal for installation chain` 
          });
        }
      });
      
      proc.on('error', (err) => {
        resolve({ 
          success: false, 
          message: `Error opening Terminal: ${err.message}` 
        });
      });
      
      setTimeout(() => {
        proc.kill();
        resolve({ 
          success: false, 
          message: 'Timeout opening Terminal' 
        });
      }, 5000);
    });
  }

  /**
   * Execute a shell command with progress tracking and sudo support
   * @param {Object} options - Command options
   * @param {string} options.command - Command to execute
   * @param {string} options.label - Display label for progress
   * @param {boolean} options.sudo - Whether command requires sudo
   * @param {string} options.password - Sudo password (if sudo=true)
   * @param {Object} options.env - Additional environment variables
   * @param {Function} onProgress - Progress callback(event)
   * @returns {Promise<{success: boolean, output: string, error: string|null, fullLog: string}>}
   */
  async executeCommand(options, onProgress = null) {
    const { command, label, sudo = false, password = null, env = {} } = options;
    
    console.log(`[executeCommand] Starting: ${label}`);
    
    const timestamp = () => new Date().toISOString();
    const fullLog = [];
    
    // Emit start event
    if (onProgress) {
      onProgress({ type: 'start', label, data: command, timestamp: timestamp() });
    }
    
    return new Promise((resolve) => {
      let cmdToRun = command;
      const cmdEnv = { ...process.env, ...env };
      
      // Handle sudo commands
      if (sudo && password) {
        // Use sudo -S to read password from stdin
        cmdToRun = `echo "${password}" | sudo -S ${command}`;
      }
      
      const proc = spawn('sh', ['-c', cmdToRun], {
        windowsHide: true,
        env: cmdEnv
      });
      
      let output = '';
      let errorOutput = '';
      
      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        fullLog.push({ type: 'stdout', data: chunk, timestamp: timestamp() });
        
        if (onProgress) {
          onProgress({ type: 'stdout', label, data: chunk, timestamp: timestamp() });
        }
      });
      
      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        fullLog.push({ type: 'stderr', data: chunk, timestamp: timestamp() });
        
        if (onProgress) {
          onProgress({ type: 'stderr', label, data: chunk, timestamp: timestamp() });
        }
      });
      
      proc.on('close', (code) => {
        const success = code === 0;
        const error = success ? null : (errorOutput || `Command failed with exit code ${code}`);
        
        console.log(`[executeCommand] ${label} finished with code ${code}`);
        
        if (onProgress) {
          const eventType = success ? 'complete' : 'error';
          onProgress({ 
            type: eventType, 
            label, 
            data: success ? output : error, 
            timestamp: timestamp() 
          });
        }
        
        resolve({
          success,
          output,
          error,
          fullLog: JSON.stringify(fullLog, null, 2)
        });
      });
      
      proc.on('error', (err) => {
        console.error(`[executeCommand] ${label} error:`, err);
        const error = err.message;
        fullLog.push({ type: 'error', data: error, timestamp: timestamp() });
        
        if (onProgress) {
          onProgress({ type: 'error', label, data: error, timestamp: timestamp() });
        }
        
        resolve({
          success: false,
          output,
          error,
          fullLog: JSON.stringify(fullLog, null, 2)
        });
      });
      
      // 30 minute timeout per command
      setTimeout(() => {
        console.warn(`[executeCommand] ${label} timeout after 30 minutes`);
        proc.kill();
        const error = 'Command timeout after 30 minutes';
        fullLog.push({ type: 'error', data: error, timestamp: timestamp() });
        
        if (onProgress) {
          onProgress({ type: 'error', label, data: error, timestamp: timestamp() });
        }
        
        resolve({
          success: false,
          output,
          error,
          fullLog: JSON.stringify(fullLog, null, 2)
        });
      }, 30 * 60 * 1000);
    });
  }

  /**
   * Execute a chain of commands with auto-chain and smart error handling
   * @param {Array} todoList - List of todo items from checkPrerequisites
   * @param {Function} onProgress - Progress callback(event)
   * @returns {Promise<{success: boolean, completed: number, failed: number, skipped: number}>}
   */
  async executeCommandChain(todoList, onProgress = null) {
    console.log('[executeCommandChain] Starting chain with', todoList.length, 'items');
    
    this._chainAborted = false;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    
    // Emit chain start
    if (onProgress) {
      onProgress({
        type: 'chain-start',
        data: { todoList, total: todoList.length },
        timestamp: new Date().toISOString()
      });
    }
    
    try {
      // Filter items that need installation
      const pendingItems = todoList.filter(item => 
        item.status === 'pending' && item.command
      );
      
      // Check if we have brew commands on macOS
      const hasBrewCommands = this.platform === 'darwin' && 
        pendingItems.some(item => 
          item.command && (item.command.includes('brew') || item.command.includes('curl'))
        );
      
      if (hasBrewCommands) {
        // Open Terminal.app with all brew commands chained
        console.log('[executeCommandChain] Opening Terminal.app for brew installations');
        
        const brewCommands = pendingItems
          .filter(item => item.command && (item.command.includes('brew') || item.command.includes('curl')))
          .map(item => ({
            command: item.command,
            label: item.label
          }));
        
        if (onProgress) {
          onProgress({
            type: 'terminal-open',
            data: { 
              message: 'Opening Terminal.app for installation...',
              commands: brewCommands 
            },
            timestamp: new Date().toISOString()
          });
        }
        
        const result = await this.openTerminalForCommandChain(brewCommands);
        
        if (result.success) {
          // Mark all brew items as success (user completes in Terminal)
          for (const item of todoList) {
            if (item.command && (item.command.includes('brew') || item.command.includes('curl'))) {
              item.status = 'success';
              item.output = 'Installation completed in Terminal.app';
              completed++;
            }
          }
          
          if (onProgress) {
            onProgress({
              type: 'terminal-success',
              data: { message: result.message },
              timestamp: new Date().toISOString()
            });
          }
        } else {
          // Terminal failed to open
          if (onProgress) {
            onProgress({
              type: 'terminal-error',
              data: { message: result.message },
              timestamp: new Date().toISOString()
            });
          }
          
          return { success: false, completed: 0, failed: 1, skipped: 0 };
        }
      } else {
        // Non-brew commands - use original spawn-based execution
        for (let i = 0; i < todoList.length; i++) {
          if (this._chainAborted) {
            console.log('[executeCommandChain] Chain aborted by user');
            break;
          }
          
          const item = todoList[i];
        
        // Skip items that are already installed or have no command
        if (item.status === 'installed' || !item.command) {
          console.log(`[executeCommandChain] Skipping ${item.id} - already installed or no command`);
          item.status = 'success';
          completed++;
          continue;
        }
        
        console.log(`[executeCommandChain] Processing ${item.id}: ${item.label}`);
        
        // Update status to running
        item.status = 'running';
        if (onProgress) {
          onProgress({
            type: 'step-start',
            data: { item, index: i, total: todoList.length },
            timestamp: new Date().toISOString()
          });
        }
        
        // Execute command
        const result = await this.executeCommand(
          {
            command: item.command,
            label: item.label,
            sudo: item.sudo || false,
            password: this._sudoPassword,
            env: item.useNonInteractive ? { NONINTERACTIVE: '1' } : {}
          },
          onProgress
        );
        
        if (result.success) {
          // Success - continue to next item
          item.status = 'success';
          item.output = result.output;
          completed++;
          
          console.log(`[executeCommandChain] ${item.id} succeeded`);
          
          if (onProgress) {
            onProgress({
              type: 'step-complete',
              data: { item, index: i, total: todoList.length },
              timestamp: new Date().toISOString()
            });
          }
        } else {
          // Failure - handle based on whether item is optional or required
          item.output = result.output;
          item.error = result.error;
          item.fullLog = result.fullLog;
          
          if (!item.required) {
            // Optional item failed - auto-skip and continue
            item.status = 'skipped';
            skipped++;
            
            console.warn(`[executeCommandChain] ${item.id} failed (optional) - auto-skipping:`, result.error);
            
            if (onProgress) {
              onProgress({
                type: 'step-skipped',
                data: { 
                  item, 
                  index: i, 
                  total: todoList.length,
                  reason: result.error 
                },
                timestamp: new Date().toISOString()
              });
            }
            
            // Continue to next item automatically
            continue;
          } else {
            // Required item failed - pause and wait for user to skip
            item.status = 'failed';
            failed++;
            
            console.error(`[executeCommandChain] ${item.id} failed (required) - pausing:`, result.error);
            
            if (onProgress) {
              onProgress({
                type: 'step-failed',
                data: {
                  item,
                  index: i,
                  total: todoList.length,
                  error: result.error,
                  fullLog: result.fullLog,
                  manualInstructions: item.manualInstructions
                },
                timestamp: new Date().toISOString()
              });
            }
            
            // Wait for skip signal from user
            console.log(`[executeCommandChain] Waiting for skip signal for ${item.id}...`);
            await this._waitForSkipSignal();
            
            if (this._chainAborted) {
              console.log('[executeCommandChain] Chain aborted during pause');
              break;
            }
            
            console.log(`[executeCommandChain] Skip signal received for ${item.id} - continuing`);
          }
        }
        }
      }
      
      // Chain complete
      const success = failed === 0 && !this._chainAborted;
      
      console.log('[executeCommandChain] Chain finished:', { completed, failed, skipped, aborted: this._chainAborted });
      
      if (onProgress) {
        onProgress({
          type: 'chain-complete',
          data: { 
            success,
            completed,
            failed,
            skipped,
            aborted: this._chainAborted,
            todoList
          },
          timestamp: new Date().toISOString()
        });
      }
      
      return { success, completed, failed, skipped };
      
    } finally {
      // Always clear password when chain completes, errors, or is aborted
      this._clearPassword();
    }
  }

  /**
   * Wait for skip signal from UI
   * @returns {Promise<void>}
   */
  _waitForSkipSignal() {
    return new Promise((resolve) => {
      this._chainSkipSignal = resolve;
    });
  }

  /**
   * Signal to skip current failed step (called from IPC)
   */
  skipCurrentStep() {
    if (this._chainSkipSignal) {
      console.log('[skipCurrentStep] Resolving skip signal');
      this._chainSkipSignal();
      this._chainSkipSignal = null;
    }
  }

  /**
   * Abort the command chain (called from IPC)
   */
  abortChain() {
    console.log('[abortChain] Aborting chain');
    this._chainAborted = true;
    if (this._chainSkipSignal) {
      this._chainSkipSignal();
      this._chainSkipSignal = null;
    }
    this._clearPassword();
  }

  /**
   * Check if Homebrew is installed (macOS)
   * @returns {Promise<{installed: boolean, version: string|null}>}
   */
  async _checkHomebrew() {
    return new Promise((resolve) => {
      const brew = spawn('brew', ['--version'], { windowsHide: true });
      
      let output = '';
      brew.stdout.on('data', (data) => {
        output += data.toString();
      });

      brew.on('close', (code) => {
        if (code === 0 && output.includes('Homebrew')) {
          const match = output.match(/Homebrew\s+(\d+\.\d+\.\d+)/);
          resolve({ installed: true, version: match ? match[1] : 'unknown' });
        } else {
          resolve({ installed: false, version: null });
        }
      });

      brew.on('error', () => {
        resolve({ installed: false, version: null });
      });

      setTimeout(() => {
        brew.kill();
        resolve({ installed: false, version: null });
      }, 5000);
    });
  }

  /**
   * Check which brew packages are installed (macOS)
   * @param {string[]} packages - Package names to check
   * @returns {Promise<{installed: string[], missing: string[]}>}
   */
  async _checkBrewPackages(packages) {
    return new Promise((resolve) => {
      const brew = spawn('brew', ['list', '--formula'], { windowsHide: true });
      
      let output = '';
      brew.stdout.on('data', (data) => {
        output += data.toString();
      });

      brew.on('close', (code) => {
        if (code === 0) {
          const installedPackages = output.split(/\s+/).map(p => p.trim().toLowerCase());
          const installed = [];
          const missing = [];
          
          // Aliases for package names (some packages have multiple names)
          const aliases = {
            'pkgconf': ['pkgconf', 'pkg-config'],
            // 'pkg-config': ['pkgconf', 'pkg-config']
          };
          
          for (const pkg of packages) {
            const pkgLower = pkg.toLowerCase();
            const namesToCheck = aliases[pkgLower] || [pkgLower];
            
            const isInstalled = namesToCheck.some(name => 
              installedPackages.some(p => p.startsWith(name))
            );
            
            if (isInstalled) {
              installed.push(pkg);
            } else {
              missing.push(pkg);
            }
          }
          
          resolve({ installed, missing });
        } else {
          // If brew list fails, assume all are missing
          resolve({ installed: [], missing: packages });
        }
      });

      brew.on('error', () => {
        resolve({ installed: [], missing: packages });
      });

      setTimeout(() => {
        brew.kill();
        resolve({ installed: [], missing: packages });
      }, 10000);
    });
  }

  /**
   * Check macOS prerequisites with comprehensive TODO list
   * @returns {Promise<Object>}
   */
  async _checkMacOSPrerequisites() {
    const todoList = [];
    let allPassed = true;
    let needsSudo = false;
    
    // Step 1: Check Homebrew
    const brewStatus = await this._checkHomebrew();
    todoList.push({
      id: 'homebrew',
      label: 'Homebrew Package Manager',
      status: brewStatus.installed ? 'installed' : 'pending',
      required: true,
      sudo: false, // Homebrew install script handles its own sudo
      command: brewStatus.installed ? null : '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      useNonInteractive: !brewStatus.installed, // Use NONINTERACTIVE=1 for brew
      manualInstructions: brewStatus.installed ? null : 
        'Open Terminal and run:\n/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\nFollow the on-screen prompts to complete installation.',
      description: brewStatus.installed 
        ? `Homebrew ${brewStatus.version} is installed`
        : 'Homebrew is required to install R and system dependencies'
    });
    
    if (!brewStatus.installed) {
      allPassed = false;
    }
    
    // Step 2: Check R (only if we'll be able to install it)
    const rStatus = await this._checkR();
    const canInstallR = brewStatus.installed;
    
    todoList.push({
      id: 'r',
      label: 'R Programming Language',
      status: rStatus.installed ? 'installed' : 'pending',
      required: true,
      sudo: false,
      command: rStatus.installed ? null : (canInstallR ? 'brew install --cask r-app' : null),
      useNonInteractive: true,
      manualInstructions: canInstallR ?
        'Open Terminal and run:\nbrew install --cask r-app\n\nOr download from:\nhttps://cran.r-project.org/bin/macosx/' :
        'First install Homebrew, then run:\nbrew install --cask r-app\n\nOr download from:\nhttps://cran.r-project.org/bin/macosx/',
      description: rStatus.installed
        ? `R ${rStatus.version} is installed at ${rStatus.path}`
        : 'R is required to run RAVE'
    });
    
    if (!rStatus.installed) {
      allPassed = false;
    }
    
    // Step 3: Check RStudio (optional)
    const rstudioStatus = await this._checkRStudio();
    const canInstallRStudio = brewStatus.installed;
    
    todoList.push({
      id: 'rstudio',
      label: 'RStudio IDE',
      status: rstudioStatus.installed ? 'installed' : 'pending',
      required: false, // Optional
      sudo: false,
      command: rstudioStatus.installed ? null : (canInstallRStudio ? 'brew install --cask rstudio' : null),
      useNonInteractive: true,
      manualInstructions: canInstallRStudio ?
        'Open Terminal and run:\nbrew install --cask rstudio\n\nOr download from:\nhttps://posit.co/download/rstudio-desktop/' :
        'First install Homebrew, then run:\nbrew install --cask rstudio\n\nOr download from:\nhttps://posit.co/download/rstudio-desktop/',
      description: rstudioStatus.installed
        ? 'RStudio is installed'
        : 'RStudio is recommended for R development but not required for RAVE'
    });
    
    // Step 4: Check Homebrew packages (only if brew is installed)
    if (brewStatus.installed) {
      const requiredPackages = ['hdf5', 'fftw', 'pkg-config', 'cmake', 'libpng'];
      const pkgStatus = await this._checkBrewPackages(requiredPackages);
      
      if (pkgStatus.missing.length > 0) {
        needsSudo = false; // brew install doesn't need sudo
        
        todoList.push({
          id: 'brew-packages',
          label: 'System Libraries',
          status: 'pending',
          required: true,
          sudo: false,
          command: `brew install ${pkgStatus.missing.join(' ')}`,
          useNonInteractive: true,
          manualInstructions: `Open Terminal and run:\nbrew install ${pkgStatus.missing.join(' ')}\n\nThese libraries are required for RAVE's signal processing features.`,
          description: `Missing libraries: ${pkgStatus.missing.join(', ')}`,
          installed: pkgStatus.installed,
          missing: pkgStatus.missing
        });
        
        allPassed = false;
      } else {
        todoList.push({
          id: 'brew-packages',
          label: 'System Libraries',
          status: 'installed',
          required: true,
          sudo: false,
          command: null,
          manualInstructions: null,
          description: `All required libraries are installed: ${requiredPackages.join(', ')}`,
          installed: pkgStatus.installed,
          missing: []
        });
      }
    }
    
    // Step 5: Check RAVE packages (only if R is installed)
    if (rStatus.installed) {
      const raveStatus = await this._checkRAVEPackages();
      todoList.push({
        id: 'rave',
        label: 'RAVE Packages',
        status: raveStatus.installed ? 'installed' : 'pending',
        required: true,
        sudo: false,
        command: null, // RAVE installation uses special installer flow
        useNonInteractive: false,
        manualInstructions: 'Use the "Install RAVE Packages" button to install RAVE, or follow instructions at:\nhttps://rave.wiki/posts/installation/installation.html',
        description: raveStatus.installed
          ? `RAVE ${raveStatus.version} is installed`
          : 'RAVE packages need to be installed using the Install RAVE Packages button'
      });
      
      if (!raveStatus.installed) {
        allPassed = false;
      }
    }

    // Build backward-compatible fields
    const issues = todoList
      .filter(item => item.status === 'pending' && item.required)
      .map(item => item.description);
    
    const commands = todoList
      .filter(item => item.command)
      .map(item => item.command);

    return {
      passed: allPassed,
      needsSudo,
      todoList,
      issues, // Backward compatibility
      commands, // Backward compatibility
      instructions: this._getMacOSInstructions(todoList)
    };
  }

  /**
   * Get macOS installation instructions from TODO list
   * @param {Array} todoList
   * @returns {string}
   */
  _getMacOSInstructions(todoList) {
    const pending = todoList.filter(item => item.status === 'pending');
    
    if (pending.length === 0) {
      return 'All prerequisites are installed and ready to use.';
    }

    let instructions = 'Installation Status:\n\n';
    
    for (const item of todoList) {
      const icon = item.status === 'installed' ? '✓' : 
                   item.status === 'success' ? '✓' :
                   item.required ? '✗' : '○';
      const reqLabel = item.required ? '' : ' (optional)';
      instructions += `${icon} ${item.label}${reqLabel}\n`;
      
      if (item.status === 'pending' && item.description) {
        instructions += `   ${item.description}\n`;
      }
      
      if (item.status === 'pending' && item.command) {
        instructions += `   Command: ${item.command}\n`;
      }
    }
    
    instructions += '\nYou can install missing components automatically or manually follow the instructions above.';
    
    return instructions;
  }

  /**
   * Check Windows prerequisites (Rtools)
   * @returns {Promise<Object>}
   */
  async _checkWindowsPrerequisites() {
    const issues = [];
    const commands = [];
    
    // Check for Rtools by looking for gcc in PATH or common locations
    const hasRtools = await this._checkRtools();
    
    if (!hasRtools) {
      issues.push('Rtools is not installed or not in PATH');
      commands.push('Download and install Rtools from: https://cran.r-project.org/bin/windows/Rtools/');
    }

    return {
      passed: issues.length === 0,
      issues,
      commands,
      instructions: this._getWindowsInstructions(issues, commands)
    };
  }

  /**
   * Check if Rtools is installed on Windows
   * @returns {Promise<boolean>}
   */
  async _checkRtools() {
    return new Promise((resolve) => {
      // Try to find gcc which comes with Rtools
      const where = spawn('where', ['gcc'], { windowsHide: true });
      
      let output = '';
      where.stdout.on('data', (data) => {
        output += data.toString();
      });

      where.on('close', (code) => {
        if (code === 0 && output.includes('Rtools')) {
          resolve(true);
        } else {
          // Also check common Rtools paths
          const rtoolsPaths = [
            'C:\\rtools44\\usr\\bin\\gcc.exe',
            'C:\\rtools43\\usr\\bin\\gcc.exe',
            'C:\\rtools42\\usr\\bin\\gcc.exe',
            'C:\\rtools40\\usr\\bin\\gcc.exe',
            'C:\\Rtools\\bin\\gcc.exe'
          ];
          
          for (const rtoolsPath of rtoolsPaths) {
            if (fs.existsSync(rtoolsPath)) {
              resolve(true);
              return;
            }
          }
          resolve(false);
        }
      });

      where.on('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        where.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Get Windows installation instructions
   * @param {string[]} issues
   * @param {string[]} commands
   * @returns {string}
   */
  _getWindowsInstructions(issues, commands) {
    if (issues.length === 0) {
      return 'All prerequisites are installed.';
    }

    let instructions = 'The following prerequisites are missing:\n\n';
    
    for (let i = 0; i < issues.length; i++) {
      instructions += `${i + 1}. ${issues[i]}\n`;
    }
    
    instructions += '\nTo install Rtools:\n\n';
    instructions += '1. Go to https://cran.r-project.org/bin/windows/Rtools/\n';
    instructions += '2. Download the version matching your R version\n';
    instructions += '3. Run the installer with default options\n';
    instructions += '4. Restart your computer after installation\n';
    
    instructions += '\nAfter installing prerequisites, click "Install Anyway" or restart the installation.';
    
    return instructions;
  }

  /**
   * Check Linux prerequisites using ravemanager::system_requirements()
   * Uses sessionManager for R execution (gets rPath from detector)
   * @returns {Promise<Object>}
   */
  async _checkLinuxPrerequisites() {
    const sessionId = `linux-prereq-check-${Date.now()}`;
    
    try {
      // Create headless session (sessionManager gets rPath from detector)
      const sessionResult = await this.sessionManager.createSession(sessionId, null, { headless: true });
      if (!sessionResult.success) {
        console.error('Failed to create session for Linux prerequisite check:', sessionResult.error);
        return {
          passed: true,
          issues: [],
          commands: [],
          instructions: 'Could not verify prerequisites. Proceeding with installation.'
        };
      }

      // Use ravemanager to detect system requirements (sudo = FALSE)
      const checkCode = `
tryCatch({
  if(require('ravemanager', quietly = TRUE)) {
    reqs <- ravemanager::system_requirements(sudo = FALSE)
    if(length(reqs) > 0) {
      cat('SYSTEM_REQUIREMENTS_START\\n')
      for(req in reqs) {
        cat(req, '\\n')
      }
      cat('SYSTEM_REQUIREMENTS_END\\n')
    } else {
      cat('NO_REQUIREMENTS\\n')
    }
  } else {
    cat('RAVEMANAGER_NOT_FOUND\\n')
  }
}, error = function(e) {
  cat('CHECK_ERROR:', e$message, '\\n')
})
`;

      // Execute with 30 second timeout
      const result = await this.sessionManager.execute(sessionId, checkCode, 30000);
      
      // Clean up session
      this.sessionManager.terminateSession(sessionId);

      const output = result.output || '';

      if (output.includes('NO_REQUIREMENTS')) {
        return {
          passed: true,
          issues: [],
          commands: [],
          instructions: 'All system requirements are satisfied.'
        };
      } else if (output.includes('SYSTEM_REQUIREMENTS_START')) {
        // Extract requirements between markers
        const match = output.match(/SYSTEM_REQUIREMENTS_START\n([\s\S]*?)SYSTEM_REQUIREMENTS_END/);
        if (match) {
          const requirements = match[1].trim().split('\n').filter(r => r.trim());
          return {
            passed: false,
            issues: ['Missing system libraries detected'],
            commands: requirements,
            instructions: this._getLinuxInstructions(requirements)
          };
        } else {
          return {
            passed: true,
            issues: [],
            commands: [],
            instructions: 'All system requirements are satisfied.'
          };
        }
      } else if (output.includes('RAVEMANAGER_NOT_FOUND')) {
        // ravemanager not installed yet, will be installed during installation
        return {
          passed: true,
          issues: [],
          commands: [],
          instructions: 'Prerequisites will be checked during installation.'
        };
      } else {
        // Error or unexpected output, don't block installation
        console.warn('Linux prerequisite check returned unexpected output:', output, result.error);
        return {
          passed: true,
          issues: [],
          commands: [],
          instructions: 'Could not verify prerequisites. Proceeding with installation.'
        };
      }
    } catch (err) {
      // Clean up session on error
      this.sessionManager.terminateSession(sessionId);
      console.error('Failed to check Linux prerequisites:', err);
      return {
        passed: true,
        issues: [],
        commands: [],
        instructions: 'Could not verify prerequisites. Proceeding with installation.'
      };
    }
  }

  /**
   * Get Linux installation instructions
   * @param {string[]} commands - apt/yum install commands
   * @returns {string}
   */
  _getLinuxInstructions(commands) {
    if (commands.length === 0) {
      return 'All system requirements are satisfied.';
    }

    let instructions = 'The following system libraries are missing.\n';
    instructions += 'Please run these commands in a terminal (requires sudo):\n\n';
    
    for (const cmd of commands) {
      instructions += `  ${cmd}\n`;
    }
    
    instructions += '\nAfter installing the libraries, click "Install Anyway" or restart the installation.';
    
    return instructions;
  }

  /**
   * Check prerequisites for the current platform
   * Uses cached results if available and valid
   * Uses sessionManager.getRPath() for R executable path on Linux
   * @param {boolean} forceCheck - Force re-check ignoring cache
   * @returns {Promise<Object>}
   */
  async checkPrerequisites(forceCheck = false) {
    // Check cache first (unless force check requested)
    if (!forceCheck) {
      const cached = this._getCachedPrerequisites();
      if (cached) {
        console.log('Using cached prerequisite results');
        return {
          passed: cached.passed,
          needsSudo: cached.needsSudo || false,
          todoList: cached.todoList || [],
          issues: cached.issues || [],
          commands: cached.commands || [],
          instructions: cached.instructions,
          platform: this.platform,
          cached: true
        };
      }
    }

    console.log('Checking prerequisites for platform:', this.platform);
    
    let result;
    
    if (this.platform === 'darwin') {
      result = await this._checkMacOSPrerequisites();
    } else if (this.platform === 'win32') {
      result = await this._checkWindowsPrerequisites();
    } else if (this.platform === 'linux') {
      result = await this._checkLinuxPrerequisites();
    } else {
      // Unknown platform, don't block
      result = {
        passed: true,
        needsSudo: false,
        todoList: [],
        issues: [],
        commands: [],
        instructions: 'Unknown platform. Proceeding with installation.'
      };
    }

    // Ensure backward compatibility fields exist
    if (!result.issues) {
      result.issues = result.todoList ? 
        result.todoList.filter(item => item.status === 'pending' && item.required).map(item => item.description) : [];
    }
    if (!result.commands) {
      result.commands = result.todoList ? 
        result.todoList.filter(item => item.command).map(item => item.command) : [];
    }
    if (!result.needsSudo) {
      result.needsSudo = false;
    }

    // Cache the result
    this._cachePrerequisites(result);

    return {
      ...result,
      platform: this.platform,
      cached: false
    };
  }

  /**
   * Get platform-friendly name
   * @returns {string}
   */
  getPlatformName() {
    switch (this.platform) {
      case 'darwin':
        return 'macOS';
      case 'win32':
        return 'Windows';
      case 'linux':
        return 'Linux';
      default:
        return this.platform;
    }
  }
}

module.exports = RAVEInstaller;
