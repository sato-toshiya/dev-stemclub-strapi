import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';

import { registerUserSafe } from './shared.mjs';
import { registerTeacherOpenApi } from './teacher.mjs';
import { registerStudentOpenApi } from './student.mjs';
import { registerClassOpenApi } from './class.mjs';
import { registerProjectOpenApi } from './project.mjs';
import { registerClassAssignmentOpenApi } from './class-assignment.mjs';

extendZodWithOpenApi(z);

const outFile = 'docs/openapi.overrides.json';
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const registry = new OpenAPIRegistry();

const UserSafe = registerUserSafe(registry, z);

registerTeacherOpenApi(registry, z, { UserSafe });
registerStudentOpenApi(registry, z, { UserSafe });
registerClassOpenApi(registry, z, { UserSafe });
registerProjectOpenApi(registry, z, { UserSafe });
registerClassAssignmentOpenApi(registry, z, { UserSafe });

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: { title: 'custom', version: '1.0.0' },
});

const patch = {
  paths: doc.paths,
  components: { schemas: doc.components?.schemas ?? {} },
};

fs.writeFileSync(outFile, JSON.stringify(patch, null, 2) + '\n', 'utf8');
console.log(`Generated overrides -> ${outFile}`);
