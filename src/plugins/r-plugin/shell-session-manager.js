const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Shell Session Manager for executing shell and Rscript commands
 * Provides streaming output and session lifecycle management
 * Similar architecture to RSessionManager but for shell/Rscript execution
 */
class ShellSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session object
    this.outputCallbacks = new Map(); // sessionId -> callback function
  }

  /**
   * Create a new shell session
   * @param {string} sessionId - Unique session identifier
   * @param {Object} options - Session options
   * @param {string} options.type - 'shell' or 'rscript'
   * @param {string} options.rPath - Path to R executable (for rscript type)
   * @returns {{success: boolean, sessionId: string, error: string|null}}
   */
  createSession(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) {
      return { success: false, sessionId, error: 'Session already exists' };
    }

    const session = {
      sessionId,
      type: options.type || 'shell',
      rPath: options.rPath || 'Rscript',
      status: 'ready',
      process: null,
      output: '',
      stderr: '',
      createdAt: Date.now()
    };

    this.sessions.set(sessionId, session);
    console.log(`[ShellSessionManager] Session created: ${sessionId} (${session.type})`);
    
    return { success: true, sessionId, error: null };
  }

  /**
   * Execute a command in a session
   * @param {string} sessionId - Session identifier
   * @param {string} command - Command to execute
   * @param {Object} options - Execution options
   * @param {Object} options.env - Environment variables
   * @param {number} options.timeout - Timeout in milliseconds (default: 30 minutes)
   * @param {Object} options.step - Step object containing manualExecute flag
   * @returns {Promise<{success: boolean, output: string, error: string|null}>}
   */
  async execute(sessionId, command, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, output: '', error: 'Session not found' };
    }

    if (session.status === 'running') {
      return { success: false, output: '', error: 'Session is already running a command' };
    }

    const timeout = options.timeout || 30 * 60 * 1000; // 30 minutes default
    const env = { ...process.env, ...options.env };
    
    // For macOS shell commands that may need sudo, open Terminal.app
    // This provides familiar password prompt experience without automation complexity
    const path = require('path');
    const os = require('os');
    
    const isMacOS = process.platform === 'darwin';
    const isShellCommand = session.type === 'shell';
    
    // Check if step requires manual execution (from YAML config manualExecute flag)
    const requiresSudo = options.step && options.step.manualExecute === true;
    
    console.log(`[ShellSessionManager] Execute check - step.id: ${options.step?.id}, manualExecute: ${options.step?.manualExecute}, requiresSudo: ${requiresSudo}`);
    
    if (isMacOS && isShellCommand && requiresSudo) {
      // For macOS shell commands that require sudo, create a setup script for environment variables
      // but show users only the core command to copy and paste
      const { dialog } = require('electron');
      const tempDir = os.tmpdir();
      const setupScriptPath = path.join(tempDir, `rave-env-setup-${Date.now()}.sh`);
      
      // Create environment setup script
      let setupScript = '#!/bin/bash\n\n';
      setupScript += '# RAVE environment setup - automatically sourced\n\n';
      
      // Add environment variables to the setup script
      const envVars = [];
      for (const [key, value] of Object.entries(env)) {
        if (key !== 'PATH' && key !== 'NONINTERACTIVE') {
          setupScript += `export ${key}="${value}"\n`;
          envVars.push(key);
        }
      }
      
      // Handle PATH separately
      if (env.PATH) {
        setupScript += `export PATH="${env.PATH}:$PATH"\n`;
      }
      
      // Write setup script
      try {
        fs.writeFileSync(setupScriptPath, setupScript, { mode: 0o755 });
      } catch (err) {
        console.error(`[ShellSessionManager] Failed to create setup script: ${err.message}`);
        return { success: false, output: '', error: `Failed to create setup script: ${err.message}` };
      }
      
      // Build the command that users will copy and paste
      // It sources the setup script first, then runs the main command
      const fullCommand = `source "${setupScriptPath}" && ${command}`;
      
      session.status = 'running';
      
      // Notify user via callback
      const callback = this.outputCallbacks.get(sessionId);
      if (callback) {
        callback({
          sessionId,
          type: 'stdout',
          message: '\n' + '='.repeat(80) + '\n',
          timestamp: new Date().toISOString()
        });
        callback({
          sessionId,
          type: 'stdout',
          message: 'MANUAL STEP REQUIRED\n',
          timestamp: new Date().toISOString()
        });
        callback({
          sessionId,
          type: 'stdout',
          message: '='.repeat(80) + '\n\n',
          timestamp: new Date().toISOString()
        });
        callback({
          sessionId,
          type: 'stdout',
          message: 'Please open Terminal and run the following command:\n\n',
          timestamp: new Date().toISOString()
        });
        callback({
          sessionId,
          type: 'stdout',
          message: command + '\n\n',
          timestamp: new Date().toISOString()
        });
        callback({
          sessionId,
          type: 'stdout',
          message: '='.repeat(80) + '\n',
          timestamp: new Date().toISOString()
        });
      }
      
      console.log(`[ShellSessionManager] Prompting user to run: ${command.substring(0, 100)}`);
      
      // Open Terminal.app
      spawn('open', ['-a', 'Terminal'], { detached: true, stdio: 'ignore' });
      
      // Send command-prompt event to the installation console
      if (callback) {
        callback({
          sessionId,
          type: 'command-prompt',
          command: command,
          fullCommand: fullCommand,
          timestamp: new Date().toISOString()
        });
      }
      
      // Wait for user response via a promise
      return new Promise((resolve) => {
        // Store the resolve function so we can call it when user responds
        session.commandPromptResolve = (response) => {
          session.status = 'ready';
          
          // Clean up setup script
          try {
            if (fs.existsSync(setupScriptPath)) {
              fs.unlinkSync(setupScriptPath);
            }
          } catch (err) {
            console.warn(`[ShellSessionManager] Cleanup warning: ${err.message}`);
          }
          
          if (response === 'success') {
            if (callback) {
              callback({
                sessionId,
                type: 'stdout',
                message: '\n✓ Step completed successfully\n\n',
                timestamp: new Date().toISOString()
              });
            }
            resolve({ success: true, output: 'Command completed successfully', error: null });
          } else if (response === 'failed') {
            if (callback) {
              callback({
                sessionId,
                type: 'stderr',
                message: '\n✗ Step failed\n\n',
                timestamp: new Date().toISOString()
              });
            }
            resolve({ success: false, output: '', error: 'User reported command failed' });
          } else {
            if (callback) {
              callback({
                sessionId,
                type: 'stdout',
                message: '\n⊘ Step skipped\n\n',
                timestamp: new Date().toISOString()
              });
            }
            resolve({ success: false, output: '', error: 'User skipped step' });
          }
        };
      });
    }
    
    // For Rscript or non-macOS, use normal execution
    session.status = 'running';
    session.output = '';
    session.stderr = '';

    console.log(`[ShellSessionManager] Executing in ${sessionId}:`, command.substring(0, 100));

    return new Promise((resolve) => {
      let cmdToRun = command;
      let args = [];
      let executable = 'sh';
      let tempBatchPath = null;

      if (session.type === 'rscript') {
        // For Rscript, use Rscript executable
        executable = session.rPath;
        args = ['--quiet', '-e', command];
      } else {
        // For shell commands, use platform-appropriate shell
        if (process.platform === 'win32') {
          // Windows: Write to temporary batch file to support multi-line commands
          try {
            const tempDir = os.tmpdir();
            tempBatchPath = path.join(tempDir, `rave-shell-${sessionId}-${Date.now()}.bat`);
            fs.writeFileSync(tempBatchPath, cmdToRun);
            executable = 'cmd.exe';
            args = ['/c', tempBatchPath];
          } catch (err) {
            console.error('[ShellSessionManager] Failed to create temp batch file:', err);
            // Fallback to direct execution (might fail for multi-line)
            executable = 'cmd.exe';
            args = ['/c', cmdToRun];
          }
        } else {
          executable = 'sh';
          args = ['-c', cmdToRun];
        }
      }

      const proc = spawn(executable, args, {
        windowsHide: true,
        env
      });

      session.process = proc;

      // Handle stdout
      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        session.output += chunk;

        // Emit to callback if registered
        const callback = this.outputCallbacks.get(sessionId);
        if (callback) {
          callback({
            sessionId,
            type: 'stdout',
            message: chunk,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle stderr
      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        session.stderr += chunk;

        // Emit to callback if registered
        const callback = this.outputCallbacks.get(sessionId);
        if (callback) {
          callback({
            sessionId,
            type: 'stderr',
            message: chunk,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle process completion
      proc.on('close', (code) => {
        // Cleanup temp batch file if it exists
        if (tempBatchPath) {
          try {
            if (fs.existsSync(tempBatchPath)) {
              fs.unlinkSync(tempBatchPath);
            }
          } catch (err) {
            console.warn('[ShellSessionManager] Failed to cleanup temp batch file:', err);
          }
        }

        // Check if session still exists (might have been terminated)
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) {
          console.log(`[ShellSessionManager] ${sessionId} finished with code ${code} (session already terminated)`);
          resolve({
            success: false,
            output: '',
            error: 'Session terminated'
          });
          return;
        }

        currentSession.status = 'ready';
        currentSession.process = null;

        const success = code === 0;
        const error = success ? null : (currentSession.stderr || `Command failed with exit code ${code}`);

        console.log(`[ShellSessionManager] ${sessionId} finished with code ${code}`);

        resolve({
          success,
          output: currentSession.output,
          error
        });
      });

      // Handle process errors
      proc.on('error', (err) => {
        // Check if session still exists (might have been terminated)
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) {
          console.error(`[ShellSessionManager] ${sessionId} error (session already terminated):`, err);
          resolve({
            success: false,
            output: '',
            error: 'Session terminated'
          });
          return;
        }

        currentSession.status = 'crashed';
        currentSession.process = null;

        console.error(`[ShellSessionManager] ${sessionId} error:`, err);

        resolve({
          success: false,
          output: currentSession.output,
          error: err.message
        });
      });

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        if (session.process) {
          console.warn(`[ShellSessionManager] ${sessionId} timeout after ${timeout}ms`);
          session.process.kill();
          session.status = 'ready';
          session.process = null;

          resolve({
            success: false,
            output: session.output,
            error: `Command timeout after ${timeout}ms`
          });
        }
      }, timeout);

      // Clear timeout on completion
      proc.on('close', () => clearTimeout(timeoutHandle));
    });
  }

  /**
   * Register a callback for streaming output
   * @param {string} sessionId - Session identifier
   * @param {Function} callback - Callback function(data)
   */
  registerOutputCallback(sessionId, callback) {
    this.outputCallbacks.set(sessionId, callback);
    console.log(`[ShellSessionManager] Output callback registered for ${sessionId}`);
  }

  /**
   * Unregister output callback
   * @param {string} sessionId - Session identifier
   */
  unregisterOutputCallback(sessionId) {
    this.outputCallbacks.delete(sessionId);
    console.log(`[ShellSessionManager] Output callback unregistered for ${sessionId}`);
  }

  /**
   * Respond to a command prompt
   * @param {string} sessionId - Session identifier
   * @param {string} response - User response ('success', 'failed', or 'skip')
   */
  respondToCommandPrompt(sessionId, response) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[ShellSessionManager] Cannot respond - session not found: ${sessionId}`);
      return;
    }

    if (session.commandPromptResolve) {
      console.log(`[ShellSessionManager] User responded to command prompt: ${response}`);
      session.commandPromptResolve(response);
      delete session.commandPromptResolve;
    }
  }

  /**
   * Get session status
   * @param {string} sessionId - Session identifier
   * @returns {{exists: boolean, status: string, type: string}}
   */
  getStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { exists: false, status: 'not-found', type: null };
    }

    return {
      exists: true,
      status: session.status,
      type: session.type
    };
  }

  /**
   * Terminate a session and kill any running process
   * @param {string} sessionId - Session identifier
   */
  terminateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[ShellSessionManager] Cannot terminate - session not found: ${sessionId}`);
      return;
    }

    // Resolve any pending command prompt with 'failed' response
    if (session.commandPromptResolve) {
      console.log(`[ShellSessionManager] Resolving pending command prompt for ${sessionId} with 'failed'`);
      session.commandPromptResolve('failed');
      delete session.commandPromptResolve;
    }

    // Kill process if running
    if (session.process) {
      console.log(`[ShellSessionManager] Killing process for ${sessionId}`);
      session.process.kill();
      session.process = null;
    }

    // Clean up
    this.sessions.delete(sessionId);
    this.outputCallbacks.delete(sessionId);
    
    console.log(`[ShellSessionManager] Session terminated: ${sessionId}`);
  }

  /**
   * Terminate all sessions
   */
  terminateAll() {
    console.log(`[ShellSessionManager] Terminating all sessions (${this.sessions.size})`);
    const sessionIds = Array.from(this.sessions.keys());
    sessionIds.forEach(id => this.terminateSession(id));
  }

  /**
   * Get all active sessions
   * @returns {Array<{sessionId: string, type: string, status: string}>}
   */
  getAllSessions() {
    const sessions = [];
    this.sessions.forEach((session, sessionId) => {
      sessions.push({
        sessionId,
        type: session.type,
        status: session.status
      });
    });
    return sessions;
  }
}

module.exports = ShellSessionManager;
