/**
 * Deploy Update Script
 * ====================
 * Builds and publishes the printer app update to GitHub Releases.
 * The app auto-checks for updates every hour.
 *
 * Prerequisites:
 *   1. Create a GitHub repo: github.com/eethuis-boles/printer-releases
 *   2. Create a Personal Access Token (classic) with 'repo' scope
 *   3. Set the token: set GH_TOKEN=ghp_xxxx  (or use .env)
 *
 * Usage:
 *   npm run deploy-update          (Windows only)
 *   npm run deploy-update -- --mac (Mac only, must run on Mac)
 */

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const isMac = args.includes('--mac');

if (!process.env.GH_TOKEN) {
  console.error('❌ GH_TOKEN not set!');
  console.error('');
  console.error('Set it first:');
  console.error('  Windows:  set GH_TOKEN=ghp_your_token_here');
  console.error('  Mac/Linux: export GH_TOKEN=ghp_your_token_here');
  console.error('');
  console.error('Get a token at: https://github.com/settings/tokens');
  console.error('  → "Generate new token (classic)" → scope: repo');
  process.exit(1);
}

const platform = isMac ? '--mac' : '--win';
const cmd = `npx electron-builder ${platform} --publish always`;

console.log(`\n📦 Building & publishing update (${isMac ? 'Mac' : 'Windows'})...\n`);
console.log(`> ${cmd}\n`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: require('path').join(__dirname, '..') });
  console.log('\n🎉 Update published to GitHub Releases!');
  console.log('The printer app will auto-update within 1 hour.\n');
} catch (err) {
  console.error('\n❌ Build/publish failed:', err.message);
  process.exit(1);
}

