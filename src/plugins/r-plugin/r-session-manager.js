const { spawn } = require('child_process');
const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Helper function to find icon path
 */
function getIconPath() {
  const iconPaths = [
    path.join(__dirname, '../../../assets', 'favicon.icns'),
    path.join(__dirname, '../../../assets', 'favicon.ico'),
    path.join(__dirname, '../../../site', 'icon.png'),
    path.join(__dirname, '../../../site', 'favicon.png'),
    path.join(__dirname, '../../../site', 'favicon.ico')
  ];
  
  for (const testPath of iconPaths) {
    if (fs.existsSync(testPath)) {
      return testPath;
    }
  }
  return null;
}

/**
 * R Session Manager for managing multiple R sessions
 */
class RSessionManager {
  constructor(portManager, detector) {
    this.portManager = portManager;
    this.detector = detector;
    this.sessions = new Map(); // sessionId -> { process, rPath, port, status, output }
    this.consoleOutputCallbacks = new Map(); // sessionId -> callback(data)
  }

  /**
   * Get the current R path from detector
   * Uses detector.rPath directly (synchronous property, set by detectR/setCustomPath)
   * @returns {string|null}
   */
  getRPath() {
    if (!this.detector) {
      return null;
    }
    return this.detector.detected ? this.detector.rPath : null;
  }

  /**
   * Create a new R session
   * @param {string} sessionId - Unique session identifier
   * @param {string} rPath - Path to R executable (optional, uses detector if not provided)
   * @param {Object} options - Session options
   * @param {boolean} options.headless - If true, don't show UI dialogs (for background operations)
   * @returns {Promise<{success: boolean, port: number|null, error: string|null}>}
   */
  async createSession(sessionId, rPath = null, options = {}) {
    const { headless = false } = options;
    
    // Use detector rPath if not provided
    if (!rPath) {
      rPath = this.getRPath();
      if (!rPath) {
        return { success: false, port: null, error: 'R not detected' };
      }
    }
    
    if (this.sessions.has(sessionId)) {
      return { success: false, port: null, error: 'Session already exists' };
    }

    try {
      // Allocate port for this session
      const port = await this.portManager.allocatePort();

      // Spawn R process
      const rProcess = spawn(rPath, ['--vanilla', '--quiet', '--interactive'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const session = {
        process: rProcess,
        rPath,
        port,
        status: 'running',
        output: '',
        stderr: '',
        pendingCommands: [],
        headless
      };

      // Handle stdout
      rProcess.stdout.on('data', (data) => {
        const text = data.toString();
        session.output += text;
        
        // Stream to console window if callback registered
        const callback = this.consoleOutputCallbacks.get(sessionId);
        if (callback) {
          callback({ sessionId, type: 'stdout', message: text });
        }
      });

      // Handle stderr
      rProcess.stderr.on('data', (data) => {
        const text = data.toString();
        session.stderr += text;
        console.error(`R Session ${sessionId} stderr:`, text);
        
        // Stream to console window if callback registered
        const callback = this.consoleOutputCallbacks.get(sessionId);
        if (callback) {
          callback({ sessionId, type: 'stderr', message: text });
        }
      });

      // Handle process exit
      rProcess.on('exit', (code, signal) => {
        console.log(`R Session ${sessionId} exited with code ${code}, signal ${signal}`);
        session.status = 'crashed';
        
        // Show dialog to user (unless headless)
        if (!session.headless) {
          this._handleCrash(sessionId, code, signal);
        }
      });

      // Handle process errors
      rProcess.on('error', (err) => {
        console.error(`R Session ${sessionId} error:`, err);
        session.status = 'crashed';
      });

      this.sessions.set(sessionId, session);

      return { success: true, port, error: null };
    } catch (err) {
      return { success: false, port: null, error: err.message };
    }
  }

  /**
   * Handle R session crash
   * @param {string} sessionId - Session ID
   * @param {number} code - Exit code
   * @param {string} signal - Exit signal
   */
  _handleCrash(sessionId, code, signal) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Show dialog
    const iconPath = getIconPath();
    dialog.showMessageBox({
      type: 'error',
      title: 'R Session Crashed',
      message: `R session ${sessionId} has crashed unexpectedly.`,
      detail: `Exit code: ${code}\nSignal: ${signal}\n\nWould you like to restart the session?`,
      buttons: ['Restart', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      ...(iconPath && { icon: iconPath })
    }).then((result) => {
      if (result.response === 0) {
        // User wants to restart
        const rPath = session.rPath;
        this.terminateSession(sessionId);
        this.createSession(sessionId, rPath);
      } else {
        // User cancelled - just clean up
        this.terminateSession(sessionId);
      }
    });
  }

  /**
   * Execute R code in a session
   * @param {string} sessionId - Session ID
   * @param {string} code - R code to execute
   * @param {number} timeout - Timeout in milliseconds (default 30000)
   * @returns {Promise<{success: boolean, output: string|null, error: string|null}>}
   */
  async execute(sessionId, code, timeout = 30000) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, output: null, error: 'Session not found' };
    }

    if (session.status !== 'running') {
      return { success: false, output: null, error: `Session status: ${session.status}` };
    }

    return new Promise((resolve) => {
      // Clear previous output
      session.output = '';
      session.stderr = '';

      // Add marker to detect end of output
      const marker = `___END_MARKER_${Date.now()}___`;
      const codeWithMarker = `${code}\ncat("${marker}\\n")`;

      let timeoutId = null;
      let outputListener = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (outputListener) {
          session.process.stdout.removeListener('data', outputListener);
        }
      };

      // Listen for output
      outputListener = (data) => {
        const text = data.toString();
        session.output += text;

        // Check if we've received the marker
        if (session.output.includes(marker)) {
          cleanup();
          
          // Extract output before marker
          const output = session.output.split(marker)[0].trim();
          
          resolve({
            success: true,
            output,
            error: session.stderr || null
          });
        }
      };

      session.process.stdout.on('data', outputListener);

      // Set timeout
      timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          output: session.output,
          error: 'Execution timeout'
        });
      }, timeout);

      // Write code to R process
      try {
        session.process.stdin.write(codeWithMarker + '\n');
      } catch (err) {
        cleanup();
        resolve({
          success: false,
          output: null,
          error: err.message
        });
      }
    });
  }

  /**
   * Get session status
   * @param {string} sessionId - Session ID
   * @returns {{exists: boolean, status: string|null, port: number|null}}
   */
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { exists: false, status: null, port: null };
    }

    return {
      exists: true,
      status: session.status,
      port: session.port
    };
  }

  /**
   * Terminate a session
   * @param {string} sessionId - Session ID
   */
  terminateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Kill the R process
    if (session.process && !session.process.killed) {
      session.process.kill();
    }

    // Release the port
    if (session.port) {
      this.portManager.releasePort(session.port);
    }

    this.sessions.delete(sessionId);
    console.log(`R Session ${sessionId} terminated`);
  }

  /**
   * Terminate all sessions
   */
  terminateAll() {
    for (const [sessionId] of this.sessions) {
      this.terminateSession(sessionId);
    }
  }

  /**
   * Get all active sessions
   * @returns {Array<{sessionId: string, status: string, port: number}>}
   */
  getAllSessions() {
    const result = [];
    for (const [sessionId, session] of this.sessions) {
      result.push({
        sessionId,
        status: session.status,
        port: session.port
      });
    }
    return result;
  }

  /**
   * Register console output callback for a session
   * @param {string} sessionId - Session ID
   * @param {Function} callback - Callback function(data)
   */
  registerConsoleOutput(sessionId, callback) {
    this.consoleOutputCallbacks.set(sessionId, callback);
  }

  /**
   * Unregister console output callback
   * @param {string} sessionId - Session ID
   */
  unregisterConsoleOutput(sessionId) {
    this.consoleOutputCallbacks.delete(sessionId);
  }

  /**
   * Start RAVE application on the allocated port
   * This will block the R session with rave::start_rave()
   * @param {string} sessionId - Session ID
   * @returns {Promise<{success: boolean, port: number|null, error: string|null}>}
   */
  async startRAVE(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, port: null, error: 'Session not found' };
    }

    if (session.status !== 'running') {
      return { success: false, port: null, error: `Session status: ${session.status}` };
    }

    const http = require('http');
    const port = session.port;

    // R code to start RAVE - this will block the R session
    const raveStartCode = `
tryCatch({
  if(!require('rave', quietly = TRUE)) {
    stop('RAVE package not installed. Please install with: install.packages("rave")')
  }
  # Disable graphics devices to prevent Quartz from launching on macOS
  options(device = function(...) { pdf(NULL) })
  grDevices::pdf(NULL)
  
  cat("Starting RAVE on port ${port}...\\n")
  rave::start_rave(port = ${port}L, launch.browser = FALSE)
}, error = function(e) {
  cat(sprintf("RAVE_ERROR: %s\\n", e$message))
})
`;

    // Write the blocking command to R stdin
    try {
      session.process.stdin.write(raveStartCode + '\n');
    } catch (err) {
      return { success: false, port: null, error: `Failed to write to R process: ${err.message}` };
    }

    // Wait for RAVE server to start by polling HTTP endpoint
    const maxAttempts = 20; // 20 attempts
    const delayMs = 500; // 500ms between attempts = 10 seconds total

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));

      // Try to connect to RAVE server
      const isRunning = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}`, (res) => {
          resolve(true);
          res.resume(); // Consume response data
        });

        req.on('error', () => {
          resolve(false);
        });

        req.setTimeout(1000, () => {
          req.destroy();
          resolve(false);
        });
      });

      if (isRunning) {
        console.log(`RAVE server started on port ${port} after ${attempt} attempts`);
        return { success: true, port, error: null };
      }

      console.log(`Waiting for RAVE server (attempt ${attempt}/${maxAttempts})...`);
    }

    return {
      success: false,
      port: null,
      error: `RAVE server failed to start within ${(maxAttempts * delayMs) / 1000} seconds. Check if rave package is properly installed.`
    };
  }
}

module.exports = RSessionManager;
