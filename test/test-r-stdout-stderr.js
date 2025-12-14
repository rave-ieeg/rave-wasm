/**
 * Test script to verify which output stream R uses for --version
 * On Windows, R sends version info to stderr instead of stdout
 * 
 * Usage: node test/test-r-stdout-stderr.js [path-to-R.exe]
 */

const { spawn } = require('child_process');
const fs = require('fs');

// Get R path from command line or use default
const rPath = process.argv[2] || 'C:\\Program Files\\R\\R-4.5.0\\bin\\x64\\R.exe';

console.log('='.repeat(60));
console.log('R Output Stream Test');
console.log('='.repeat(60));
console.log(`Testing: ${rPath}`);
console.log();

// Check if file exists
if (!fs.existsSync(rPath)) {
  console.error(`✗ Error: R executable not found at: ${rPath}`);
  console.log('\nUsage: node test/test-r-stdout-stderr.js [path-to-R.exe]');
  process.exit(1);
}

const r = spawn(rPath, ['--version'], {
  windowsHide: true
});

let stdout = '';
let stderr = '';

r.stdout.on('data', (data) => {
  const text = data.toString();
  stdout += text;
  console.log('[STDOUT]', text.trim());
});

r.stderr.on('data', (data) => {
  const text = data.toString();
  stderr += text;
  console.log('[STDERR]', text.trim());
});

r.on('close', (code) => {
  console.log();
  console.log('='.repeat(60));
  console.log('Results:');
  console.log('-'.repeat(60));
  console.log(`Exit code: ${code}`);
  console.log(`STDOUT length: ${stdout.length} bytes`);
  console.log(`STDERR length: ${stderr.length} bytes`);
  console.log();
  
  if (code === 0) {
    if (stderr.includes('R version')) {
      console.log('✓ R sends version info to STDERR (Windows behavior)');
    } else if (stdout.includes('R version')) {
      console.log('✓ R sends version info to STDOUT (Unix behavior)');
    } else {
      console.log('✗ Warning: Version info not found in either stream');
    }
  } else {
    console.log(`✗ R exited with non-zero code: ${code}`);
  }
  console.log('='.repeat(60));
});

r.on('error', (err) => {
  console.error('\n❌ Error spawning R process:', err);
  process.exit(1);
});
