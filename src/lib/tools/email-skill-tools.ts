import { tool } from "ai";
import { z } from "zod";
import { eq, and, or, desc } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import { db } from "@/db";

const scopeEnum = z.enum(["user", "profile", "campaign"]);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export const listEmailSkills = tool({
  description:
    "List email skills (catalog entries) available to the current user — both built-ins and their own custom skills. Optionally filter to those attached to a given scope (user default / a profile / a campaign).",
  inputSchema: z.object({
    scopeType: scopeEnum
      .optional()
      .describe("If provided with scopeId, returns which skills are attached."),
    scopeId: z
      .string()
      .optional()
      .describe("Scope ID to check attachments against."),
  }),
  execute: async ({ scopeType, scopeId }) => {
    const sdb = await getScopedDb();

    const skills = await sdb.raw
      .select({
        id: schema.emailSkills.id,
        name: schema.emailSkills.name,
        slug: schema.emailSkills.slug,
        description: schema.emailSkills.description,
        isBuiltin: schema.emailSkills.isBuiltin,
        clerkUserId: schema.emailSkills.clerkUserId,
      })
      .from(schema.emailSkills)
      .orderBy(desc(schema.emailSkills.isBuiltin), schema.emailSkills.name);

    let attached: Set<string> = new Set();
    if (scopeType && scopeId) {
      const attachments = await sdb.raw
        .select({ skillId: schema.emailSkillAttachments.skillId })
        .from(schema.emailSkillAttachments)
        .where(
          and(
            eq(schema.emailSkillAttachments.scopeType, scopeType),
            eq(schema.emailSkillAttachments.scopeId, scopeId),
            eq(schema.emailSkillAttachments.enabled, true),
          ),
        );
      attached = new Set(attachments.map((a) => a.skillId));
    }

    return {
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        isBuiltin: s.isBuiltin,
        attached: attached.has(s.id),
      })),
    };
  },
});

export const getEmailSkillDetail = tool({
  description:
    "Fetch full detail (including the instructions markdown) for a single email skill.",
  inputSchema: z.object({
    skillId: z.string().uuid().describe("email_skills.id"),
  }),
  execute: async ({ skillId }) => {
    const [data] = await db
      .select()
      .from(schema.emailSkills)
      .where(eq(schema.emailSkills.id, skillId))
      .limit(1);

    if (!data) {
      return { error: "Skill not found" };
    }
    return data;
  },
});

export const createEmailSkill = tool({
  description:
    "Create a custom email skill. Skills are markdown rule packs merged into the email composer's system prompt. Keep instructions tight — one or two short paragraphs of rules.",
  inputSchema: z.object({
    name: z
      .string()
      .min(2)
      .max(80)
      .describe("Display name, e.g. 'Founder voice'."),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional()
      .describe("URL-safe slug. Generated from name if omitted."),
    description: z
      .string()
      .max(200)
      .optional()
      .describe("One-line summary for the catalog UI."),
    instructions: z
      .string()
      .min(10)
      .describe(
        "Markdown body injected into the email composer's system prompt. Plain imperative rules work best.",
      ),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    const [data] = await sdb.raw
      .insert(schema.emailSkills)
      .values({
        clerkUserId: sdb.userId,
        name: input.name,
        slug: input.slug ?? slugify(input.name),
        description: input.description ?? null,
        instructions: input.instructions,
        isBuiltin: false,
      })
      .returning();

    if (!data) throw new Error("Failed to create skill");
    return { skill: data, message: `Created skill "${input.name}"` };
  },
});

export const updateEmailSkill = tool({
  description:
    "Update a custom email skill. Built-in skills cannot be edited — fork them by creating a new skill instead.",
  inputSchema: z.object({
    skillId: z.string().uuid(),
    name: z.string().optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
  }),
  execute: async (input) => {
    const patch: Partial<typeof schema.emailSkills.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.instructions !== undefined)
      patch.instructions = input.instructions;

    if (Object.keys(patch).length === 0) {
      return { error: "No fields provided to update." };
    }

    const [data] = await db
      .update(schema.emailSkills)
      .set(patch)
      .where(
        and(
          eq(schema.emailSkills.id, input.skillId),
          eq(schema.emailSkills.isBuiltin, false),
        ),
      )
      .returning();

    if (!data) {
      return {
        error:
          "Skill not found or is built-in (built-in skills can't be edited — create a custom skill instead).",
      };
    }
    return { skill: data, message: `Updated skill "${data.name}"` };
  },
});

export const deleteEmailSkill = tool({
  description: "Delete a custom email skill. Does not work on built-ins.",
  inputSchema: z.object({
    skillId: z.string().uuid(),
  }),
  execute: async ({ skillId }) => {
    await db
      .delete(schema.emailSkills)
      .where(
        and(
          eq(schema.emailSkills.id, skillId),
          eq(schema.emailSkills.isBuiltin, false),
        ),
      );
    return { skillId, message: "Skill deleted." };
  },
});

export const toggleEmailSkill = tool({
  description:
    "Attach or detach an email skill at a given scope. scopeType='user' applies the skill to every draft the caller makes; 'profile' scopes it to a sender profile; 'campaign' scopes it to one campaign. Pass enabled=false (or call with a previously-attached skill) to detach.",
  inputSchema: z.object({
    skillId: z.string().uuid(),
    scopeType: scopeEnum,
    scopeId: z
      .string()
      .describe(
        "Scope ID: the user's auth id for 'user', profile id for 'profile', campaign id for 'campaign'.",
      ),
    enabled: z.boolean().default(true),
  }),
  execute: async (input) => {
    const [data] = await db
      .insert(schema.emailSkillAttachments)
      .values({
        skillId: input.skillId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [
          schema.emailSkillAttachments.skillId,
          schema.emailSkillAttachments.scopeType,
          schema.emailSkillAttachments.scopeId,
        ],
        set: { enabled: input.enabled },
      })
      .returning();

    return {
      attachment: data,
      message: `Skill ${input.enabled ? "attached" : "detached"} at ${input.scopeType} scope.`,
    };
  },
});
