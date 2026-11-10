/** Server-only transaction: no half-linked public lab or private build can commit. */
import "server-only";
import postgres from "postgres";
import { LOCAL_RUNNER_RUNTIME_VERSION } from "./local-runner/protocol";
import { PostgresWebLabControlRepository } from "./postgres-control-repository";
import type {
  ExecutableWebSaveStore, ExecutableWebSaveTransaction, GenerationJobForBuild,
  SavedExecutableWebLab,
} from "./generated-executable-lab";

type Sql = ReturnType<typeof postgres>;

export class PostgresExecutableWebSaveStore implements ExecutableWebSaveStore {
  readonly production = true as const;
  constructor(private readonly db: Sql) {}

  async transaction<T>(work: (transaction: ExecutableWebSaveTransaction) => Promise<T>): Promise<T> {
    const result = await this.db.begin(async (sql) => {
      // The existing build repository uses only Sql's query tag in these methods.
      const builds = new PostgresWebLabControlRepository(sql as unknown as Sql);
      const transaction: ExecutableWebSaveTransaction = {
        async lockedJob(jobId, ownerId) {
          const rows = await sql`
            select status, category, difficulty, duration, resulting_lab_id
            from public.lab_generation_jobs
            where id = ${jobId} and user_id = ${ownerId}
            for update
          `;
          if (rows.length !== 1) return null;
          const row = rows[0];
          return {
            status: String(row.status), category: String(row.category),
            difficulty: String(row.difficulty), duration: String(row.duration),
            resultingLabId: row.resulting_lab_id ? String(row.resulting_lab_id) : null,
          } satisfies GenerationJobForBuild;
        },
        ownedBuild(savedLabId, ownerId) {
          return builds.getBuildMetadata(savedLabId, ownerId);
        },
        async insertSavedLab(lab: SavedExecutableWebLab) {
          const rows = await sql`
            insert into public.labs (
              user_id, title, topic, difficulty, estimated_time, objective,
              scenario, tasks, hints, outcomes, completed
            ) values (
              ${lab.user_id}, ${lab.title}, ${lab.topic}, ${lab.difficulty},
              ${lab.estimated_time}, ${lab.objective}, ${lab.scenario},
              ${sql.json(lab.tasks)}, ${sql.json(lab.hints)},
              ${sql.json(lab.outcomes)}, ${lab.completed}
            ) returning id
          `;
          if (rows.length !== 1) throw new Error("GENERATION_SAVED_LAB_INSERT_FAILED");
          return String(rows[0].id);
        },
        createBuild({ savedLabId, ownerId, spec }) {
          return builds.createBuild({ savedLabId, ownerId, spec, runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION });
        },
        async linkJob(jobId, ownerId, savedLabId) {
          const rows = await sql`
            update public.lab_generation_jobs set resulting_lab_id = ${savedLabId}, updated_at = now()
            where id = ${jobId} and user_id = ${ownerId} and status = 'generating'
              and resulting_lab_id is null
            returning id
          `;
          if (rows.length !== 1) throw new Error("GENERATION_JOB_LINK_FAILED");
        },
      };
      return work(transaction);
    });
    return result as T;
  }
}
