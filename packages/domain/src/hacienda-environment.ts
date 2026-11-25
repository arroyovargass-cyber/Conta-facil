import { z } from "zod";

/** Fiscal environment; independent of the Node execution environment. */
export const haciendaEnvironmentInput = z
  .enum(["test", "production"])
  .default("test");
export type HaciendaEnvironment = z.infer<typeof haciendaEnvironmentInput>;
