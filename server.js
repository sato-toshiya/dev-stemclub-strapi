/* eslint-disable @typescript-eslint/no-var-requires */

const strapi = require('@strapi/strapi');

async function main() {
  const app = strapi.createStrapi({ distDir: './dist' });
  await app.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
