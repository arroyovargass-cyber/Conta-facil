import {
  haciendaEnvironmentInput,
  type HaciendaEnvironment,
} from "../../../../packages/domain/src/hacienda-environment";

const profiles = Object.freeze({
  test: Object.freeze({
    environment: "test" as const,
    label: "Pruebas",
    realm: "rut-stag",
    clientId: "api-stag",
    idpBase:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/",
    receptionBase:
      "https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/",
  }),
  production: Object.freeze({
    environment: "production" as const,
    label: "Producción",
    realm: "rut",
    clientId: "api-prod",
    idpBase:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/",
    receptionBase: "https://api.comprobanteselectronicos.go.cr/recepcion/v1/",
  }),
});

/** Official published profiles only; an invalid environment never selects another one. */
export function haciendaProfile(environment: HaciendaEnvironment) {
  return profiles[haciendaEnvironmentInput.parse(environment)];
}
