import { customType } from "drizzle-orm/pg-core";

/** pgvector column of any dimension. Vectors travel as text literals, so no client library is needed. */
export const anyVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (v) => `[${v.join(",")}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});

export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});
