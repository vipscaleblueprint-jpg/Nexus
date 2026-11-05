import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

export const DEFAULT_TASK_MAP_STATUS_OPTIONS = [
  { label: 'Sent', color: '#166534', textColor: '#dcfce7', order: 0 },
  { label: 'Available Task', color: '#1e3a8a', textColor: '#dbeafe', order: 1 },
  { label: 'To send', color: '#7f1d1d', textColor: '#fee2e2', order: 2 },
  { label: 'Follow up', color: '#f472b6', textColor: '#831843', order: 3 },
  { label: 'Done Review', color: '#64748b', textColor: '#f1f5f9', order: 4 },
  { label: 'Revision', color: '#a855f7', textColor: '#faf5ff', order: 5 },
  { label: 'CHE', color: '#d9777f', textColor: '#ffffff', order: 6 },
  { label: 'PAU', color: '#581c87', textColor: '#f3e8ff', order: 7 },
  { label: 'HAN', color: '#eab308', textColor: '#713f12', order: 8 },
  { label: 'URGENT TASK', color: '#991b1b', textColor: '#fee2e2', order: 9 },
  { label: 'UPWORK | HANNAH', color: '#f9a8d4', textColor: '#831843', order: 10 },
  { label: 'UPWORK | CHE', color: '#fa8072', textColor: '#ffffff', order: 11 },
  { label: 'UPWORK | PAU', color: '#9333ea', textColor: '#faf5ff', order: 12 },
];

export const DEFAULT_TASK_MAP_SHIFTS = [
  {
    shiftKey: 'DAY',
    name: 'Day',
    startHour: 8,
    startMinute: 0,
    endHour: 12,
    endMinute: 0,
    timezone: 'Asia/Manila',
    order: 0,
    isActive: true,
  },
  {
    shiftKey: 'NOON',
    name: 'Noon',
    startHour: 12,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    timezone: 'Asia/Manila',
    order: 1,
    isActive: true,
  },
  {
    shiftKey: 'NIGHT',
    name: 'Night',
    startHour: 17,
    startMinute: 0,
    endHour: 1,
    endMinute: 0,
    timezone: 'Asia/Manila',
    order: 2,
    isActive: true,
  },
];

async function seedTaskMap() {
  console.log('Seeding Task Map Status Options & Shift Configs...');

  for (const opt of DEFAULT_TASK_MAP_STATUS_OPTIONS) {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskMapStatusOption" ("id", "label", "color", "textColor", "order", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT ("label") DO UPDATE
       SET "color" = EXCLUDED."color",
           "textColor" = EXCLUDED."textColor",
           "order" = EXCLUDED."order",
           "updatedAt" = NOW()`,
      id,
      opt.label,
      opt.color,
      opt.textColor,
      opt.order
    );
  }
  console.log(`✅ Seeded ${DEFAULT_TASK_MAP_STATUS_OPTIONS.length} Task Map Status Options`);

  for (const shift of DEFAULT_TASK_MAP_SHIFTS) {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskMapShiftConfig" ("id", "shiftKey", "name", "startHour", "startMinute", "endHour", "endMinute", "timezone", "order", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT ("shiftKey") DO UPDATE
       SET "name" = EXCLUDED."name",
           "startHour" = EXCLUDED."startHour",
           "startMinute" = EXCLUDED."startMinute",
           "endHour" = EXCLUDED."endHour",
           "endMinute" = EXCLUDED."endMinute",
           "timezone" = EXCLUDED."timezone",
           "order" = EXCLUDED."order",
           "isActive" = EXCLUDED."isActive",
           "updatedAt" = NOW()`,
      id,
      shift.shiftKey,
      shift.name,
      shift.startHour,
      shift.startMinute,
      shift.endHour,
      shift.endMinute,
      shift.timezone,
      shift.order,
      shift.isActive
    );
  }
  console.log(`✅ Seeded ${DEFAULT_TASK_MAP_SHIFTS.length} Task Map Shift Configs`);

  await prisma.$disconnect();
}

seedTaskMap().catch((err) => {
  console.error('❌ Failed seeding Task Map:', err);
  process.exit(1);
});
