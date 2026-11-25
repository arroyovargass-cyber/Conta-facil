import { expect, it } from "vitest";
import { haciendaEnvironmentInput } from "../packages/domain/src/hacienda-environment";
import { haciendaProfile } from "../apps/api/src/services/hacienda-environments";

it("admits only the two fiscal environments with a compatible test default", () => {
  expect(haciendaEnvironmentInput.parse(undefined)).toBe("test");
  expect(haciendaEnvironmentInput.parse("production")).toBe("production");
  for (const invalid of ["staging", "prod", "https://evil.test", null, ""])
    expect(haciendaEnvironmentInput.safeParse(invalid).success).toBe(false);
});

it("returns immutable closed official profiles without environment fallback", () => {
  expect(haciendaProfile("test")).toEqual({
    environment: "test",
    label: "Pruebas",
    realm: "rut-stag",
    clientId: "api-stag",
    idpBase:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/",
    receptionBase:
      "https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/",
  });
  expect(haciendaProfile("production")).toEqual({
    environment: "production",
    label: "Producción",
    realm: "rut",
    clientId: "api-prod",
    idpBase:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/",
    receptionBase: "https://api.comprobanteselectronicos.go.cr/recepcion/v1/",
  });
  expect(Object.isFrozen(haciendaProfile("production"))).toBe(true);
  expect(() => haciendaProfile("prod" as any)).toThrow();
});
