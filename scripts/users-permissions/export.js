/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-env node */

'use strict';

const fs = require('fs-extra');
const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const OUTPUT_PATH = path.resolve(process.cwd(), 'config/users-permissions/permissions.json');

function sortUnique(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

async function exportPermissions(strapi) {
  const roles = await strapi.db.query('plugin::users-permissions.role').findMany({
    sort: ['type:asc'],
    populate: ['permissions'],
  });

  const payload = {
    version: 1,
    description:
      'Source of truth for users-permissions role actions. Generate via `yarn permissions:export`.',
    roles: roles.map((role) => ({
      type: String(role.type || '').trim(),
      name: String(role.name || '').trim(),
      description: String(role.description || '').trim(),
      managed: true,
      actions: sortUnique((role.permissions || []).map((p) => String(p.action || '').trim())),
    })),
  };

  payload.roles = payload.roles.filter((r) => r.type);

  await fs.ensureDir(path.dirname(OUTPUT_PATH));
  await fs.writeJson(OUTPUT_PATH, payload, { spaces: 2 });

  return payload.roles.length;
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appDir = process.cwd();
  const distDir = path.resolve(appDir, 'dist');

  const hasCompiledDist =
    (await fs.pathExists(path.join(distDir, 'config'))) &&
    (await fs.pathExists(path.join(distDir, 'src')));

  const appContext = hasCompiledDist ? { appDir, distDir } : await compileStrapi({ appDir });

  const app = await createStrapi(appContext).load();

  try {
    const count = await exportPermissions(app);
    console.log(`[permissions:export] exported ${count} roles -> ${OUTPUT_PATH}`);
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('[permissions:export] failed');
  console.error(error);
  process.exit(1);
});
