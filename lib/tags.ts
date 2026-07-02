import { prisma } from "@/lib/prisma";

export async function saveMeetingTags(
  userId: string,
  meetingId: string,
  tagNames: string[]
): Promise<string[]> {
  const uniqueNames = Array.from(
    new Set(tagNames.map((t) => t.trim()).filter(Boolean))
  );
  if (uniqueNames.length === 0) return [];

  const existing = await prisma.topic.findMany({
    where: { userId, name: { in: uniqueNames } },
    select: { id: true, name: true },
  });
  const idByName = new Map(existing.map((t) => [t.name, t.id]));

  const topicIds: string[] = [];
  for (const name of uniqueNames) {
    let topicId = idByName.get(name);
    if (!topicId) {
      const created = await prisma.topic.create({
        data: { userId, name, status: "active" },
      });
      topicId = created.id;
      idByName.set(name, topicId);
    }
    topicIds.push(topicId);
  }

  await prisma.meetingTopic.deleteMany({ where: { meetingId } });
  await prisma.meetingTopic.createMany({
    data: topicIds.map((topicId) => ({ meetingId, topicId })),
    skipDuplicates: true,
  });

  return uniqueNames;
}
