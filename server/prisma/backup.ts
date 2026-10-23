import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function runBackup() {
  console.log("📦 Starting DB backup...");
  const data: Record<string, any> = {
    team: await prisma.team.findMany(),
    workspaceRole: await prisma.workspaceRole.findMany(),
    teamRole: await prisma.teamRole.findMany(),
    user: await prisma.user.findMany(),
    space: await prisma.space.findMany(),
    folder: await prisma.folder.findMany(),
    list: await prisma.list.findMany(),
    listStatus: await prisma.listStatus.findMany(),
    doc: await prisma.doc.findMany(),
    page: await prisma.page.findMany(),
    task: await prisma.task.findMany(),
    subtask: await prisma.subtask.findMany(),
    checklist: await prisma.checklist.findMany(),
    checklistItem: await prisma.checklistItem.findMany(),
    taskComment: await prisma.taskComment.findMany(),
    taskCommentReaction: await prisma.taskCommentReaction.findMany(),
    attachment: await prisma.attachment.findMany(),
    channel: await prisma.channel.findMany(),
    channelMember: await prisma.channelMember.findMany(),
    message: await prisma.message.findMany(),
    messageAttachment: await prisma.messageAttachment.findMany(),
    messageReaction: await prisma.messageReaction.findMany(),
    messageMention: await prisma.messageMention.findMany(),
    messageReadReceipt: await prisma.messageReadReceipt.findMany(),
    savedMessage: await prisma.savedMessage.findMany(),
    messageNotification: await prisma.messageNotification.findMany(),
    taskNotification: await prisma.taskNotification.findMany(),
    auditLog: await prisma.auditLog.findMany(),
    invitation: await prisma.invitation.findMany(),
    apiKey: await prisma.apiKey.findMany(),
  };

  const backupFilePath = path.join(__dirname, `backup-pre-confetti-${Date.now()}.json`);
  // Handle BigInt serialization
  const serialized = JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
  fs.writeFileSync(backupFilePath, serialized, "utf-8");
  console.log(`✅ Backup successfully saved to ${backupFilePath} (${(Buffer.byteLength(serialized) / 1024).toFixed(1)} KB)`);
  await prisma.$disconnect();
}

runBackup().catch((err) => {
  console.error("❌ Backup failed:", err);
  process.exit(1);
});
