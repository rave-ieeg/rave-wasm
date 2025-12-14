/**
 * Test script for RAVE package detection
 * Comprehensive debugging for RAVE installation status
 * 
 * Usage: node test/test-rave-status.js
 */

const { spawn } = require('child_process');
const RDetector = require('../src/plugins/r-plugin/r-detector.js');

// Mock config manager
const mockConfigManager = {
  get: (key) => null,
  set: (key, value) => {},
  save: async () => {}
};

/**
 * Execute R command and capture output
 */
function executeRCommand(rPath, code, timeout = 10000) {
  return new Promise((resolve) => {
    console.log(`\nExecuting R command:`);
    console.log(`  Path: ${rPath}`);
    console.log(`  Code: ${code.trim()}`);
    
    const r = spawn(rPath, ['--slave', '--vanilla', '-e', code], {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    
    r.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    r.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    r.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    r.on('error', (err) => {
      resolve({ stdout, stderr, error: err.message, exitCode: -1 });
    });

    setTimeout(() => {
      r.kill();
      resolve({ stdout, stderr, timeout: true, exitCode: -1 });
    }, timeout);
  });
}

/**
 * Test RAVE package detection with multiple methods
 */
async function testRAVEStatus() {
  console.log('='.repeat(70));
  console.log('RAVE Package Status Test Suite');
  console.log('='.repeat(70));
  console.log();

  const detector = new RDetector(mockConfigManager);

  // Step 1: Detect R installation
  console.log('Step 1: Detecting R Installation');
  console.log('-'.repeat(70));
  const rResult = await detector.detectR();
  
  if (!rResult.detected) {
    console.log('❌ R not detected - cannot test RAVE packages');
    console.log('\nPlease ensure R is installed and accessible.');
    process.exit(1);
  }
  
  console.log(`✓ R detected successfully`);
  console.log(`  Path: ${rResult.path}`);
  console.log(`  Version: ${rResult.version}`);
  console.log();

  const rPath = rResult.path;

  // Step 2: Check if rave package is installed (Method 1: require)
  console.log('Step 2: Testing RAVE Package Detection (Method 1: require)');
  console.log('-'.repeat(70));
  
  const requireTest = await executeRCommand(rPath, `
if(require('rave', quietly=TRUE)) {
  cat('RAVE:', as.character(packageVersion('rave')), '\\n')
} else {
  cat('RAVE: NOT_INSTALLED\\n')
}
if(require('ravemanager', quietly=TRUE)) {
  cat('RAVEMANAGER:', as.character(packageVersion('ravemanager')), '\\n')
} else {
  cat('RAVEMANAGER: NOT_INSTALLED\\n')
}
`);

  console.log('Output (stdout):');
  console.log(requireTest.stdout || '  (empty)');
  console.log('Output (stderr):');
  console.log(requireTest.stderr || '  (empty)');
  console.log(`Exit code: ${requireTest.exitCode}`);
  if (requireTest.error) {
    console.log(`Error: ${requireTest.error}`);
  }
  if (requireTest.timeout) {
    console.log('⚠️  Command timed out');
  }
  console.log();

  // Step 3: Check using find.package (Method 2)
  console.log('Step 3: Testing RAVE Package Detection (Method 2: find.package)');
  console.log('-'.repeat(70));
  
  const findPackageTest = await executeRCommand(rPath, `
tryCatch({
  path <- find.package('rave')
  cat('RAVE_PATH:', path, '\\n')
  version <- packageVersion('rave')
  cat('RAVE_VERSION:', as.character(version), '\\n')
}, error = function(e) {
  cat('RAVE: NOT_FOUND\\n')
  cat('ERROR:', e$message, '\\n')
})

tryCatch({
  path <- find.package('ravemanager')
  cat('RAVEMANAGER_PATH:', path, '\\n')
  version <- packageVersion('ravemanager')
  cat('RAVEMANAGER_VERSION:', as.character(version), '\\n')
}, error = function(e) {
  cat('RAVEMANAGER: NOT_FOUND\\n')
  cat('ERROR:', e$message, '\\n')
})
`);

  console.log('Output (stdout):');
  console.log(findPackageTest.stdout || '  (empty)');
  if (findPackageTest.stderr) {
    console.log('Output (stderr):');
    console.log(findPackageTest.stderr);
  }
  console.log(`Exit code: ${findPackageTest.exitCode}`);
  console.log();

  // Step 4: List all installed packages to verify
  console.log('Step 4: Listing All Installed Packages (looking for rave*)');
  console.log('-'.repeat(70));
  
  const listPackagesTest = await executeRCommand(rPath, `
pkgs <- installed.packages()[, c('Package', 'Version', 'LibPath')]
rave_pkgs <- pkgs[grepl('^rave', pkgs[,'Package'], ignore.case=TRUE), , drop=FALSE]
if (nrow(rave_pkgs) > 0) {
  for (i in 1:nrow(rave_pkgs)) {
    cat(sprintf('%s: %s (%s)\\n', 
      rave_pkgs[i,'Package'], 
      rave_pkgs[i,'Version'],
      rave_pkgs[i,'LibPath']))
  }
} else {
  cat('No rave-related packages found\\n')
}
`, 15000);

  console.log('Output (stdout):');
  console.log(listPackagesTest.stdout || '  (empty)');
  if (listPackagesTest.stderr) {
    console.log('Output (stderr):');
    console.log(listPackagesTest.stderr);
  }
  console.log(`Exit code: ${listPackagesTest.exitCode}`);
  console.log();

  // Step 5: Check library paths
  console.log('Step 5: Checking R Library Paths');
  console.log('-'.repeat(70));
  
  const libPathsTest = await executeRCommand(rPath, `
cat('Library paths:\\n')
paths <- .libPaths()
for (i in seq_along(paths)) {
  cat(sprintf('  %d. %s\\n', i, paths[i]))
}
`);

  console.log('Output (stdout):');
  console.log(libPathsTest.stdout || '  (empty)');
  if (libPathsTest.stderr) {
    console.log('Output (stderr):');
    console.log(libPathsTest.stderr);
  }
  console.log();

  // Step 6: Test using RDetector's checkRAVEPackages method
  console.log('Step 6: Testing RDetector.checkRAVEPackages() Method');
  console.log('-'.repeat(70));
  
  const detectorResult = await detector.checkRAVEPackages(rPath);
  console.log('Detector results:');
  console.log(`  rave: ${detectorResult.rave || 'NOT DETECTED'}`);
  console.log(`  ravemanager: ${detectorResult.ravemanager || 'NOT DETECTED'}`);
  console.log();

  // Step 7: Get full status
  console.log('Step 7: Getting Full R Status');
  console.log('-'.repeat(70));
  
  const fullStatus = await detector.getStatus();
  console.log('Full status object:');
  console.log(JSON.stringify(fullStatus, null, 2));
  console.log();

  // Summary and Diagnosis
  console.log('='.repeat(70));
  console.log('DIAGNOSIS');
  console.log('='.repeat(70));
  
  const requireMatches = requireTest.stdout.match(/RAVE:\s*(\S+)/);
  const findPackageMatches = findPackageTest.stdout.match(/RAVE_VERSION:\s*(\S+)/);
  const listMatches = listPackagesTest.stdout.match(/rave:\s*(\S+)/i);
  
  const raveDetected = requireMatches || findPackageMatches || listMatches || detectorResult.rave;
  
  if (raveDetected) {
    const version = detectorResult.rave || requireMatches?.[1] || findPackageMatches?.[1] || listMatches?.[1];
    console.log(`\n✓ RAVE package IS installed (version: ${version})`);
    
    if (detectorResult.rave) {
      console.log('\n✓ RDetector successfully detected RAVE');
      console.log(`  rave: ${detectorResult.rave}`);
      console.log(`  ravemanager: ${detectorResult.ravemanager || 'not detected'}`);
    } else {
      console.log('\n⚠️  WARNING: RAVE is installed but RDetector failed to detect it!');
      console.log('\nPossible causes:');
      console.log('  1. The R script timeout (5 seconds) may be too short');
      console.log('  2. The require() command may be failing silently');
      console.log('  3. Package loading dependencies may be causing issues');
      console.log('  4. The output parsing regex may not be matching correctly');
      console.log('\nRecommended fixes:');
      console.log('  - Increase timeout in checkRAVEPackages()');
      console.log('  - Use find.package() instead of require()');
      console.log('  - Add more verbose error handling');
    }
  } else {
    console.log('\n❌ RAVE package is NOT installed');
    console.log('\nTo install RAVE, run in R:');
    console.log('  install.packages("ravemanager", repos = "https://rave-ieeg.r-universe.dev")');
    console.log('  ravemanager::install()');
  }
  
  console.log('\n' + '='.repeat(70));
}

// Run tests
testRAVEStatus().catch(err => {
  console.error('\n❌ Test suite error:', err);
  console.error('Stack trace:', err.stack);
  process.exit(1);
});
