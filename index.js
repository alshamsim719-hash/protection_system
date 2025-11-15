require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  AuditLogEvent
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.GuildMember]
});

// === إعدادات المالك / الحماية ===
const OWNER_ID = "1253251616765775882"; // انت
let whitelist = [OWNER_ID]; // أنت دائماً فوق الحماية

function isOwner(id) {
  return id === OWNER_ID;
}

function addToWhitelist(id) {
  if (!whitelist.includes(id)) whitelist.push(id);
}

async function punishMember(guild, userId, reason = "حماية السيرفر") {
  const member = guild.members.cache.get(userId);
  if (!member) return;
  try {
    for (const role of member.roles.cache.values()) {
      if (role.managed) continue; // لا تلمس رتب البوتات المدارة
      await member.roles.remove(role, reason);
    }
  } catch (err) {
    console.log("خطأ أثناء معاقبة العضو:", err);
  }
}

// === نسخ إعدادات السيرفر (الاسم) عند التشغيل ===
const guildSettings = new Map();
const channelBackup = new Map(); // لنسخ القنوات

client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.guilds.cache.forEach(guild => {
    guildSettings.set(guild.id, {
      name: guild.name
    });
    guild.channels.cache.forEach(ch => {
      channelBackup.set(ch.id, {
        name: ch.name,
        type: ch.type,
        parent: ch.parentId,
        position: ch.position,
        perms: ch.permissionOverwrites.cache.map(ow => ({
          id: ow.id,
          allow: ow.allow.bitfield,
          deny: ow.deny.bitfield,
          type: ow.type
        }))
      });
    });
  });
});

// ========== أمر run @الشخص لإضافة فوق الحماية ==========
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  const content = msg.content.trim();

  if (content.startsWith("run")) {
    // كلمة run خاصة بالمالك
    if (!isOwner(msg.author.id)) {
      return msg.reply("❌ هذه الكلمة خاصة بالمالك فقط.");
    }

    const mentioned = msg.mentions.users.first();
    if (!mentioned) {
      return msg.reply("⚠️ استخدم: `run @الشخص`");
    }

    addToWhitelist(mentioned.id);
    return msg.reply(`✅ تم إضافة **${mentioned.username}** إلى قائمة الحماية 👑`);
  }
});

// ========== حماية اسم السيرفر ==========
client.on("guildUpdate", async (oldGuild, newGuild) => {
  try {
    const logs = await newGuild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.GuildUpdate
    });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || whitelist.includes(executor.id)) return;

    const backup = guildSettings.get(newGuild.id) || { name: oldGuild.name };

    // إذا تم تغيير الاسم بدون إذن → نرجعه
    if (newGuild.name !== backup.name) {
      await newGuild.edit({ name: backup.name }, "إرجاع اسم السيرفر - حماية");
    }

    await punishMember(newGuild, executor.id, "محاولة تغيير اسم السيرفر بدون إذن");
  } catch (err) {
    console.log("خطأ في حماية اسم السيرفر:", err);
  }
});

// ========== نسخ القنوات عند إنشائها ==========
client.on("channelCreate", async (channel) => {
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

// ========== حماية تعديل القنوات ==========
client.on("channelUpdate", async (oldCh, newCh) => {
  try {
    const logs = await newCh.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelUpdate
    });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || whitelist.includes(executor.id)) return;

    // رجوع الاسم و الكاتيجوري
    const editData = {};
    if (newCh.name !== oldCh.name) editData.name = oldCh.name;
    if (newCh.parentId !== oldCh.parentId) editData.parent = oldCh.parentId;

    if (Object.keys(editData).length > 0) {
      await newCh.edit(editData, "إرجاع القناة لوضعها الأصلي - حماية");
    }

    await punishMember(newCh.guild, executor.id, "تعديل قناة بدون إذن");
  } catch (err) {
    console.log("خطأ في حماية channelUpdate:", err);
  }
});

// ========== حماية وحفظ القنوات عند الحذف (مع استرجاعها) ==========
client.on("channelDelete", async (channel) => {
  try {
    const logs = await channel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelDelete
    });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;

    if (executor && whitelist.includes(executor.id)) return;

    if (executor) {
      await punishMember(channel.guild, executor.id, "حذف قناة بدون إذن");
    }

    const data = channelBackup.get(channel.id);
    if (!data) return;

    await channel.guild.channels.create({
      name: data.name,
      type: data.type,
      parent: data.parent,
      position: data.position,
      permissionOverwrites: data.perms
    });
  } catch (err) {
    console.log("خطأ في حماية channelDelete:", err);
  }
});

// ========== حماية الرتب: إنشاء رتب جديدة ==========
client.on("roleCreate", async (role) => {
  try {
    const logs = await role.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.RoleCreate
    });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || whitelist.includes(executor.id)) return;

    // حذف الرتبة الجديدة
    await role.delete("إنشاء رتبة بدون إذن - حماية");
    await punishMember(role.guild, executor.id, "إنشاء رتبة بدون إذن");
  } catch (err) {
    console.log("خطأ في roleCreate:", err);
  }
});

// ========== حماية الرتب على الأعضاء (إضافة / إزالة) ==========
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());

    const added = [...newRoles].filter(id => !oldRoles.has(id));   // رتب انضافت
    const removed = [...oldRoles].filter(id => !newRoles.has(id)); // رتب انشالت

    if (!added.length && !removed.length) return;

    const logs = await newMember.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.MemberRoleUpdate
    });

    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || whitelist.includes(executor.id)) return;
    if (executor.id === newMember.id) return; // تجاهل لو عدل على نفسه

    // إرجاع الرتب المنزالة
    for (const roleId of removed) {
      const role = newMember.guild.roles.cache.get(roleId);
      if (role) {
        await newMember.roles.add(role, "إرجاع الرتبة التي انشالت بدون إذن");
      }
    }

    // إزالة الرتب التي انضافت
    for (const roleId of added) {
      const role = newMember.guild.roles.cache.get(roleId);
      if (role) {
        await newMember.roles.remove(role, "إزالة رتبة مضافة بدون إذن");
      }
    }

    await punishMember(newMember.guild, executor.id, "تعديل رتب عضو بدون إذن");
  } catch (err) {
    console.log("خطأ في guildMemberUpdate:", err);
  }
});

// ========== حماية الباند: فك الباند إذا كان بدون إذن ==========
client.on("guildBanAdd", async (ban) => {
  try {
    const guild = ban.guild;
    const logs = await guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.MemberBanAdd
    });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || whitelist.includes(executor.id)) return;

    // فك الباند عن الشخص الذي تم تبنيده
    await guild.members.unban(ban.user, "باند بدون إذن - فك تلقائي");
    await punishMember(guild, executor.id, "إعطاء باند بدون إذن");
  } catch (err) {
    console.log("خطأ في guildBanAdd:", err);
  }
});

// ========== حماية إضافة البوتات ==========
client.on("guildMemberAdd", async (member) => {
  if (!member.user.bot) return;
  try {
    const logs = await member.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.BotAdd
    });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || whitelist.includes(executor.id)) return;

    // طرد البوت الذي تم إضافته
    await member.kick("إضافة بوت بدون إذن - حماية");
    await punishMember(member.guild, executor.id, "إضافة بوت بدون إذن");
  } catch (err) {
    console.log("خطأ في حماية البوتات:", err);
  }
});

client.login(MTQxNzA1MDY0ODYyNDc1ODc4NA.GQ13j7.PrricnUe0lyu4mGNI-C-r5LOJy78y3zA1-7iOk);
