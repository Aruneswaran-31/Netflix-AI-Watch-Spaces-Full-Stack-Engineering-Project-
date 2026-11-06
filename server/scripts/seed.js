'use strict';

const config = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/db');
const { seedDatabase } = require('../src/seed');
const { createLogger } = require('../src/lib/logger');

const log = createLogger('seed-script');

(async () => {
  try {
    await connectDatabase();
    const seeded = await seedDatabase({ refreshTimelines: true });
    log.info('seed_script_done', { seeded });
    console.log('\nSeed complete.');
    console.log('Demo accounts:');
    console.log(`  admin  ${config.seed.adminEmail}  ${config.seed.adminPassword}`);
    console.log(`  host   ${config.seed.hostEmail}   ${config.seed.hostPassword}`);
    console.log(`  viewer ${config.seed.viewerEmail} ${config.seed.viewerPassword}`);
    console.log('\nDemo room invite code: NX-DEMO (Sintel)\n');
  } catch (error) {
    log.error('seed_failed', { message: error.message, stack: error.stack });
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
})();
