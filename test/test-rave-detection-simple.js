/**
 * Simple test to verify RAVE detection fix
 */

const RDetector = require('../src/plugins/r-plugin/r-detector.js');

const mockConfigManager = {
  get: () => null,
  set: () => {},
  save: async () => {}
};

async function test() {
  console.log('Testing RAVE Detection Fix');
  console.log('='.repeat(50));
  
  const detector = new RDetector(mockConfigManager);
  
  // Detect R
  console.log('1. Detecting R...');
  const rResult = await detector.detectR();
  
  if (!rResult.detected) {
    console.log('❌ R not detected');
    process.exit(1);
  }
  
  console.log(`✓ R detected: ${rResult.path}`);
  console.log(`  Version: ${rResult.version}`);
  
  // Get full status (includes package detection)
  console.log('\n2. Checking RAVE packages...');
  const status = await detector.getStatus();
  
  console.log('\nResults:');
  console.log(`  R detected: ${status.detected ? '✓' : '✗'}`);
  console.log(`  R version: ${status.version}`);
  console.log(`  RAVE: ${status.packages.rave || 'NOT DETECTED'}`);
  console.log(`  ravemanager: ${status.packages.ravemanager || 'NOT DETECTED'}`);
  
  if (status.packages.rave) {
    console.log('\n✓✓✓ SUCCESS! RAVE packages detected correctly!');
    console.log('='.repeat(50));
    process.exit(0);
  } else {
    console.log('\n❌ RAVE packages not detected');
    console.log('='.repeat(50));
    process.exit(1);
  }
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
