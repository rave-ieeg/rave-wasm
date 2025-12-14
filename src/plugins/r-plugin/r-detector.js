const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * R Detector for finding R installations
 */
class RDetector {
  constructor(configManager) {
    this.configManager = configManager;
    this.detectionInterval = null;
    this.detected = false;
    this.rPath = null;
    this.rVersion = null;
  }

  /**
   * Query registry for R version
   * @param {string} registryKey - Registry key to query (e.g., 'HKLM\\Software\\R-core\\R')
   * @returns {Promise<string|null>} - Version number or null
   */
  async _queryCurrentVersion(registryKey) {
    return new Promise((resolve) => {
      const regQuery = spawn('reg', [
        'query',
        registryKey,
        '/v',
        'Current Version'
      ], { windowsHide: true });

      let output = '';
      regQuery.stdout.on('data', (data) => {
        output += data.toString();
      });

      regQuery.on('close', () => {
        // Parse version from registry output
        const match = output.match(/Current Version\s+REG_SZ\s+(.+)/);
        resolve(match ? match[1].trim() : null);
      });

      regQuery.on('error', () => {
        resolve(null);
      });

      setTimeout(() => {
        regQuery.kill();
        resolve(null);
      }, 3000);
    });
  }

  /**
   * Query registry for R installation path by version
   * @param {string} registryKey - Base registry key (e.g., 'HKLM\\Software\\R-core\\R')
   * @param {string} version - R version number (e.g., '4.5.2')
   * @returns {Promise<string[]>}
   */
  async _queryInstallPath(registryKey, version) {
    return new Promise((resolve) => {
      const paths = [];
      const versionKey = `${registryKey}\\${version}`;
      
      const regQuery = spawn('reg', [
        'query',
        versionKey,
        '/v',
        'InstallPath'
      ], { windowsHide: true });

      let output = '';
      regQuery.stdout.on('data', (data) => {
        output += data.toString();
      });

      regQuery.on('close', () => {
        // Parse install path from registry output
        const match = output.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (match) {
          const installPath = match[1].trim();
          // Try x64 first (only architecture since R 4.2), then fallback
          paths.push(path.join(installPath, 'bin', 'x64', 'R.exe'));
          paths.push(path.join(installPath, 'bin', 'R.exe'));
        }
        resolve(paths);
      });

      regQuery.on('error', () => {
        resolve([]);
      });

      setTimeout(() => {
        regQuery.kill();
        resolve([]);
      }, 3000);
    });
  }

  /**
   * Query a specific registry key for all R installation paths
   * @param {string} registryKey - Registry key to query (e.g., 'HKLM\\Software\\R-core\\R')
   * @returns {Promise<string[]>}
   */
  async _queryRegistryKey(registryKey) {
    return new Promise((resolve) => {
      const paths = [];
      
      const regQuery = spawn('reg', [
        'query',
        registryKey,
        '/s',
        '/v',
        'InstallPath'
      ], { windowsHide: true });

      let output = '';
      regQuery.stdout.on('data', (data) => {
        output += data.toString();
      });

      regQuery.on('close', () => {
        // Parse registry output
        const matches = output.matchAll(/InstallPath\s+REG_SZ\s+(.+)/g);
        for (const match of matches) {
          const installPath = match[1].trim();
          paths.push(path.join(installPath, 'bin', 'x64', 'R.exe'));
          paths.push(path.join(installPath, 'bin', 'i386', 'R.exe'));
          paths.push(path.join(installPath, 'bin', 'R.exe'));
        }
        resolve(paths);
      });

      regQuery.on('error', () => {
        resolve([]);
      });

      setTimeout(() => {
        regQuery.kill();
        resolve([]);
      }, 3000);
    });
  }

  /**
   * Read R path from Windows Registry
   * Queries both HKCU (user-level installs) and HKLM (system-wide installs)
   * Priority: HKCU\R, HKCU\R64, HKLM\R, HKLM\R64
   * User installs are prioritized as they suggest limited admin access
   * @returns {Promise<string[]>}
   */
  async _getWindowsRegistryPaths() {
    if (process.platform !== 'win32') return [];
    
    const paths = [];
    
    // Query both HKCU (user installs) and HKLM (admin installs)
    // Priority: HKCU over HKLM (user installs suggest limited admin access)
    // Priority: R over R64 (R 4.3.0+ uses R-core\R)
    // Reference: https://cran.r-project.org/bin/windows/base/rw-FAQ.html#Does-R-use-the-Registry_003f
    const registryKeys = [
      'HKCU\\Software\\R-core\\R',
      'HKCU\\Software\\R-core\\R64',
      'HKLM\\Software\\R-core\\R',
      'HKLM\\Software\\R-core\\R64'
    ];
    
    // Search all registry keys in priority order
    for (const registryKey of registryKeys) {
      const keyPaths = await this._queryRegistryKey(registryKey);
      if (keyPaths.length > 0) {
        paths.push(...keyPaths);
        // Return immediately after finding first valid registry key
        // This ensures we respect the priority order
        break;
      }
    }
    
    return paths;
  }

  /**
   * Get common R paths based on platform
   * @returns {Promise<string[]>} - Array of paths to check
   */
  async _getCommonPaths() {
    const platform = process.platform;
    const paths = [];

    if (platform === 'darwin') {
      // macOS
      paths.push('/usr/bin/R');
      paths.push('/usr/local/bin/R');
      paths.push('/opt/homebrew/bin/R');
      paths.push('/Library/Frameworks/R.framework/Resources/bin/R');
      paths.push('/Library/Frameworks/R.framework/Versions/Current/Resources/bin/R');
    } else if (platform === 'linux') {
      // Linux
      paths.push('/usr/bin/R');
      paths.push('/usr/local/bin/R');
      paths.push('/opt/R/bin/R');
    } else if (platform === 'win32') {
      // 1. Check RSTUDIO_WHICH_R environment variable first
      if (process.env.RSTUDIO_WHICH_R && fs.existsSync(process.env.RSTUDIO_WHICH_R)) {
        paths.push(process.env.RSTUDIO_WHICH_R);
      }

      // 2. Try Windows Registry (most reliable for R 4.3.0+)
      // Priority: HKCU\R, HKCU\R64, HKLM\R, HKLM\R64
      const registryPaths = await this._getWindowsRegistryPaths();
      paths.push(...registryPaths);

      // 3. Check common installation directories as fallback
      // Priority: user local, then system-wide
      const commonDirs = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'R'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'R'),
        'C:\\R',
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'R')
      ].filter(dir => dir && fs.existsSync(dir));

      for (const rBase of commonDirs) {
        try {
          const versions = fs.readdirSync(rBase)
            .filter(v => v.startsWith('R-'))
            .sort()
            .reverse(); // Get newest first
          
          for (const version of versions) {
            const versionPath = path.join(rBase, version);
            // Try x64 first (standard for R 4.2+), then fallback to bin, then i386
            paths.push(path.join(versionPath, 'bin', 'x64', 'R.exe'));
            paths.push(path.join(versionPath, 'bin', 'R.exe'));
            paths.push(path.join(versionPath, 'bin', 'i386', 'R.exe'));
          }
        } catch (err) {
          // Ignore errors reading directory
        }
      }

      // 4. Check PATH environment variables (least reliable)
      const pathsToCheck = [
        process.env.PATH,
        process.env.ORIGINAL_PATH,
        process.env.Path // Windows sometimes uses 'Path'
      ].filter(Boolean);

      for (const pathEnv of pathsToCheck) {
        const pathDirs = pathEnv.split(path.delimiter);
        for (const dir of pathDirs) {
          const rExe = path.join(dir, 'R.exe');
          if (fs.existsSync(rExe)) paths.push(rExe);
        }
      }
    }

    return paths;
  }

  /**
   * Test if a path is a valid R executable
   * @param {string} rPath - Path to test
   * @returns {Promise<{valid: boolean, version: string|null}>}
   */
  async testRPath(rPath) {
    return new Promise((resolve) => {
      // Check if file exists
      if (!fs.existsSync(rPath)) {
        resolve({ valid: false, version: null });
        return;
      }

      // Try to get R version
      const r = spawn(rPath, ['--version'], {
        windowsHide: true
      });

      let output = '';
      
      // R sends version info to stdout on Unix, stderr on Windows
      r.stdout.on('data', (data) => {
        output += data.toString();
      });

      r.stderr.on('data', (data) => {
        output += data.toString();
      });

      r.on('close', (code) => {
        if (code === 0 && output.includes('R version')) {
          // Extract version number
          const match = output.match(/R version (\d+\.\d+\.\d+)/);
          const version = match ? match[1] : 'unknown';
          resolve({ valid: true, version });
        } else {
          resolve({ valid: false, version: null });
        }
      });

      r.on('error', () => {
        resolve({ valid: false, version: null });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        r.kill();
        resolve({ valid: false, version: null });
      }, 5000);
    });
  }

  /**
   * Detect R installation
   * @returns {Promise<{detected: boolean, path: string|null, version: string|null}>}
   */
  async detectR() {
    // Check if custom path is set
    const customPath = this.configManager.get('rPath');
    if (customPath) {
      const result = await this.testRPath(customPath);
      if (result.valid) {
        this.detected = true;
        this.rPath = customPath;
        this.rVersion = result.version;
        return { detected: true, path: customPath, version: result.version };
      }
    }

    // Check common paths
    const paths = await this._getCommonPaths();
    for (const testPath of paths) {
      const result = await this.testRPath(testPath);
      if (result.valid) {
        this.detected = true;
        this.rPath = testPath;
        this.rVersion = result.version;
        return { detected: true, path: testPath, version: result.version };
      }
    }

    this.detected = false;
    this.rPath = null;
    this.rVersion = null;
    return { detected: false, path: null, version: null };
  }

  /**
   * Start background detection
   * @param {Function} callback - Callback when R is detected
   */
  startBackgroundDetection(callback) {
    if (this.detectionInterval) {
      return; // Already running
    }

    // Initial detection
    this.detectR().then((result) => {
      if (result.detected && callback) {
        callback(result);
      }
    });

    // Continue checking every 5 seconds until found
    this.detectionInterval = setInterval(async () => {
      if (this.detected) {
        this.stopDetection();
        return;
      }

      const result = await this.detectR();
      if (result.detected && callback) {
        callback(result);
        this.stopDetection();
      }
    }, 5000);
  }

  /**
   * Stop background detection
   */
  stopDetection() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
  }

  /**
   * Set custom R path
   * @param {string} customPath - Custom R executable path
   * @returns {Promise<{valid: boolean, version: string|null}>}
   */
  async setCustomPath(customPath) {
    const result = await this.testRPath(customPath);
    if (result.valid) {
      this.configManager.set('rPath', customPath);
      await this.configManager.save();
      this.detected = true;
      this.rPath = customPath;
      this.rVersion = result.version;
    }
    return result;
  }

  /**
   * Check if RAVE packages are installed
   * @param {string} rPath - Path to R executable
   * @returns {Promise<{rave: string|null, ravemanager: string|null}>}
   */
  async checkRAVEPackages(rPath) {
    if (!rPath) {
      return { rave: null, ravemanager: null };
    }

    return new Promise((resolve) => {
      const rCode = `
if(require('rave', quietly=TRUE)) {
  cat('RAVE:', as.character(packageVersion('rave')), '\\n')
}
if(require('ravemanager', quietly=TRUE)) {
  cat('RAVEMANAGER:', as.character(packageVersion('ravemanager')), '\\n')
}
`;

      // On Windows, use Rscript.exe instead of R.exe for non-interactive execution
      // R.exe requires console attachment which causes crashes when spawned from Node.js
      // On other platforms, use R with -q flag to suppress startup messages
      let rExecutable = rPath;
      let args = ['-e', rCode];
      
      if (process.platform === 'win32' && rPath.match(/R\.exe$/i)) {
        rExecutable = rPath.replace(/R\.exe$/i, 'Rscript.exe');
      } else {
        // Unix-like systems: use -q flag with R
        args = ['-q', '-e', rCode];
      }

      const r = spawn(rExecutable, args, {
        windowsHide: true
      });

      let output = '';
      r.stdout.on('data', (data) => {
        output += data.toString();
      });

      r.on('close', () => {
        const raveMatch = output.match(/RAVE:\s*(\S+)/);
        const ravemanagerMatch = output.match(/RAVEMANAGER:\s*(\S+)/);

        resolve({
          rave: raveMatch ? raveMatch[1] : null,
          ravemanager: ravemanagerMatch ? ravemanagerMatch[1] : null
        });
      });

      r.on('error', () => {
        resolve({ rave: null, ravemanager: null });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        r.kill();
        resolve({ rave: null, ravemanager: null });
      }, 5000);
    });
  }

  /**
   * Get current status with RAVE package versions
   * @returns {Promise<{detected: boolean, path: string|null, version: string|null, packages: {rave: string|null, ravemanager: string|null}}>}
   */
  async getStatus() {
    const packages = await this.checkRAVEPackages(this.rPath);
    
    return {
      detected: this.detected,
      path: this.rPath,
      version: this.rVersion,
      packages
    };
  }
}

module.exports = RDetector;
