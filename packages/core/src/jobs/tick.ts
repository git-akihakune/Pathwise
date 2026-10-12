import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";

async function userIds(db: DbOrTx, query: SQL): Promise<string[]> {
  const r = await db.execute<{ user_id: string }>(query);
  return r.rows.map((row) => row.user_id);
}

/**
 * Users needing a snapshot refresh, and users with rows whose embedding is missing or from a
 * different model than their effective embedding model. Users whose provider config cannot
 * embed (auth-failed, unusable, deleted, or an unusable embedding reference) are skipped, as
 * their jobs would be no-ops that the next tick re-enqueues.
 */
export async function findMaintenanceWork(
  db: DbOrTx,
): Promise<{ snapshot: string[]; embed: string[] }> {
  const snapshot = await userIds(
    db,
    sql`select us.user_id from user_settings us
        left join user_snapshot s on s.user_id = us.user_id
        where us.profile_version > coalesce(s.profile_version, 0)
        order by us.user_id`,
  );
  const embed = await userIds(
    db,
    sql`with eff as (
          select u.id as user_id, pc.models->>'embedding' as model
          from "user" u
          left join user_settings us on us.user_id = u.id
          left join instance_settings i on i.id = 1
          join provider_configs pc
            on pc.id = coalesce(us.provider_config_id, i.instance_provider_config_id)
          where pc.status in ('full', 'degraded')
            and not pc.auth_failed
            and pc.models->>'embedding' is not null
            and (
              coalesce(pc.models->>'embeddingProviderConfigId', pc.id::text) = pc.id::text
              or exists (
                select 1 from provider_configs ref
                where ref.id::text = pc.models->>'embeddingProviderConfigId'
                  and ref.user_id is not distinct from pc.user_id
                  and not ref.auth_failed
              )
            )
        )
        select eff.user_id from eff
        where exists (
            select 1 from memory_items m
            where m.user_id = eff.user_id and m.status in ('active', 'pending')
              and (m.embedding is null or m.embedding_model is distinct from eff.model)
          ) or exists (
            select 1 from stories st
            where st.user_id = eff.user_id
              and (st.embedding is null or st.embedding_model is distinct from eff.model)
          ) or exists (
            select 1 from sessions se
            where se.user_id = eff.user_id and se.summary is not null
              and (se.summary_embedding is null or se.summary_embedding_model is distinct from eff.model)
          )
        order by eff.user_id`,
  );
  return { snapshot, embed };
}
