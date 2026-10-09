import { readFileSync } from 'node:fs';

// Assert rendered production policy, not just the build process environment.
// These public markers are evidence of build configuration, not authorization.
try {
  const html = readFileSync(process.argv[2] ?? '.next/server/app/app.html', 'utf8');
  const main = html.match(/<main\b[^>]*\bid="console"[^>]*>/)?.[0];
  if (!main) throw new Error('Rendered reclaim console is missing.');
  for (const flag of ['mainnet', 'mainnet-broadcast', 'signet-broadcast']) {
    if (!main.includes(`data-${flag}-enabled="false"`)) {
      throw new Error(`Rendered ${flag} flag is enabled or missing.`);
    }
  }
  if (!/<option\b[^>]*value="Mainnet"[^>]*disabled=""/.test(html)) {
    throw new Error('Rendered Mainnet option is not locked.');
  }
  console.log('Production console: all product flags off; Mainnet locked.');
} catch (error) {
  console.error(`Unsafe or unavailable production artifact: ${error.message}`);
  process.exitCode = 1;
}
