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
   * Check macOS prerequisites
   * @returns {Promise<Object>}
   */
  async _checkMacOSPrerequisites() {
    const issues = [];
    const commands = [];
    
    // Check Homebrew
    const brewStatus = await this._checkHomebrew();
    if (!brewStatus.installed) {
      issues.push('Homebrew package manager is not installed');
      commands.push('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    } else {
      // Check required brew packages
      const requiredPackages = ['hdf5', 'fftw', 'pkg-config', 'cmake', 'libpng'];
      const pkgStatus = await this._checkBrewPackages(requiredPackages);
      
      if (pkgStatus.missing.length > 0) {
        issues.push(`Missing Homebrew packages: ${pkgStatus.missing.join(', ')}`);
        commands.push(`brew install ${pkgStatus.missing.join(' ')}`);
      }
    }

    return {
      passed: issues.length === 0,
      issues,
      commands,
      instructions: this._getMacOSInstructions(issues, commands)
    };
  }

  /**
   * Get macOS installation instructions
   * @param {string[]} issues
   * @param {string[]} commands
   * @returns {string}
   */
  _getMacOSInstructions(issues, commands) {
    if (issues.length === 0) {
      return 'All prerequisites are installed.';
    }

    let instructions = 'The following prerequisites are missing:\n\n';
    
    for (let i = 0; i < issues.length; i++) {
      instructions += `${i + 1}. ${issues[i]}\n`;
    }
    
    instructions += '\nTo fix, open Terminal and run:\n\n';
    
    for (const cmd of commands) {
      instructions += `  ${cmd}\n`;
    }
    
    instructions += '\nAfter installing prerequisites, click "Install Anyway" or restart the installation.';
    
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
    // Check cache first
    if (!forceCheck) {
      const cached = this._getCachedPrerequisites();
      if (cached) {
        console.log('Using cached prerequisite results');
        return {
          passed: cached.passed,
          issues: cached.issues,
          commands: cached.commands,
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
        issues: [],
        commands: [],
        instructions: 'Unknown platform. Proceeding with installation.'
      };
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
