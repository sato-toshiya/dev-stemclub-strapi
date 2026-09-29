# ste-strapi

Strapi backend for a school-management domain with tenant scoping by `school_admin`.

Main modules:

- `school-admin`, `agency-admin`
- `academic-year`, `class`
- `teacher`, `student`
- `project`, `class-assignment`, `assignment-submission`

## Tech Stack

- Strapi `5.32.0`
- Node.js `>=20 <=24`
- Yarn Classic (v1 lockfile)
- PostgreSQL
- Upload provider: AWS S3 (`@strapi/provider-upload-aws-s3`), with LocalStack support for local dev

## Prerequisites

- Node.js 20+
- Yarn 1.x
- PostgreSQL
- Optional: Docker + Docker Compose + LocalStack

## Installation

```bash
corepack enable
yarn install --frozen-lockfile
cp .env.example .env
```

Start local dependencies (Postgres + LocalStack):

```bash
docker compose -f docker-compose.dev.yml up -d postgres localstack
```

Run in development:

```bash
yarn develop
```

Default admin URL: `http://localhost:1337/admin`

## Build

```bash
yarn build
```

Build output:

- Server compile output: `dist/src`, `dist/config`
- Admin build output: `dist/build`

## Deploy (current repo flow)

GitLab CI (`.gitlab-ci.yml`) does:

- `yarn build`
- package backend artifact
- deploy artifact via SSH/rsync
- symlink shared `.env`
- `yarn install --production=true`
- restart with PM2

## Environment Variables (used in current code/config)

### App

| Variable   | Description         |
| ---------- | ------------------- |
| `NODE_ENV` | Runtime environment |
| `HOST`     | Server bind host    |
| `PORT`     | Server port         |
| `APP_KEYS` | Strapi app keys     |

### Database

| Variable                           | Description                |
| ---------------------------------- | -------------------------- |
| `DATABASE_CLIENT`                  | DB client (`postgres`)     |
| `DATABASE_URL`                     | Optional connection string |
| `DATABASE_HOST`                    | DB host                    |
| `DATABASE_PORT`                    | DB port                    |
| `DATABASE_NAME`                    | DB name                    |
| `DATABASE_USERNAME`                | DB user                    |
| `DATABASE_PASSWORD`                | DB password                |
| `DATABASE_SCHEMA`                  | DB schema                  |
| `DATABASE_SSL`                     | Enable SSL                 |
| `DATABASE_SSL_KEY`                 | SSL key                    |
| `DATABASE_SSL_CERT`                | SSL cert                   |
| `DATABASE_SSL_CA`                  | SSL CA                     |
| `DATABASE_SSL_CAPATH`              | SSL capath                 |
| `DATABASE_SSL_CIPHER`              | SSL cipher                 |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | SSL verify toggle          |
| `DATABASE_POOL_MIN`                | Pool min                   |
| `DATABASE_POOL_MAX`                | Pool max                   |
| `DATABASE_CONNECTION_TIMEOUT`      | Connection timeout         |

### Admin/Auth config

| Variable              | Description          |
| --------------------- | -------------------- |
| `ADMIN_JWT_SECRET`    | Admin JWT secret     |
| `API_TOKEN_SALT`      | API token salt       |
| `TRANSFER_TOKEN_SALT` | Transfer token salt  |
| `ENCRYPTION_KEY`      | Admin encryption key |
| `FLAG_NPS`            | Strapi admin flag    |
| `FLAG_PROMOTE_EE`     | Strapi admin flag    |

### Upload / S3

| Variable                  | Description                          |
| ------------------------- | ------------------------------------ |
| `S3_PROVIDER`             | Use `localstack` for localstack mode |
| `AWS_S3_BUCKET`           | Upload bucket                        |
| `AWS_REGION`              | Bucket region                        |
| `AWS_S3_ENDPOINT`         | S3 endpoint (LocalStack)             |
| `AWS_S3_FORCE_PATH_STYLE` | Path-style mode for LocalStack       |
| `AWS_ACCESS_KEY_ID`       | S3 access key                        |
| `AWS_SECRET_ACCESS_KEY`   | S3 secret key                        |
| `AWS_S3_BASE_URL`         | Optional S3 base URL override        |
| `AWS_S3_ROOT_PATH`        | Upload root path                     |

## Useful Scripts

| Script                              | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| `yarn develop` / `yarn dev`         | Start development server                               |
| `yarn start`                        | Start production server                                |
| `yarn build`                        | Build admin + compile TS                               |
| `yarn seed:example`                 | Seed sample `global` data                              |
| `yarn permissions:export`           | Export current role permissions from DB to code config |
| `yarn permissions:sync`             | Apply role permissions from code config to DB          |
| `yarn openapi`                      | Generate + merge OpenAPI docs                          |
| `yarn lint` / `yarn lint:fix`       | ESLint                                                 |
| `yarn format` / `yarn format:check` | Prettier                                               |

## Project Structure

- `src/api/*`: content-types, controllers, routes, services
- `src/extensions/users-permissions/*`: users-permissions customizations
- `src/utils/*`: tenant/auth/pagination/token/import/S3 helpers
- `config/*`: server/database/admin/plugins/middlewares config
- `docs/*`: OpenAPI files
- `database/migrations`: currently no actual migration files

## Operational Notes

- Role types `student`, `teacher`, `school_admin` must exist in users-permissions.
- Permissions source-of-truth is `config/users-permissions/permissions.json`.
- Recommended flow:
  - run `yarn permissions:export` from an environment where role permissions are correct
  - commit `config/users-permissions/permissions.json`
  - run `yarn permissions:sync` on target environments
- CI deploy runs `yarn permissions:sync` automatically before PM2 restart.
- Per `school_admin`, only one `academic_year` can be `active`, and only one can be `pending`.
- Project uploads use S3 provider; project update/delete includes S3 object cleanup.
- Important custom endpoints include:
  - `POST /students/login-by-qr`
  - `POST /teachers/login-by-passcode`
  - `POST /projects/upload`
  - `POST /class-assignments/assign`
  - `POST /students/import`, `POST /teachers/import`, `POST /school-admins/import`
  - `GET /classes/by-academic-year` (for student create flow; accepts only `active|pending` academic year)

## Troubleshooting

- DB connection issues: verify `DATABASE_HOST`/`DATABASE_PORT` against running Postgres.
- Role resolution errors: ensure role types `student|teacher|school_admin` exist.
- Upload errors: verify S3 bucket/region/endpoint/credentials.
