/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-env node */

'use strict';

const fs = require('fs-extra');
const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const CONFIG_PATH = path.resolve(process.cwd(), 'config/users-permissions/permissions.json');

function asBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function normalizeRoleConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const type = String(raw.type || '').trim();
  if (!type) return null;

  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .sort()
    : [];

  return {
    type,
    name: String(raw.name || type).trim() || type,
    description: String(raw.description || '').trim(),
    managed: raw.managed !== false,
    actions,
  };
}

function setDeepEnabled(target, action) {
  const [group, controller, actionName] = action.split('.');
  if (!group || !controller || !actionName) return false;

  if (!target[group] || !target[group].controllers || !target[group].controllers[controller]) {
    return false;
  }

  if (!target[group].controllers[controller][actionName]) {
    return false;
  }

  target[group].controllers[controller][actionName].enabled = true;
  return true;
}

async function loadConfig() {
  if (!(await fs.pathExists(CONFIG_PATH))) return null;

  const parsed = await fs.readJson(CONFIG_PATH);
  const roleRows = Array.isArray(parsed?.roles) ? parsed.roles : [];
  const roles = roleRows.map(normalizeRoleConfig).filter(Boolean);

  return {
    version: Number(parsed?.version || 1),
    roles,
  };
}

async function ensureRole(strapi, roleConfig) {
  const roleQuery = strapi.db.query('plugin::users-permissions.role');
  const existing = await roleQuery.findOne({
    where: { type: roleConfig.type },
    select: ['id', 'type', 'name', 'description'],
  });

  if (existing?.id) return existing;

  return roleQuery.create({
    data: {
      type: roleConfig.type,
      name: roleConfig.name,
      description: roleConfig.description || null,
    },
  });
}

async function syncPermissions(strapi, options = {}) {
  const strict = options.strict ?? true;

  const cfg = await loadConfig();
  if (!cfg) {
    strapi.log.info(`[permissions:sync] config not found at ${CONFIG_PATH}, skipping`);
    return;
  }

  if (!cfg.roles.length) {
    strapi.log.info('[permissions:sync] no roles configured, skipping');
    return;
  }

  const upService = strapi.plugin('users-permissions').service('users-permissions');
  const roleService = strapi.plugin('users-permissions').service('role');

  for (const roleConfig of cfg.roles) {
    if (!roleConfig.managed) {
      strapi.log.info(`[permissions:sync] skip unmanaged role type="${roleConfig.type}"`);
      continue;
    }

    const tree = upService.getActions({ defaultEnable: false });
    const missing = [];

    for (const action of roleConfig.actions) {
      const ok = setDeepEnabled(tree, action);
      if (!ok) missing.push(action);
    }

    if (missing.length) {
      const message = `[permissions:sync] role "${roleConfig.type}" has unknown actions: ${missing.join(
        ', '
      )}`;
      if (strict) throw new Error(message);
      strapi.log.warn(message);
    }

    const role = await ensureRole(strapi, roleConfig);

    await roleService.updateRole(role.id, {
      name: roleConfig.name,
      description: roleConfig.description || null,
      permissions: tree,
    });

    strapi.log.info(
      `[permissions:sync] synced role "${roleConfig.type}" with ${roleConfig.actions.length} actions`
    );
  }
}

async function main() {
  const strict = asBoolean(process.env.PERMISSIONS_SYNC_STRICT, true);
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appDir = process.cwd();
  const distDir = path.resolve(appDir, 'dist');

  // In CI/prod we ship prebuilt dist/ and install production deps only.
  // Booting Strapi directly from dist avoids loading source config/*.ts.
  const hasCompiledDist =
    (await fs.pathExists(path.join(distDir, 'config'))) &&
    (await fs.pathExists(path.join(distDir, 'src')));

  const appContext = hasCompiledDist ? { appDir, distDir } : await compileStrapi({ appDir });

  const app = await createStrapi(appContext).load();

  try {
    await syncPermissions(app, { strict });
    console.log('[permissions:sync] done');
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('[permissions:sync] failed');
  console.error(error);
  process.exit(1);
});
