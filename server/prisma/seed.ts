
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Loading backup data from backup.json...");
  const rawData = fs.readFileSync(path.join(__dirname, "backup.json"), "utf-8");
  const data = JSON.parse(rawData);

  console.log("Cleaning Database safely...");
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.taskCommentReaction.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklist.deleteMany();
  await prisma.subtask.deleteMany();
  await prisma.taskNotification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.listStatus.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.page.deleteMany();
  await prisma.doc.deleteMany();
  await prisma.list.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.messageNotification.deleteMany();
  await prisma.messageReaction.deleteMany();
  await prisma.messageMention.deleteMany();
  await prisma.messageReadReceipt.deleteMany();
  await prisma.savedMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.channelMember.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.teamRole.deleteMany();
  await prisma.workspaceRole.deleteMany();
  await prisma.team.deleteMany();

  console.log("Seeding Backup Data...");
  
  if (data.team?.length) await prisma.team.createMany({ data: data.team, skipDuplicates: true });
  if (data.workspaceRole?.length) await prisma.workspaceRole.createMany({ data: data.workspaceRole, skipDuplicates: true });
  if (data.teamRole?.length) await prisma.teamRole.createMany({ data: data.teamRole, skipDuplicates: true });
  if (data.user?.length) await prisma.user.createMany({ data: data.user, skipDuplicates: true });
  if (data.space?.length) await prisma.space.createMany({ data: data.space, skipDuplicates: true });
  if (data.folder?.length) await prisma.folder.createMany({ data: data.folder, skipDuplicates: true });
  if (data.list?.length) await prisma.list.createMany({ data: data.list, skipDuplicates: true });
  if (data.listStatus?.length) await prisma.listStatus.createMany({ data: data.listStatus, skipDuplicates: true });
  if (data.doc?.length) await prisma.doc.createMany({ data: data.doc, skipDuplicates: true });
  if (data.page?.length) await prisma.page.createMany({ data: data.page, skipDuplicates: true });
  if (data.task?.length) await prisma.task.createMany({ data: data.task, skipDuplicates: true });
  if (data.subtask?.length) await prisma.subtask.createMany({ data: data.subtask, skipDuplicates: true });
  if (data.checklist?.length) await prisma.checklist.createMany({ data: data.checklist, skipDuplicates: true });
  if (data.checklistItem?.length) await prisma.checklistItem.createMany({ data: data.checklistItem, skipDuplicates: true });
  if (data.taskComment?.length) await prisma.taskComment.createMany({ data: data.taskComment, skipDuplicates: true });
  if (data.favorite?.length) await prisma.favorite.createMany({ data: data.favorite, skipDuplicates: true });
  if (data.channel?.length) await prisma.channel.createMany({ data: data.channel, skipDuplicates: true });
  if (data.channelMember?.length) await prisma.channelMember.createMany({ data: data.channelMember, skipDuplicates: true });
  if (data.message?.length) await prisma.message.createMany({ data: data.message, skipDuplicates: true });

  console.log("✅ Seed complete! All backup data restored.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
