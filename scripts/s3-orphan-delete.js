/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-env node */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const auditScriptPath = path.resolve(__dirname, 's3-orphan-audit.js');
const forwardArgs = process.argv.slice(2);

const child = spawnSync(process.execPath, [auditScriptPath, '--apply', ...forwardArgs], {
  stdio: 'inherit',
  env: process.env,
});

if (child.error) {
  console.error('[s3-orphan-delete] failed to launch audit script');
  console.error(child.error);
  process.exit(1);
}

process.exit(typeof child.status === 'number' ? child.status : 1);
