import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export interface SpreadsheetSyncJobPayload {
  userId: string;
  userName: string;
  userEmail?: string | null;
  dailySheetUrl?: string | null;
  dailySheetLogId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
  sheetRow?: number | null;
  taskTitle: string;
  clientName: string;
  taskLink?: string | null;
  status?: string;
  timeIn?: string;
  timeOut?: string | null;
  timeTracker?: string | null;
  taskDeliverablesDescription?: string | null;
  taskUpdateAndDeliverables?: string | null;
  description?: string | null;
  date?: string;
  sheetName?: string;
  mode?: 'START' | 'STOP' | 'UPDATE';
  insertEmptyRowBeforeStart?: boolean;
}

export const SPREADSHEET_SYNC_JOB = 'syncSpreadsheetRow';

export const spreadsheetSyncQueue = new Queue<SpreadsheetSyncJobPayload>('SpreadsheetSync', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 3000, // 3s -> 6s -> 12s -> 24s -> 48s
    },
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});
