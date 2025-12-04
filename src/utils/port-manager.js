const net = require('net');

/**
 * Port Manager for allocating and reusing ports
 */
class PortManager {
  constructor(startPort = 8100, endPort = 8200) {
    this.startPort = startPort;
    this.endPort = endPort;
    this.usedPorts = new Set();
    this.availablePorts = [];
  }

  /**
   * Check if a port is available
   * @param {number} port - Port number to check
   * @returns {Promise<boolean>} - True if port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false);
        }
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Allocate an available port
   * @returns {Promise<number>} - The allocated port number
   */
  async allocatePort() {
    // First try to reuse a previously released port
    if (this.availablePorts.length > 0) {
      const port = this.availablePorts.shift();
      this.usedPorts.add(port);
      return port;
    }

    // Find a new available port
    for (let port = this.startPort; port <= this.endPort; port++) {
      if (!this.usedPorts.has(port)) {
        const available = await this.isPortAvailable(port);
        if (available) {
          this.usedPorts.add(port);
          return port;
        }
      }
    }

    throw new Error(`No available ports in range ${this.startPort}-${this.endPort}`);
  }

  /**
   * Release a port back to the pool for reuse
   * @param {number} port - Port number to release
   */
  releasePort(port) {
    if (this.usedPorts.has(port)) {
      this.usedPorts.delete(port);
      this.availablePorts.push(port);
    }
  }

  /**
   * Get all currently used ports
   * @returns {number[]} - Array of used port numbers
   */
  getUsedPorts() {
    return Array.from(this.usedPorts);
  }

  /**
   * Clear all port tracking
   */
  clear() {
    this.usedPorts.clear();
    this.availablePorts = [];
  }
}

module.exports = PortManager;
