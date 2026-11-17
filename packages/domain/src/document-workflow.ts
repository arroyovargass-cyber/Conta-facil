import { z } from "zod";
export const workflowFlow = z.enum(["collections", "payables"]);
export const workflowState = z.enum([
  "pending",
  "in_review",
  "resolved",
  "archived",
]);
export const routeInput = z
  .object({
    flow: workflowFlow,
    expected_version: z.number().int().min(0).max(2147483646),
    target_department_id: z.uuid(),
    assignee_id: z.uuid().nullable(),
    enabled: z.boolean(),
  })
  .strict();
export const workInput = z
  .object({
    expected_version: z.number().int().min(1).max(2147483646),
    expected_source_version: z.number().int().min(1).max(2147483646),
    state: workflowState,
    assignee_id: z.uuid().nullable(),
  })
  .strict();
