/**
 * Test script for R detector functionality
 * Tests registry detection, path discovery, and version checking
 * 
 * Usage: node test/test-r-detector.js
 */

const RDetector = require('../src/plugins/r-plugin/r-detector.js');

// Mock config manager
const mockConfigManager = {
  get: (key) => null,
  set: (key, value) => {},
  save: async () => {}
};

async function testDetection() {
  console.log('='.repeat(60));
  console.log('R Detector Test Suite');
  console.log('='.repeat(60));
  console.log();
  
  const detector = new RDetector(mockConfigManager);
  
  // Test 1: Windows Registry Detection
  console.log('Test 1: Windows Registry Detection');
  console.log('-'.repeat(60));
  const registryPaths = await detector._getWindowsRegistryPaths();
  console.log(`Found ${registryPaths.length} path(s) from registry:`);
  if (registryPaths.length > 0) {
    registryPaths.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p}`);
    });
  } else {
    console.log('  (No paths found in registry)');
  }
  console.log();
  
  // Test 2: Common Paths Detection
  console.log('Test 2: Common Paths Detection');
  console.log('-'.repeat(60));
  const commonPaths = await detector._getCommonPaths();
  console.log(`Total paths to check: ${commonPaths.length}`);
  if (commonPaths.length > 0) {
    console.log('First 10 paths:');
    commonPaths.slice(0, 10).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p}`);
    });
  }
  console.log();
  
  // Test 3: Full R Detection
  console.log('Test 3: Full R Detection');
  console.log('-'.repeat(60));
  const result = await detector.detectR();
  console.log(`Detected: ${result.detected ? '✓' : '✗'}`);
  console.log(`Path: ${result.path || '(not found)'}`);
  console.log(`Version: ${result.version || '(unknown)'}`);
  console.log();
  
  // Test 4: Individual Path Testing (if detection failed)
  if (!result.detected && commonPaths.length > 0) {
    console.log('Test 4: Testing First Path Individually');
    console.log('-'.repeat(60));
    const testPath = commonPaths[0];
    console.log(`Testing: ${testPath}`);
    const testResult = await detector.testRPath(testPath);
    console.log(`Valid: ${testResult.valid ? '✓' : '✗'}`);
    console.log(`Version: ${testResult.version || '(unknown)'}`);
    console.log();
  }
  
  // Test 5: RAVE Package Detection
  if (result.detected) {
    console.log('Test 4: RAVE Package Detection');
    console.log('-'.repeat(60));
    const packages = await detector.checkRAVEPackages(result.path);
    console.log(`RAVE: ${packages.rave || '(not installed)'}`);
    console.log(`ravemanager: ${packages.ravemanager || '(not installed)'}`);
    console.log();
  }
  
  // Summary
  console.log('='.repeat(60));
  if (result.detected) {
    console.log('✓ Test Suite PASSED - R detected successfully');
  } else {
    console.log('✗ Test Suite FAILED - R not detected');
    process.exit(1);
  }
  console.log('='.repeat(60));
}

// Run tests
testDetection().catch(err => {
  console.error('\n❌ Test suite error:', err);
  process.exit(1);
});
