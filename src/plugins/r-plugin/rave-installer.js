const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * RAVE Installer with YAML-based checklist system
 * Loads platform-specific installation workflows from YAML files
 * Implements dependency resolution and sequential task execution
 * No caching - always checks fresh system state
 */
class RAVEInstaller {
  constructor(sessionManager, shellSessionManager) {
    this.sessionManager = sessionManager; // R session manager
    this.shellSessionManager = shellSessionManager; // Shell session manager
    this.platform = process.platform;
    
    // Installation state
    this.checklist = null;
    this.steps = [];
    this.currentStep = null;
    this._aborted = false;
    this._proceedSignal = null;
  }

  /**
   * Load YAML checklist for current platform
   * @returns {Promise<{success: boolean, checklist: Object|null, error: string|null}>}
   */
  async loadChecklist() {
    const platformMap = {
      'darwin': 'macos',
      'win32': 'windows',
      'linux': 'linux'
    };

    const platformName = platformMap[this.platform] || 'linux';
    const checklistPath = path.join(__dirname, '..', '..', '..', 'assets', 'installer-checklists', `installer-${platformName}.yml`);

    console.log(`[RAVEInstaller] Loading checklist from: ${checklistPath}`);

    try {
      if (!fs.existsSync(checklistPath)) {
        return {
          success: false,
          checklist: null,
          error: `Checklist file not found: ${checklistPath}`
        };
      }

      const fileContents = fs.readFileSync(checklistPath, 'utf8');
      const checklist = yaml.load(fileContents);

      // Validate checklist structure
      if (!checklist || !checklist.steps || !Array.isArray(checklist.steps)) {
        return {
          success: false,
          checklist: null,
          error: 'Invalid checklist format: missing steps array'
        };
      }

      // Validate each step has required fields
      for (const step of checklist.steps) {
        if (!step.id || !step.name || !step.type) {
          return {
            success: false,
            checklist: null,
            error: `Invalid step: missing id, name, or type - ${JSON.stringify(step)}`
          };
        }
      }

      this.checklist = checklist;
      console.log(`[RAVEInstaller] Loaded checklist: ${checklist.name} with ${checklist.steps.length} steps`);

      return { success: true, checklist, error: null };
    } catch (err) {
      console.error('[RAVEInstaller] Failed to load checklist:', err);
      return {
        success: false,
        checklist: null,
        error: `Failed to parse YAML: ${err.message}`
      };
    }
  }

  /**
   * Evaluate a step's "if" condition to determine if it can be skipped
   * @param {Object} step - Step object from checklist
   * @returns {Promise<{canSkip: boolean, output: string}>}
   */
  async evaluateCondition(step) {
    if (!step.if) {
      // No condition means step is needed
      return { canSkip: false, output: '' };
    }

    console.log(`[RAVEInstaller] Evaluating condition for ${step.id}: ${step.if}`);

    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', step.if], { windowsHide: true });
      
      let output = '';
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('close', (code) => {
        const canSkip = code === 0;
        console.log(`[RAVEInstaller] Condition for ${step.id}: ${canSkip ? 'SKIP' : 'EXECUTE'} (exit code: ${code})`);
        resolve({ canSkip, output: output.trim() });
      });
      
      proc.on('error', (err) => {
        console.error(`[RAVEInstaller] Condition error for ${step.id}:`, err);
        resolve({ canSkip: false, output: err.message });
      });
      
      // 10 second timeout for condition checks
      setTimeout(() => {
        proc.kill();
        resolve({ canSkip: false, output: 'Condition check timeout' });
      }, 10000);
    });
  }

  /**
   * Topological sort of steps based on dependencies (needs field)
   * @param {Array} steps - Array of step objects
   * @returns {{success: boolean, sorted: Array, error: string|null}}
   */
  topologicalSort(steps) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();
    const stepsMap = new Map();

    // Build map for quick lookup
    steps.forEach(step => stepsMap.set(step.id, step));

    const visit = (stepId) => {
      if (visited.has(stepId)) return true;
      if (visiting.has(stepId)) {
        return false; // Circular dependency detected
      }

      visiting.add(stepId);

      const step = stepsMap.get(stepId);
      if (!step) {
        console.warn(`[RAVEInstaller] Step not found: ${stepId}`);
        return true;
      }

      // Visit dependencies first
      if (step.needs && Array.isArray(step.needs)) {
        for (const depId of step.needs) {
          if (!visit(depId)) {
            return false; // Circular dependency in chain
          }
        }
      }

      visiting.delete(stepId);
      visited.add(stepId);
      sorted.push(step);
      return true;
    };

    // Visit all steps
    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (!visit(step.id)) {
          return {
            success: false,
            sorted: [],
            error: `Circular dependency detected involving step: ${step.id}`
          };
        }
      }
    }

    return { success: true, sorted, error: null };
  }

  /**
   * Check if step's dependencies are satisfied
   * @param {Object} step - Step to check
   * @param {Array} executedSteps - Array of executed step objects with status
   * @returns {{satisfied: boolean, blockedBy: Array<string>}}
   */
  checkDependencies(step, executedSteps) {
    if (!step.needs || step.needs.length === 0) {
      return { satisfied: true, blockedBy: [] };
    }

    const executedMap = new Map();
    executedSteps.forEach(s => {
      if (s.status) {
        executedMap.set(s.id, s.status);
      }
    });

    const blockedBy = [];
    
    for (const depId of step.needs) {
      const depStatus = executedMap.get(depId);
      
      // Dependency not executed or failed
      if (!depStatus || (depStatus !== 'success' && depStatus !== 'skipped')) {
        blockedBy.push(depId);
      }
    }

    return {
      satisfied: blockedBy.length === 0,
      blockedBy
    };
  }

  /**
   * Execute a single installation step
   * @param {Object} step - Step to execute
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<{success: boolean, output: string, error: string|null, status: string}>}
   */
  async executeStep(step, onProgress = null) {
    this.currentStep = step;
    console.log(`[RAVEInstaller] Executing step: ${step.id} (${step.name})`);

    if (onProgress) {
      onProgress({
        type: 'step-start',
        step: { ...step, status: 'running' },
        timestamp: new Date().toISOString()
      });
    }

    const sessionId = `install-${step.id}-${Date.now()}`;
    const sessionType = step.type === 'rscript' ? 'rscript' : 'shell';
    const rPath = this.sessionManager?.getRPath() || 'Rscript';

    // Create session
    const sessionResult = this.shellSessionManager.createSession(sessionId, {
      type: sessionType,
      rPath
    });

    if (!sessionResult.success) {
      return {
        success: false,
        output: '',
        error: sessionResult.error,
        status: 'failed'
      };
    }

    // Register output callback
    if (onProgress) {
      this.shellSessionManager.registerOutputCallback(sessionId, (data) => {
        onProgress({
          type: 'output',
          step: { ...step },
          output: data,
          timestamp: data.timestamp
        });
      });
    }

    // Execute command
    // SUDO_ASKPASS is always set up - if command needs sudo, helper will prompt
    const executeResult = await this.shellSessionManager.execute(sessionId, step.run, {
      env: step.env || {},
      timeout: step.timeout || 1800000, // Default 30 minutes
      step: step // Pass step object so execute can check manualExecute flag
    });

    // Cleanup - only if session still exists (might have been terminated by abort)
    const session = this.shellSessionManager.sessions.get(sessionId);
    if (session) {
      this.shellSessionManager.terminateSession(sessionId);
    }
    this.currentStep = null;

    const status = executeResult.success ? 'success' : 'failed';

    if (onProgress) {
      onProgress({
        type: executeResult.success ? 'step-complete' : 'step-failed',
        step: { ...step, status },
        output: executeResult.output,
        error: executeResult.error,
        timestamp: new Date().toISOString()
      });
    }

    return {
      success: executeResult.success,
      output: executeResult.output,
      error: executeResult.error,
      status
    };
  }

  /**
   * Execute the full installation workflow
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<{success: boolean, completed: number, failed: number, skipped: number, blocked: number}>}
   */
  async executeInstallation(onProgress = null) {
    console.log('[RAVEInstaller] Starting installation workflow');

    this._aborted = false;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let blocked = 0;

    try {
      // Step 1: Terminate all R sessions
      console.log('[RAVEInstaller] Terminating existing R sessions');
      this.sessionManager.terminateAll();

      // Step 2: Load checklist
      const loadResult = await this.loadChecklist();
      if (!loadResult.success) {
        if (onProgress) {
          onProgress({
            type: 'error',
            error: loadResult.error,
            timestamp: new Date().toISOString()
          });
        }
        return { success: false, completed: 0, failed: 1, skipped: 0, blocked: 0 };
      }

      // Step 3: Sort steps by dependencies
      const sortResult = this.topologicalSort(this.checklist.steps);
      if (!sortResult.success) {
        if (onProgress) {
          onProgress({
            type: 'error',
            error: sortResult.error,
            timestamp: new Date().toISOString()
          });
        }
        return { success: false, completed: 0, failed: 1, skipped: 0, blocked: 0 };
      }

      this.steps = sortResult.sorted;
      
      const executedSteps = [];

      if (onProgress) {
        onProgress({
          type: 'installation-start',
          checklist: this.checklist,
          steps: this.steps,
          timestamp: new Date().toISOString()
        });
      }

      // Step 4: Execute each step in order
      for (let i = 0; i < this.steps.length; i++) {
        if (this._aborted) {
          console.log('[RAVEInstaller] Installation aborted by user');
          break;
        }

        const step = this.steps[i];
        
        // Evaluate condition - can we skip this step?
        const conditionResult = await this.evaluateCondition(step);
        if (conditionResult.canSkip) {
          console.log(`[RAVEInstaller] Step ${step.id} condition satisfied - skipping`);
          step.status = 'skipped';
          step.output = conditionResult.output;
          executedSteps.push(step);
          skipped++;

          if (onProgress) {
            onProgress({
              type: 'step-skipped',
              step: { ...step },
              reason: 'Condition already satisfied',
              timestamp: new Date().toISOString()
            });
          }
          continue;
        }

        // Check dependencies
        const depsResult = this.checkDependencies(step, executedSteps);
        if (!depsResult.satisfied) {
          console.log(`[RAVEInstaller] Step ${step.id} blocked by: ${depsResult.blockedBy.join(', ')}`);
          step.status = 'blocked';
          step.blockedBy = depsResult.blockedBy;
          executedSteps.push(step);
          blocked++;

          if (onProgress) {
            onProgress({
              type: 'step-blocked',
              step: { ...step },
              blockedBy: depsResult.blockedBy,
              required: step.required,
              manualInstructions: step.manualInstructions,
              timestamp: new Date().toISOString()
            });
          }

          // If required step is blocked, wait for user decision
          if (step.required) {
            console.log(`[RAVEInstaller] Required step blocked - waiting for user decision`);
            await this._waitForProceedSignal();
            
            if (this._aborted) {
              console.log('[RAVEInstaller] Installation aborted during blocked step');
              break;
            }
            
            // User chose to proceed anyway - mark as skipped
            console.log(`[RAVEInstaller] User chose to proceed - skipping ${step.id}`);
            step.status = 'skipped';
            skipped++;
            
            if (onProgress) {
              onProgress({
                type: 'step-skipped',
                step: { ...step },
                reason: 'User chose to proceed anyway',
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Optional step blocked - auto-skip
            console.log(`[RAVEInstaller] Optional step blocked - auto-skipping ${step.id}`);
            step.status = 'skipped';
            skipped++;
          }
          
          continue;
        }

        // Execute step
        const execResult = await this.executeStep(step, onProgress);
        step.status = execResult.status;
        step.output = execResult.output;
        step.error = execResult.error;
        executedSteps.push(step);

        if (execResult.success) {
          completed++;
        } else {
          failed++;
          
          // Check if installation was aborted before processing failure
          if (this._aborted) {
            console.log('[RAVEInstaller] Installation aborted - skipping failure handling');
            break;
          }
          
          // If required step failed, wait for user decision
          if (step.required) {
            console.log(`[RAVEInstaller] Required step failed - waiting for user decision`);
            
            if (onProgress) {
              onProgress({
                type: 'step-requires-action',
                step: { ...step },
                error: execResult.error,
                manualInstructions: step.manualInstructions,
                timestamp: new Date().toISOString()
              });
            }
            
            await this._waitForProceedSignal();
            
            if (this._aborted) {
              console.log('[RAVEInstaller] Installation aborted after failed step');
              break;
            }
            
            // User chose to proceed - mark as skipped
            console.log(`[RAVEInstaller] User chose to proceed after failure - marking ${step.id} as skipped`);
            step.status = 'skipped';
            skipped++;
          }
        }
      }

      // Installation complete
      const success = failed === 0 && !this._aborted;

      if (onProgress) {
        onProgress({
          type: 'installation-complete',
          success,
          completed,
          failed,
          skipped,
          blocked,
          aborted: this._aborted,
          steps: executedSteps,
          timestamp: new Date().toISOString()
        });
      }

      console.log('[RAVEInstaller] Installation finished:', { success, completed, failed, skipped, blocked });

      return { success, completed, failed, skipped, blocked };

    } finally {
      // Cleanup handled by shell session manager
    }
  }

  /**
   * Wait for proceed signal from UI
   * @returns {Promise<void>}
   */
  _waitForProceedSignal() {
    return new Promise((resolve) => {
      this._proceedSignal = resolve;
    });
  }

  /**
   * Signal to proceed anyway (skip current blocked/failed step)
   */
  proceedAnyway() {
    if (this._proceedSignal) {
      console.log('[RAVEInstaller] Proceed signal received');
      this._proceedSignal();
      this._proceedSignal = null;
    }
  }

  /**
   * Abort the installation
   */
  abort() {
    console.log('[RAVEInstaller] Abort requested');
    this._aborted = true;
    if (this._proceedSignal) {
      this._proceedSignal();
      this._proceedSignal = null;
    }
    
    // Terminate any running shell sessions
    this.shellSessionManager.terminateAll();
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
