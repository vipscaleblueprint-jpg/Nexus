import { dailyRolloverQueue } from '../src/queues/dailyRollover.queue';
import { logger } from '../src/config/logger';

async function main() {
  logger.info('Manually triggering daily rollover check...');
  await dailyRolloverQueue.add('checkRollovers', {});
  logger.info('Job added to queue! Check the worker logs.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
