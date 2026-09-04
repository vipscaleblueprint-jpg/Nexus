import { PrismaClient, SystemRole, RoleType, EmploymentType, Priority, EntityType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Nexus User & Project Data Seeding...');

  // Clean existing database records safely in dependency order
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.subChannel.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklist.deleteMany();
  await prisma.subtask.deleteMany();
  await prisma.task.deleteMany();
  await prisma.statusRule.deleteMany();
  await prisma.taskColumn.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.doc.deleteMany();
  await prisma.list.deleteMany();
  await prisma.subfolder.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();

  console.log('🧹 Cleaned existing database tables.');

  // ---------------------------------------------------------------------------
  // 1. TEAMS
  // ---------------------------------------------------------------------------
  const devTeam = await prisma.team.create({
    data: {
      name: 'Dev Team',
      description: 'Core Engineering, Backend, Frontend, Infrastructure',
      color: '#3B82F6',
    },
  });

  const designTeam = await prisma.team.create({
    data: {
      name: 'Design Team',
      description: 'UI/UX Design, Asset Creation, Visual Branding',
      color: '#EC4899',
    },
  });

  const productionTeam = await prisma.team.create({
    data: {
      name: 'Production Team',
      description: 'Media Pipeline, Editing, Project Execution',
      color: '#8B5CF6',
    },
  });

  const marketingTeam = await prisma.team.create({
    data: {
      name: 'Marketing Team',
      description: 'Client Acquisition, Social Media, Growth Operations',
      color: '#F59E0B',
    },
  });

  const managementTeam = await prisma.team.create({
    data: {
      name: 'Management Team',
      description: 'Executive Management, Quality Assurance, Strategic Ops',
      color: '#10B981',
    },
  });

  console.log('✅ Created 5 Dynamic Teams.');

  // ---------------------------------------------------------------------------
  // 2. USERS (Provided User Roster with Password "akhlys11")
  // ---------------------------------------------------------------------------
  const hashedPassword = await bcrypt.hash('akhlys11', 10);

  const rawUsers = [
    { name: 'Aneeka', email: 'aneekay.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1RTZbuyOU9fi_GhuRkyPSEKhoFlcM-0sOI4oCYJ4b5V8/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.PM, secondaryRole: RoleType.CRM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: managementTeam },
    { name: 'Bea', email: 'villaluzbb.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1gCN9DOVCIP8v5GhSSoV0VDHZ3yDEcDVA_O7TK7z2d74/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.DESIGNER, secondaryRole: RoleType.TECH, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: designTeam },
    { name: 'Blessie', email: 'blessieb.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1JEsZbIeKikeNn_DOJ6ESwLpPJ9OXbdOHg89ELh8buOA', primaryRole: RoleType.AUDITOR, secondaryRole: RoleType.PM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: managementTeam },
    { name: 'Dana', email: 'jrteams.danamariesabrine@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1G1iWkAaA96YDhPmZxZKrKsMuE3qPn9DCwVi87dtKSCU', primaryRole: RoleType.CRM, secondaryRole: RoleType.PM, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: marketingTeam },
    { name: 'Nyrry', email: 'nyrrya.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1ZOZNPCxJtYJtQTaDlQu-Mi5f8E3PrMS2AXUJ3TkX4lw/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.TECH, secondaryRole: RoleType.PM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: devTeam },
    { name: 'Erica', email: 'banarese.vipscale@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1LubIpKiY6hEUgH4sMA-xNJlMB87ko1C4rc4enMfhFIE/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.DESIGNER, secondaryRole: RoleType.CRM, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: designTeam },
    { name: 'Ruth', email: 'laysonr.vipscale@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1LkfQp6u4km_Ef6Tx3oCmX7qVJpmUx99gmI566fhN4CM/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.PM, secondaryRole: RoleType.AUDITOR, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: managementTeam },
    { name: 'Zybryx', email: 'zybryxmontinola.edu@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1r-Kj5h2jGRmrI1RcjBDCr6a1UT27KFDFUYWamQwXkkA/edit?gid=1995084145#gid=1995084145', isAdmin: true, primaryRole: RoleType.ADMIN, secondaryRole: RoleType.TECH, tertiaryRole: RoleType.PM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: devTeam },
    { name: 'Mimi', email: 'ronilal.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1sb_AOg0Cu6rRij-NkPQCs1QXyw6bdlDq-OGyCrDNJe0/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.TECH, secondaryRole: RoleType.DESIGNER, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: devTeam },
    { name: 'Hannah', email: 'hannahmays.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1ac9BeNkybC6nL3k93o6PUCD2gtDkWlA9WqkLamAZNM8', primaryRole: RoleType.CRM, secondaryRole: RoleType.DESIGNER, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: marketingTeam },
    { name: 'Rogell', email: 'rogells.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1LPIRoxEiiH1YpcxaFIfU32mIDDy7PBw5AbY1eHWAKIc/edit', primaryRole: RoleType.TECH, secondaryRole: RoleType.AUDITOR, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: devTeam },
    { name: 'Gie', email: 'giemilb.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1N_0tSS91graSX_u2buDuYEAt3dnvcwjZ5Yxj7U3MsNs', primaryRole: RoleType.DESIGNER, secondaryRole: RoleType.PM, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: designTeam },
    { name: 'Shemuel', email: 'shemuelrei.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1pGZXxgwZAWWRw-7OQYNJ0R1JIdWj2HkoJ1xVHY6P_eg/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.TECH, secondaryRole: RoleType.PM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: productionTeam },
    { name: 'Patrick', email: 'patrickjohnf.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1VB00EwtLgq7J8hKhjX0YOt8PMLi_E6PKQ7WwUoexaxU', primaryRole: RoleType.PM, secondaryRole: RoleType.TECH, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: productionTeam },
    { name: 'Cherilyn', email: 'cherilynd.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/18jVD5aL8Pd0ipNM1PKsGtFZba5tB76rE4b69tHPYW3M/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.AUDITOR, secondaryRole: RoleType.CRM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: managementTeam },
    { name: 'Leo', email: 'leojaye.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1PNvrARQ17vwAeUntF1FZp8RN-XVKBs-UTLl3smauy9s/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.TECH, secondaryRole: RoleType.DESIGNER, starRating: 2, employmentType: EmploymentType.PART_TIME, team: devTeam },
    { name: 'Pau2x', email: 'paupau.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1TlpDKHn49nRfnhO9D3P0PyKuGNrFilpNwKyZj7LfQLs/edit?usp=sharing', primaryRole: RoleType.DESIGNER, secondaryRole: RoleType.TECH, starRating: 2, employmentType: EmploymentType.FULL_TIME, team: designTeam },
    { name: 'Darlene', email: 'darlene.vipscaleph@gmail.com', dailySheetUrl: null, primaryRole: RoleType.CRM, secondaryRole: RoleType.PM, starRating: 1, employmentType: EmploymentType.INTERN, team: marketingTeam },
    { name: 'Aaron', email: 'aaronpaulv.vipscaleph@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1Ydt21Yi-3F1IV5N4AfMSC-Q7uNFjRO3x376qgVCzMwk/edit?gid=1995084145#gid=1995084145', primaryRole: RoleType.TECH, secondaryRole: RoleType.PM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: devTeam },
    { name: 'Jenesia', email: 'jenesia.red07@gmail.com', dailySheetUrl: 'https://docs.google.com/spreadsheets/d/1VQumVLCKNfzYZv2op43UPd5VlQRK5QCYnhtUPLqxbyU', isAdmin: true, primaryRole: RoleType.ADMIN, secondaryRole: RoleType.PM, tertiaryRole: RoleType.CRM, starRating: 3, employmentType: EmploymentType.FULL_TIME, team: managementTeam },
  ];

  const createdUsers: Record<string, any> = {};

  for (const u of rawUsers) {
    const user = await prisma.user.create({
      data: {
        email: u.email,
        password: hashedPassword,
        name: u.name,
        avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name)}`,
        imageUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name)}`,
        dailySheetUrl: u.dailySheetUrl,
        starRating: u.starRating,
        employmentType: u.employmentType,
        isActive: true,
        systemRole: u.isAdmin ? SystemRole.ADMIN : SystemRole.MEMBER,
        primaryRole: u.primaryRole,
        secondaryRole: u.secondaryRole,
        tertiaryRole: (u as any).tertiaryRole || null,
        teamId: u.team.id,
      },
    });
    createdUsers[u.name] = user;
  }

  console.log(`✅ Created ${rawUsers.length} Users. (Admins: Zybryx, Jenesia)`);

  const zybryxUser = createdUsers['Zybryx'];
  const jenesiaUser = createdUsers['Jenesia'];
  const blessieAuditor = createdUsers['Blessie'];
  const rogellDev = createdUsers['Rogell'];
  const beaDesigner = createdUsers['Bea'];

  // ---------------------------------------------------------------------------
  // 3. WORKSPACE HIERARCHY (Spaces, Folders, Subfolders, Lists, Docs)
  // ---------------------------------------------------------------------------
  const mainSpace = await prisma.space.create({
    data: {
      name: '🚀 Nexus Enterprise Workspaces',
      icon: 'rocket',
      color: '#4F46E5',
      ownerId: zybryxUser.id,
    },
  });

  const crmSpace = await prisma.space.create({
    data: {
      name: '🤝 Client Operations & Growth',
      icon: 'briefcase',
      color: '#10B981',
      ownerId: jenesiaUser.id,
    },
  });

  const sprintFolder = await prisma.folder.create({
    data: {
      name: 'Q4 Product Roadmap & Delivery',
      spaceId: mainSpace.id,
    },
  });

  const sprintSubfolder = await prisma.subfolder.create({
    data: {
      name: 'Sprint 2026-09 Core Features',
      folderId: sprintFolder.id,
    },
  });

  const taskList = await prisma.list.create({
    data: {
      name: 'Tasks & Feature Execution',
      spaceId: mainSpace.id,
      folderId: sprintFolder.id,
      subfolderId: sprintSubfolder.id,
    },
  });

  const todayDoc = await prisma.doc.create({
    data: {
      title: 'Priorities for Today - 2026-09-03',
      docDate: new Date('2026-09-03'),
      content: `
        <h1>🎯 Daily Priorities - Nexus Team</h1>
        <p><strong>Admins:</strong> Zybryx & Jenesia</p>
        <p><strong>Goal:</strong> Complete Cloudflare R2 Upload verification and perform Auditor sign-off for release build.</p>
      `,
      spaceId: mainSpace.id,
      folderId: sprintFolder.id,
      subfolderId: sprintSubfolder.id,
    },
  });

  console.log('✅ Created Space, Folder, Subfolder, List, and Doc hierarchy.');

  // ---------------------------------------------------------------------------
  // 4. KANBAN COLUMNS, SUB-COLUMNS & WORKFLOW STATUS RULES
  // ---------------------------------------------------------------------------
  const colToDo = await prisma.taskColumn.create({
    data: {
      name: 'To Do',
      position: 0,
      color: '#64748B',
      listId: taskList.id,
    },
  });

  const colInDev = await prisma.taskColumn.create({
    data: {
      name: 'In Development',
      position: 1,
      color: '#3B82F6',
      listId: taskList.id,
    },
  });

  const colInReview = await prisma.taskColumn.create({
    data: {
      name: 'In Review',
      position: 2,
      color: '#EAB308',
      listId: taskList.id,
    },
  });

  const colInChecking = await prisma.taskColumn.create({
    data: {
      name: 'In Checking',
      position: 0,
      color: '#F59E0B',
      listId: taskList.id,
      parentColumnId: colInReview.id,
    },
  });

  await prisma.statusRule.create({
    data: {
      columnId: colInChecking.id,
      requireAllSubtasksComplete: true,
      requireAllChecklistItemsComplete: false,
      allowedRoles: ['PM', 'AUDITOR', 'ADMIN'],
    },
  });

  const colAudit = await prisma.taskColumn.create({
    data: {
      name: 'Audit Verification',
      position: 3,
      color: '#8B5CF6',
      listId: taskList.id,
    },
  });

  await prisma.statusRule.create({
    data: {
      columnId: colAudit.id,
      requireAllSubtasksComplete: false,
      requireAllChecklistItemsComplete: true,
      allowedRoles: ['AUDITOR', 'ADMIN'],
    },
  });

  const colClosed = await prisma.taskColumn.create({
    data: {
      name: 'Closed',
      position: 4,
      color: '#22C55E',
      listId: taskList.id,
    },
  });

  await prisma.statusRule.create({
    data: {
      columnId: colClosed.id,
      requireAllSubtasksComplete: true,
      requireAllChecklistItemsComplete: true,
      allowedRoles: ['CRM', 'PM', 'ADMIN'],
    },
  });

  console.log('✅ Created Kanban Columns, Sub-columns & Status Rules.');

  // ---------------------------------------------------------------------------
  // 5. TASKS, SUBTASKS, CHECKLISTS, COMMENTS & ATTACHMENTS
  // ---------------------------------------------------------------------------
  const task1 = await prisma.task.create({
    data: {
      title: 'Cloudflare R2 File Upload Integration & Pre-signed URLs',
      description: '<p>Implement S3-compatible file storage API for attachments across tasks and chat messages.</p>',
      clientName: 'VIP Scale Global',
      priority: Priority.URGENT,
      position: 0,
      listId: taskList.id,
      columnId: colInDev.id,
      assigneeUserId: rogellDev.id,
      assigneeTeamId: devTeam.id,
      creatorId: zybryxUser.id,
    },
  });

  await prisma.subtask.createMany({
    data: [
      { title: 'Setup R2 credentials in environment config', isDone: true, taskId: task1.id },
      { title: 'Implement Express upload controller', isDone: true, taskId: task1.id },
      { title: 'Verify presigned URL expiry logic', isDone: false, taskId: task1.id },
    ],
  });

  const checklist1 = await prisma.checklist.create({
    data: {
      title: 'R2 Security Audit Verification',
      taskId: task1.id,
    },
  });

  await prisma.checklistItem.createMany({
    data: [
      { text: 'Validate file mime types on server side', isDone: true, checklistId: checklist1.id, checkedByUserId: blessieAuditor.id, checkedAt: new Date() },
      { text: 'Enforce max payload size 100MB', isDone: true, checklistId: checklist1.id, checkedByUserId: blessieAuditor.id, checkedAt: new Date() },
    ],
  });

  await prisma.taskComment.create({
    data: {
      content: 'R2 storage configuration deployed to dev environment.',
      taskId: task1.id,
      userId: rogellDev.id,
    },
  });

  const task2 = await prisma.task.create({
    data: {
      title: 'Design Kanban Board & Sub-Column Interfaces',
      description: '<p>Design collapsible sub-columns for In-Review -> In-Checking workflow state.</p>',
      clientName: 'Nexus Core',
      priority: Priority.HIGH,
      position: 0,
      listId: taskList.id,
      columnId: colInReview.id,
      assigneeUserId: beaDesigner.id,
      assigneeTeamId: designTeam.id,
      creatorId: jenesiaUser.id,
    },
  });

  // ---------------------------------------------------------------------------
  // 6. FAVORITES
  // ---------------------------------------------------------------------------
  await prisma.favorite.create({
    data: {
      userId: zybryxUser.id,
      entityType: EntityType.SPACE,
      entityId: mainSpace.id,
    },
  });

  await prisma.favorite.create({
    data: {
      userId: jenesiaUser.id,
      entityType: EntityType.DOC,
      entityId: todayDoc.id,
    },
  });

  // ---------------------------------------------------------------------------
  // 7. CHANNELS, SUB-CHANNELS & DIRECT MESSAGES (DMs)
  // ---------------------------------------------------------------------------
  const announceChannel = await prisma.channel.create({
    data: {
      name: 'announcements',
      description: 'Company-wide updates and announcements',
      isPrivate: false,
    },
  });

  const subChannel = await prisma.subChannel.create({
    data: {
      name: 'general-chat',
      channelId: announceChannel.id,
    },
  });

  await prisma.message.create({
    data: {
      content: '🚀 Welcome team! All 20 users have been seeded into Nexus platform.',
      senderId: zybryxUser.id,
      channelId: announceChannel.id,
      subChannelId: subChannel.id,
    },
  });

  await prisma.message.create({
    data: {
      content: 'Hey Rogell, let me know if you need review on the R2 upload endpoint.',
      senderId: jenesiaUser.id,
      receiverId: rogellDev.id,
    },
  });

  console.log('\n🎉 Demo Seeding Completed Successfully!');
  console.log('---------------------------------------------------------');
  console.log('Password for ALL users: akhlys11');
  console.log('Admins:');
  console.log('  👑 Zybryx:  zybryxmontinola.edu@gmail.com');
  console.log('  👑 Jenesia: jenesia.red07@gmail.com');
  console.log('---------------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
