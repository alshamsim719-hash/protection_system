// تخزين بيانات القنوات قبل حذفها
let channelBackup = new Map();

// عند إنشاء قناة — نخزن بياناتها للعودة لها لاحقاً
client.on("channelCreate", async channel => {
  channelBackup.set(channel.id, {
    name: channel.name,
    type: channel.type,
    parent: channel.parentId,
    position: channel.position,
    perms: channel.permissionOverwrites.cache.map(ow => ({
      id: ow.id,
      allow: ow.allow.bitfield,
      deny: ow.deny.bitfield,
      type: ow.type
    }))
  });
});

// عند تعديل قناة — رجّعها لو التعديل غير مسموح
client.on("channelUpdate", async (oldCh, newCh) => {
  const logs = await newCh.guild.fetchAuditLogs({ limit: 1, type: 11 });
  const entry = logs.entries.first();
  if (!entry) return;

  const executor = entry.executor;
  if (!executor || whitelist.includes(executor.id)) return;

  // رجوع للاسم القديم
  if (newCh.name !== oldCh.name) {
    newCh.edit({ name: oldCh.name }).catch(() => {});
  }

  // رجوع للكATEGORY القديمة
  if (newCh.parentId !== oldCh.parentId) {
    newCh.setParent(oldCh.parentId).catch(() => {});
  }

  // عقاب الشخص
  const member = newCh.guild.members.cache.get(executor.id);
  if (member) {
    for (const role of member.roles.cache.values()) {
      member.roles.remove(role, "Channel protection").catch(() => {});
    }
  }
});

// عند حذف قناة — رجعها فوراً
client.on("channelDelete", async channel => {
  const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 });
  const entry = logs.entries.first();
  if (!entry) return;

  const executor = entry.executor;

  // إذا الشخص فوق الحماية → مسموح
  if (executor && whitelist.includes(executor.id)) return;

  // عقاب الحاذف
  const member = channel.guild.members.cache.get(executor?.id);
  if (member) {
    for (const role of member.roles.cache.values()) {
      await member.roles.remove(role, "Deleted a channel without access");
    }
  }

  // استرجاع القناة
  const data = channelBackup.get(channel.id);
  if (!data) return;

  channel.guild.channels.create({
    name: data.name,
    type: data.type,
    parent: data.parent,
    position: data.position,
    permissionOverwrites: data.perms
  }).catch(() => {});
});
