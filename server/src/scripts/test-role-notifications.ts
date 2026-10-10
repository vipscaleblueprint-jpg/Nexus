import { normalizeStatusKey, getStatusRoleCategory, findUsersByRoleCategory, getStatusChangeRecipients } from '../utils/roleNotification';
import { prisma } from '../config/prisma';

async function runTests() {
  console.log('--- Status Mapping Tests ---');
  const reviewTests = ['In Review', 'InReview', 'in review', 'Review'];
  const checkingTests = ['In Checking', 'Inchecking', 'in checking', 'Checking', 'checking'];
  const crmTests = ['CRM', 'Crm', 'crm', 'Client Relationship Manager', 'client relationship manager'];

  for (const s of reviewTests) {
    console.log(`  "${s}" => ${getStatusRoleCategory(s)} (expected: AUDITOR)`);
  }
  for (const s of checkingTests) {
    console.log(`  "${s}" => ${getStatusRoleCategory(s)} (expected: PM)`);
  }
  for (const s of crmTests) {
    console.log(`  "${s}" => ${getStatusRoleCategory(s)} (expected: CRM)`);
  }

  console.log('\n--- Real Role Category Matching in DB ---');
  try {
    const auditors = await findUsersByRoleCategory('AUDITOR');
    const pms = await findUsersByRoleCategory('PM');
    const crms = await findUsersByRoleCategory('CRM');

    console.log(`Auditor recipients found: ${auditors.length}`);
    console.log(`PM recipients found: ${pms.length}`);
    console.log(`CRM recipients found: ${crms.length}`);

    const sampleTask = await prisma.task.findFirst({
      select: { id: true, title: true, teamId: true, assigneeId: true }
    });

    if (sampleTask) {
      console.log(`\nSample task: "${sampleTask.title}" (Team: ${sampleTask.teamId || 'None'})`);
      const inReviewRecipients = await getStatusChangeRecipients('In Review', sampleTask);
      const inCheckingRecipients = await getStatusChangeRecipients('In Checking', sampleTask);
      const crmRecipients = await getStatusChangeRecipients('CRM', sampleTask);

      console.log(`  Recipients for "In Review": ${inReviewRecipients.length}`);
      console.log(`  Recipients for "In Checking": ${inCheckingRecipients.length}`);
      console.log(`  Recipients for "CRM": ${crmRecipients.length}`);
    }
  } catch (err) {
    console.error('DB query error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
