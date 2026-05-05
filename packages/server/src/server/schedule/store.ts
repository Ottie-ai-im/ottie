import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import { StoredScheduleSchema, type StoredSchedule } from "./types.js";

function generateScheduleId(): string {
  // 16-char hex (8 random bytes) — collision space ~1.8e19, safe vs the prior
  // 8-hex (4-byte) which had birthday collisions ~65k schedules in.
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export class ScheduleStore {
  private readonly logger?: Logger;

  constructor(
    private readonly dir: string,
    options?: { logger?: Logger },
  ) {
    this.logger = options?.logger;
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<StoredSchedule[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const results = await Promise.all(
      candidates.map(async (entry): Promise<StoredSchedule | null> => {
        const filePath = join(this.dir, entry.name);
        try {
          const content = await readFile(filePath, "utf-8");
          return StoredScheduleSchema.parse(JSON.parse(content));
        } catch (error) {
          // Quarantine corrupt files so we don't keep failing forever, and so
          // operators can recover them by hand if needed.
          await this.quarantineCorruptFile(filePath, error).catch(() => {
            // Quarantine itself failing is non-fatal; the next list() will retry.
          });
          return null;
        }
      }),
    );
    return results
      .filter((schedule): schedule is StoredSchedule => schedule !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<StoredSchedule | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return StoredScheduleSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async create(schedule: Omit<StoredSchedule, "id">): Promise<StoredSchedule> {
    // Defensive: avoid overwriting an existing schedule on the astronomically
    // unlikely chance of an ID collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = generateScheduleId();
      const existing = await this.get(id);
      if (!existing) {
        const created = { ...schedule, id };
        await this.put(created);
        return created;
      }
    }
    throw new Error("Unable to allocate a unique schedule id after 5 attempts");
  }

  async put(schedule: StoredSchedule): Promise<void> {
    await this.ensureDir();
    await writeFile(this.filePath(schedule.id), JSON.stringify(schedule, null, 2), "utf-8");
  }

  async delete(id: string): Promise<void> {
    await this.ensureDir();
    await rm(this.filePath(id), { force: true });
  }

  private async quarantineCorruptFile(filePath: string, error: unknown): Promise<void> {
    const target = `${filePath}.corrupt-${Date.now()}`;
    await rename(filePath, target);
    this.logger?.warn({ filePath, target, err: error }, "Quarantined corrupt schedule file");
  }
}
