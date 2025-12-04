/**
 * IPC Helper utilities for consistent error handling
 */

/**
 * Wraps an IPC handler function with consistent error handling
 * @param {Function} fn - The handler function to wrap
 * @returns {Function} - Wrapped handler with error handling
 */
function wrapHandler(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('IPC Handler Error:', error);
      return {
        success: false,
        error: {
          message: error.message,
          stack: error.stack
        }
      };
    }
  };
}

/**
 * Creates a standardized error response
 * @param {Error} error - The error object
 * @returns {Object} - Standardized error response
 */
function createErrorResponse(error) {
  return {
    success: false,
    error: {
      message: error.message,
      stack: error.stack
    }
  };
}

/**
 * Creates a standardized success response
 * @param {*} data - The data to return
 * @returns {Object} - Standardized success response
 */
function createSuccessResponse(data) {
  return {
    success: true,
    data
  };
}

module.exports = {
  wrapHandler,
  createErrorResponse,
  createSuccessResponse
};
