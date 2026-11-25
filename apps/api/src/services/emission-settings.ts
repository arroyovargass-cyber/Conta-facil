import type { AppConfig } from "../config";
import type { HaciendaEnvironment } from "../../../../packages/domain/src/hacienda-environment";

/** Only explicitly enabled fiscal environments may consume durable queue attempts. */
export function enabledEmissionEnvironments(
  config: AppConfig,
): HaciendaEnvironment[] {
  const environments: HaciendaEnvironment[] = [];
  if (config.HACIENDA_STAG_EMISSION_ENABLED === "true")
    environments.push("test");
  if (config.HACIENDA_PRODUCTION_EMISSION_ENABLED === "true")
    environments.push("production");
  return environments;
}
