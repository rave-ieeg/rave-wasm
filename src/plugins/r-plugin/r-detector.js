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
   * Get common R paths based on platform
   * @returns {string[]} - Array of paths to check
   */
  _getCommonPaths() {
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
      // Windows - check common installation directories
      const programFiles = [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        'C:\\Program Files',
        'C:\\Program Files (x86)'
      ].filter(Boolean);

      for (const pf of programFiles) {
        const rBase = path.join(pf, 'R');
        if (fs.existsSync(rBase)) {
          try {
            const versions = fs.readdirSync(rBase);
            for (const version of versions) {
              if (version.startsWith('R-')) {
                paths.push(path.join(rBase, version, 'bin', 'x64', 'R.exe'));
                paths.push(path.join(rBase, version, 'bin', 'R.exe'));
              }
            }
          } catch (err) {
            // Ignore errors reading directory
          }
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
      r.stdout.on('data', (data) => {
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
    const paths = this._getCommonPaths();
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

      const r = spawn(rPath, ['--slave', '--vanilla', '-e', rCode], {
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
