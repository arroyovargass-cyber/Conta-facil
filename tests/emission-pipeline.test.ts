import { rootCertificates } from "node:tls";
import { X509Certificate } from "node:crypto";
import {
  calculateInvoice,
  lineFiscalInput,
} from "../packages/domain/src/invoice-fiscal";
import { describe, it, expect, vi } from "vitest";
import { EmissionPipeline } from "../apps/api/src/services/emission-pipeline";
import {
  encryptCredential,
  parseKeyring,
} from "../apps/api/src/security/credential-vault";
const policyOverride = vi.hoisted(() => ({ url: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readFile: async (...args: any[]) => {
      const result = await (original.readFile as any)(...args);
      if (
        policyOverride.url &&
        String(args[0]).endsWith("signature-policy.provenance.json")
      ) {
        const metadata = JSON.parse(String(result));
        metadata.source_url = policyOverride.url;
        return JSON.stringify(metadata);
      }
      return result;
    },
  };
});
const config: any = {
  NODE_ENV: "test",
  SESSION_KEY: "11".repeat(32),
  HACIENDA_KEYRING: JSON.stringify({ a: "22".repeat(32) }),
  HACIENDA_ACTIVE_KEY_ID: "a",
  HACIENDA_STAG_EMISSION_ENABLED: "true",
  HACIENDA_SOFTWARE_PROVIDER_ID: "3101234567",
  HACIENDA_RESPONSE_CERTIFICATE_PINS: JSON.stringify(["ab".repeat(32)]),
  HACIENDA_PRODUCTION_RESPONSE_CERTIFICATE_PINS: JSON.stringify([
    "cd".repeat(32),
  ]),
};
function harness(kind = "transmit", state = "queued") {
  const job: any = {
    id: "job",
    tenant_id: "tenant",
    invoice_id: "invoice",
    environment: "test",
    kind,
    lease_token: "lease",
    attempts: 1,
  };
  const doc: any = {
    id: "invoice",
    tenant_id: "tenant",
    environment: "test",
    document_status: "issued",
    signature_status: "signed",
    credential_version: 2,
    transmission_status: state,
    hacienda_status: "pending",
    issued_at: "2026-01-01T00:00:00Z",
    clave: "1".repeat(50),
    snapshot: {
      issuer: {
        identification: "123",
        identification_type: "02",
        configuration: { billing: { send_email: true } },
      },
      receiver: { identification: "456", identification_type: "01" },
      totals: calculateInvoice([
        {
          quantity: "1",
          unit_price: "100",
          description: "Servicio",
          fiscal: lineFiscalInput.parse({
            cabys: "1234567890123",
            unit: "Unid",
            treatment: "taxable",
            tariff_code: "08",
          }),
        },
      ]),
    },
  };
  const encrypted = encryptCredential(
    Buffer.from(JSON.stringify({ username: "u", password: "p" })),
    { tenantId: "tenant", environment: "test", version: 2, kind: "api_access" },
    parseKeyring(config.HACIENDA_KEYRING, "a", config.SESSION_KEY)!,
  );
  const credentials = {
    tenant_id: "tenant",
    environment: "test",
    version: 2,
    api_key_id: encrypted.keyId,
    api_ciphertext: encrypted.blob,
  };
  const deps: any = {
    jobs: {
      claim: vi.fn(
        async (
          _limit: number,
          environments: string[],
          policies?: Record<string, readonly string[]>,
        ) =>
          environments.includes(job.environment) &&
          (!policies ||
            policies[job.environment]?.includes(
              doc.response_trust_policy ?? "pinned_certificate",
            ))
            ? [job]
            : [],
      ),
      finish: vi.fn().mockResolvedValue(true),
    },
    store: {
      document: vi.fn().mockResolvedValue(doc),
      credentials: vi.fn().mockResolvedValue(credentials),
      update: vi.fn(async (_j, p) => {
        Object.assign(doc, p);
        return doc;
      }),
    },
    artifact: vi.fn().mockResolvedValue(Buffer.from("<signed/>")),
    enqueue: vi.fn(),
    validateResponse: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    tokens: { withAccess: vi.fn(async (a, fn) => fn("token")) },
    reception: {
      submit: vi.fn().mockResolvedValue({ status: "received" }),
      query: vi.fn().mockResolvedValue({ status: "pending" }),
    },
  };
  return {
    job,
    doc,
    deps,
    pipeline: new EmissionPipeline({} as any, config, deps),
  };
}
describe("emission pipeline fencing and reconciliation", () => {
  it("rejects production dependency overrides", () => {
    expect(
      () =>
        new EmissionPipeline(
          {} as any,
          { ...config, NODE_ENV: "production" },
          {},
        ),
    ).toThrow("TEST_OVERRIDES_ONLY");
  });
  it("writes uncertainty before submission and queues reconciliation, without accepting HTTP receipt", async () => {
    const h = harness();
    h.deps.reception.submit.mockImplementation(async () => {
      expect(h.doc.transmission_status).toBe("uncertain");
      return { status: "received" };
    });
    expect(await h.pipeline.runBatch()).toEqual({ processed: 1 });
    expect(h.doc.transmission_status).toBe("sent");
    expect(h.doc.hacienda_status).toBe("pending");
    expect(h.deps.enqueue).toHaveBeenCalledWith(h.job, "query");
  });
  it("never resubmits uncertain transmissions", async () => {
    const h = harness("transmit", "uncertain");
    await h.pipeline.runBatch();
    expect(h.deps.reception.submit).not.toHaveBeenCalled();
    expect(h.deps.tokens.withAccess).not.toHaveBeenCalled();
    expect(h.deps.enqueue).toHaveBeenCalledWith(h.job, "query");
  });
  it("rechecks live authorization before submission", async () => {
    const h = harness();
    h.deps.store.document
      .mockResolvedValueOnce(h.doc)
      .mockResolvedValueOnce(h.doc)
      .mockResolvedValue(null);
    await h.pipeline.runBatch();
    expect(h.deps.reception.submit).not.toHaveBeenCalled();
    expect(h.deps.jobs.finish).toHaveBeenCalledWith(
      h.job,
      expect.objectContaining({ status: "failed" }),
    );
  });
  it("keeps 404 uncertain for manual reconciliation", async () => {
    const h = harness("query", "uncertain");
    h.deps.reception.query.mockResolvedValue({ status: "not_found" });
    await h.pipeline.runBatch();
    expect(h.doc.transmission_status).toBe("uncertain");
    expect(h.deps.jobs.finish).toHaveBeenCalledWith(h.job, {
      status: "failed",
      errorCode: "MANUAL_RECONCILIATION_REQUIRED",
    });
  });
  it("rejects unsigned acceptance without persisting response or final state", async () => {
    const h = harness("query", "sent");
    h.deps.reception.query.mockResolvedValue({
      status: "reported_accepted",
      responseXml: "<fake/>",
    });
    h.deps.verify = vi.fn().mockReturnValue({ status: "blocked" });
    await h.pipeline.runBatch();
    expect(h.doc.hacienda_status).toBe("pending");
    expect(h.deps.artifact).toHaveBeenCalledTimes(1);
  });
  it("bounds pending query attempts", async () => {
    const h = harness("query", "sent");
    h.job.attempts = 8;
    await h.pipeline.runBatch();
    expect(h.deps.jobs.finish).toHaveBeenCalledWith(
      h.job,
      expect.objectContaining({ status: "failed", errorCode: "QUERY_RETRY" }),
    );
  });
  it("does not invoke transport when activation is disabled", async () => {
    const h = harness();
    const p = new EmissionPipeline(
      {} as any,
      { ...config, HACIENDA_STAG_EMISSION_ENABLED: "false" },
      h.deps,
    );
    await p.runBatch();
    expect(h.deps.reception.submit).not.toHaveBeenCalled();
  });
  it("validates bounded batches before claiming", async () => {
    const h = harness();
    await expect(h.pipeline.runBatch(5)).rejects.toThrow("INVALID_CLAIM_LIMIT");
    expect(h.deps.jobs.claim).not.toHaveBeenCalled();
  });
  it("only persists a response after its signature and snapshot match", async () => {
    const h = harness("query", "sent");
    h.deps.reception.query.mockResolvedValue({
      status: "reported_accepted",
      responseXml: "<verified/>",
    });
    h.deps.verify = vi.fn().mockReturnValue({ status: "accepted" });
    await new EmissionPipeline({} as any, config, h.deps).runBatch();
    expect(h.doc.hacienda_status).toBe("accepted");
    expect(h.deps.artifact).toHaveBeenCalledWith(
      h.job,
      "hacienda_response",
      Buffer.from("<verified/>"),
    );
    expect(h.deps.enqueue).toHaveBeenCalledWith(h.job, "pdf");
    expect(h.deps.verify).toHaveBeenCalledWith(
      "<verified/>",
      expect.objectContaining({ total: "113.00000", tax: "13.00000" }),
      ["ab".repeat(32)],
    );
  });
  it("never generates a PDF for a pending invoice", async () => {
    const h = harness("pdf");
    h.deps.pdf = vi.fn();
    await h.pipeline.runBatch();
    expect(h.deps.pdf).not.toHaveBeenCalled();
  });
  it("does not automatically resend an email marked processing", async () => {
    const h = harness("email");
    h.doc.hacienda_status = "accepted";
    h.doc.email_status = "processing";
    h.deps.mail = { send: vi.fn() };
    const pipeline = new EmissionPipeline(
      {} as any,
      {
        ...config,
        SMTP_HOST: "localhost",
        SMTP_PORT: 2525,
        SMTP_FROM: "issuer@example.com",
      } as any,
      h.deps,
    );
    await pipeline.runBatch();
    expect(h.deps.mail.send).not.toHaveBeenCalled();
    expect(h.deps.jobs.finish).toHaveBeenCalledWith(
      h.job,
      expect.objectContaining({ status: "uncertain" }),
    );
  });
  it("pauses disabled configuration without consuming a queue attempt", async () => {
    const h = harness();
    await new EmissionPipeline(
      {} as any,
      { ...config, HACIENDA_STAG_EMISSION_ENABLED: "false" },
      h.deps,
    ).runBatch();
    expect(h.deps.jobs.claim).not.toHaveBeenCalled();
  });
  it("excludes pinned documents without consuming an attempt when their trust pins are missing", async () => {
    const h = harness();
    await new EmissionPipeline(
      {} as any,
      { ...config, HACIENDA_RESPONSE_CERTIFICATE_PINS: "[]" },
      h.deps,
    ).runBatch();
    expect(h.deps.jobs.claim).toHaveBeenCalledWith(1, ["test"], {
      test: ["official_api"],
    });
    expect(h.deps.jobs.finish).not.toHaveBeenCalled();
  });
  it("rejects a response failing full MH XSD before cryptographic verification", async () => {
    const h = harness("query", "sent");
    h.deps.validateResponse.mockResolvedValue({
      valid: false,
      issues: ["XSD_INVALID"],
    });
    h.deps.verify = vi.fn().mockReturnValue({ status: "accepted" });
    h.deps.reception.query.mockResolvedValue({
      status: "reported_accepted",
      responseXml: "<bad/>",
    });
    await new EmissionPipeline({} as any, config, h.deps).runBatch();
    expect(h.deps.verify).not.toHaveBeenCalled();
    expect(h.doc.hacienda_status).toBe("pending");
    expect(h.deps.artifact).toHaveBeenCalledTimes(1);
  });
  it("cryptographically verifies resumed XML even when certificate and XSD match", async () => {
    const h = harness("sign");
    h.doc.public_certificate_pem = rootCertificates[0];
    h.doc.certificate_fingerprint = new X509Certificate(
      rootCertificates[0],
    ).fingerprint256
      .replaceAll(":", "")
      .toLowerCase();
    h.deps.validate = vi.fn().mockResolvedValue({ valid: true, issues: [] });
    h.deps.verifyInvoice = vi.fn().mockReturnValue(false);
    await new EmissionPipeline({} as any, config, h.deps).runBatch();
    expect(h.deps.verifyInvoice).toHaveBeenCalledWith(
      "<signed/>",
      rootCertificates[0],
    );
    expect(h.deps.store.update).not.toHaveBeenCalled();
    expect(h.deps.enqueue).not.toHaveBeenCalled();
  });
  it("rejects a modified policy URL even when policy bytes and digests remain pinned", async () => {
    const h = harness("sign");
    h.deps.artifact.mockResolvedValue(undefined);
    policyOverride.url = "https://attacker.example/policy.pdf";
    try {
      await h.pipeline.runBatch();
      expect(h.deps.store.credentials).not.toHaveBeenCalled();
      expect(h.deps.jobs.finish).toHaveBeenCalledWith(
        h.job,
        expect.objectContaining({ status: "failed" }),
      );
    } finally {
      policyOverride.url = "";
    }
  });
  it.each([false, undefined])(
    "persists accepted PDF without enqueueing email when frozen send_email is %s",
    async (sendEmail) => {
      const h = harness("pdf");
      h.doc.hacienda_status = "accepted";
      h.doc.snapshot.receiver.email = "receiver@example.com";
      h.doc.snapshot.issuer.configuration.billing.send_email = sendEmail;
      h.deps.artifact.mockResolvedValue(undefined);
      h.deps.pdf = vi.fn().mockResolvedValue(Buffer.from("PDF"));
      await new EmissionPipeline(
        {} as any,
        {
          ...config,
          SMTP_HOST: "localhost",
          SMTP_PORT: 2525,
          SMTP_FROM: "issuer@example.com",
        } as any,
        h.deps,
      ).runBatch();
      expect(h.deps.artifact).toHaveBeenCalledWith(
        h.job,
        "pdf",
        Buffer.from("PDF"),
      );
      expect(h.deps.enqueue).not.toHaveBeenCalled();
    },
  );
  it.each([false, undefined])(
    "blocks direct email jobs without SMTP effect when frozen send_email is %s",
    async (sendEmail) => {
      const h = harness("email");
      h.doc.hacienda_status = "accepted";
      h.doc.email_status = "queued";
      h.doc.snapshot.receiver.email = "receiver@example.com";
      h.doc.snapshot.issuer.configuration.billing.send_email = sendEmail;
      h.deps.mail = {
        send: vi.fn().mockResolvedValue({ status: "provider_accepted" }),
      };
      await new EmissionPipeline(
        {} as any,
        {
          ...config,
          SMTP_HOST: "localhost",
          SMTP_PORT: 2525,
          SMTP_FROM: "issuer@example.com",
        } as any,
        h.deps,
      ).runBatch();
      expect(h.deps.mail.send).not.toHaveBeenCalled();
      expect(h.deps.store.update).not.toHaveBeenCalled();
    },
  );
  it("enqueues email for an accepted PDF only when frozen send_email is explicitly true", async () => {
    const h = harness("pdf");
    h.doc.hacienda_status = "accepted";
    h.doc.snapshot.receiver.email = "receiver@example.com";
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        SMTP_HOST: "localhost",
        SMTP_PORT: 2525,
        SMTP_FROM: "issuer@example.com",
      } as any,
      h.deps,
    ).runBatch();
    expect(h.deps.enqueue).toHaveBeenCalledWith(h.job, "email");
  });
  it("enqueues customer email from the explicit frozen opt-in with a valid sender address", async () => {
    const h = harness("pdf");
    h.doc.hacienda_status = "accepted";
    h.doc.snapshot.receiver.email = "receiver@example.com";
    h.doc.snapshot.issuer.configuration.billing = {
      email_delivery_enabled: true,
      send_email: "billing@example.com",
    };
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        SMTP_HOST: "localhost",
        SMTP_PORT: 2525,
        SMTP_FROM: "issuer@example.com",
      } as any,
      h.deps,
    ).runBatch();
    expect(h.deps.enqueue).toHaveBeenCalledWith(h.job, "email");
    expect(h.doc.email_status).not.toBe("provider_accepted");
  });
  it.each([
    { email_delivery_enabled: false, send_email: true },
    { send_email: "billing@example.com" },
  ])(
    "does not enqueue delivery without explicit opt-in: %j",
    async (billing) => {
      const h = harness("pdf");
      h.doc.hacienda_status = "accepted";
      h.doc.snapshot.receiver.email = "receiver@example.com";
      h.doc.snapshot.issuer.configuration.billing = billing;
      await new EmissionPipeline(
        {} as any,
        {
          ...config,
          SMTP_HOST: "localhost",
          SMTP_PORT: 2525,
          SMTP_FROM: "issuer@example.com",
        } as any,
        h.deps,
      ).runBatch();
      expect(h.deps.enqueue).not.toHaveBeenCalled();
    },
  );
  it("runs an opted-in email job and only records provider acceptance after the mail result", async () => {
    const h = harness("email");
    h.doc.hacienda_status = "accepted";
    h.doc.email_status = "queued";
    h.doc.snapshot.receiver.email = "receiver@example.com";
    h.doc.snapshot.issuer.configuration.billing = {
      email_delivery_enabled: true,
      send_email: "billing@example.com",
    };
    h.deps.mail = {
      send: vi.fn(async () => {
        expect(h.doc.email_status).toBe("processing");
        return { status: "provider_accepted" };
      }),
    };
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        SMTP_HOST: "localhost",
        SMTP_PORT: 2525,
        SMTP_FROM: "issuer@example.com",
      } as any,
      h.deps,
    ).runBatch();
    expect(h.deps.mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "receiver@example.com" }),
    );
    expect(h.doc.email_status).toBe("provider_accepted");
  });
  it("blocks a direct email job when an explicit opt-out overrides a legacy snapshot", async () => {
    const h = harness("email");
    h.doc.hacienda_status = "accepted";
    h.doc.email_status = "queued";
    h.doc.snapshot.receiver.email = "receiver@example.com";
    h.doc.snapshot.issuer.configuration.billing = {
      email_delivery_enabled: false,
      send_email: true,
    };
    h.deps.mail = { send: vi.fn() };
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        SMTP_HOST: "localhost",
        SMTP_PORT: 2525,
        SMTP_FROM: "issuer@example.com",
      } as any,
      h.deps,
    ).runBatch();
    expect(h.deps.mail.send).not.toHaveBeenCalled();
    expect(h.deps.store.update).not.toHaveBeenCalled();
  });
  it("routes production jobs through production credentials, token client and reception without claiming STAG", async () => {
    const h = harness();
    h.job.environment = h.doc.environment = "production";
    const encrypted = encryptCredential(
      Buffer.from(
        JSON.stringify({ username: "production-user", password: "secret" }),
      ),
      {
        tenantId: "tenant",
        environment: "production",
        version: 2,
        kind: "api_access",
      },
      parseKeyring(config.HACIENDA_KEYRING, "a", config.SESSION_KEY)!,
    );
    h.deps.store.credentials.mockResolvedValue({
      tenant_id: "tenant",
      environment: "production",
      version: 2,
      api_key_id: encrypted.keyId,
      api_ciphertext: encrypted.blob,
    });
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        HACIENDA_STAG_EMISSION_ENABLED: "false",
        HACIENDA_PRODUCTION_EMISSION_ENABLED: "true",
      },
      h.deps,
    ).runBatch(2);
    expect(h.deps.jobs.claim).toHaveBeenCalledWith(2, ["production"], {
      production: ["official_api", "pinned_certificate"],
    });
    expect(h.deps.tokens.withAccess).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Function),
      "production",
    );
    expect(h.deps.reception.submit).toHaveBeenCalledWith(
      "token",
      expect.any(Object),
      "production",
    );
    expect(h.doc.transmission_status).toBe("sent");
  });
  it("rejects a credential row from a different environment before opening a token session", async () => {
    const h = harness();
    h.job.environment = h.doc.environment = "production";
    await new EmissionPipeline(
      {} as any,
      { ...config, HACIENDA_PRODUCTION_EMISSION_ENABLED: "true" },
      h.deps,
    ).runBatch();
    expect(h.deps.tokens.withAccess).not.toHaveBeenCalled();
    expect(h.deps.reception.submit).not.toHaveBeenCalled();
  });
  it("keeps reported official-API acceptance pending when the result has no authentic provenance", async () => {
    const h = harness("query", "sent");
    h.doc.response_trust_policy = "official_api";
    h.deps.reception.query.mockResolvedValue({
      status: "reported_accepted",
      reportedState: "aceptado",
      responseXml: "<fake/>",
    });
    const p = new EmissionPipeline(
      {} as any,
      {
        ...config,
        HACIENDA_RESPONSE_TRUST_POLICY: "official_api",
        HACIENDA_RESPONSE_CERTIFICATE_PINS: undefined,
      },
      h.deps,
    );
    await p.runBatch();
    expect(h.deps.jobs.claim).toHaveBeenCalledWith(1, ["test"], {
      test: ["official_api"],
    });
    expect(h.deps.reception.query).toHaveBeenCalledWith(
      "token",
      h.doc.clave,
      "test",
      { tenantId: "tenant", credentialVersion: 2 },
    );
    expect(h.doc.hacienda_status).toBe("pending");
  });
  it("persists official-API evidence before promoting a correlated signed result to final status", async () => {
    const h = harness("query", "sent");
    h.doc.response_trust_policy = "official_api";
    const result = { status: "reported_accepted", responseXml: "<verified/>" };
    const evidence = {
      method: "official_api",
      synthetic: false,
      responseSha256: "ab".repeat(32),
    };
    h.deps.reception.query.mockResolvedValue(result);
    h.deps.verifyOfficial = vi
      .fn()
      .mockResolvedValue({ status: "accepted", issues: [] });
    h.deps.readEvidence = vi.fn().mockReturnValue(evidence);
    h.deps.observeResponse = vi.fn(async () => {
      expect(h.doc.hacienda_status).toBe("pending");
      expect(h.deps.artifact).toHaveBeenCalledWith(
        h.job,
        "hacienda_response",
        Buffer.from("<verified/>"),
      );
      return true;
    });
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        HACIENDA_RESPONSE_TRUST_POLICY: "official_api",
        HACIENDA_RESPONSE_CERTIFICATE_PINS: undefined,
      },
      h.deps,
    ).runBatch();
    expect(h.deps.verifyOfficial).toHaveBeenCalledWith(
      result,
      expect.objectContaining({
        issuerIdentificationType: "02",
        receiverIdentificationType: "01",
      }),
      { tenantId: "tenant", environment: "test", credentialVersion: 2 },
    );
    expect(h.deps.observeResponse).toHaveBeenCalledWith(
      h.job,
      expect.any(String),
      evidence,
    );
    expect(h.doc.hacienda_status).toBe("accepted");
  });
  it("does not accept an API result when its immutable evidence could not be stored", async () => {
    const h = harness("query", "sent");
    h.doc.response_trust_policy = "official_api";
    h.deps.reception.query.mockResolvedValue({
      status: "reported_accepted",
      responseXml: "<verified/>",
    });
    h.deps.verifyOfficial = vi
      .fn()
      .mockResolvedValue({ status: "accepted", issues: [] });
    h.deps.readEvidence = vi
      .fn()
      .mockReturnValue({ method: "official_api", synthetic: false });
    h.deps.observeResponse = vi.fn().mockResolvedValue(false);
    await new EmissionPipeline(
      {} as any,
      { ...config, HACIENDA_RESPONSE_TRUST_POLICY: "official_api" },
      h.deps,
    ).runBatch();
    expect(h.doc.hacienda_status).toBe("pending");
    expect(h.deps.enqueue).not.toHaveBeenCalled();
  });
  it("rejects a claimed job whose document belongs to another tenant or fiscal environment", async () => {
    for (const field of ["tenant_id", "environment"]) {
      const h = harness();
      h.doc[field] = field === "tenant_id" ? "other-tenant" : "production";
      await h.pipeline.runBatch();
      expect(h.deps.store.credentials).not.toHaveBeenCalled();
      expect(h.deps.reception.submit).not.toHaveBeenCalled();
    }
  });
  it("preserves a document's pinned policy when server defaults later change to official API", async () => {
    const h = harness("query", "sent");
    h.doc.response_trust_policy = "pinned_certificate";
    h.deps.verifyOfficial = vi.fn().mockResolvedValue({ status: "accepted" });
    h.deps.reception.query.mockResolvedValue({
      status: "reported_accepted",
      responseXml: "<untrusted/>",
    });
    await new EmissionPipeline(
      {} as any,
      {
        ...config,
        HACIENDA_RESPONSE_TRUST_POLICY: "official_api",
        HACIENDA_RESPONSE_CERTIFICATE_PINS: undefined,
      },
      h.deps,
    ).runBatch();
    expect(h.deps.verifyOfficial).not.toHaveBeenCalled();
    expect(h.doc.hacienda_status).toBe("pending");
  });
  it("keeps processing an official-API document when the new-document default changes to pins without configured pins", async () => {
    const h = harness("query", "sent");
    h.doc.response_trust_policy = "official_api";
    const pipeline = new EmissionPipeline(
      {} as any,
      {
        ...config,
        HACIENDA_RESPONSE_TRUST_POLICY: "pinned_certificate",
        HACIENDA_RESPONSE_CERTIFICATE_PINS: undefined,
      },
      h.deps,
    );
    expect(await pipeline.runBatch()).toEqual({ processed: 1 });
    expect(h.deps.reception.query).toHaveBeenCalled();
    expect(h.doc.transmission_status).toBe("processing");
    expect(h.doc.hacienda_status).toBe("pending");
  });
});
