import { expect, it, vi } from "vitest";
import { InvoiceMail } from "../apps/api/src/services/invoice-mail";
const input = {
  invoiceId: "private-invoice-id",
  recipient: "customer@example.com",
  companyName: "Empresa prueba",
  xml: Buffer.from("<xml/>"),
  pdf: Buffer.from("%PDF-"),
  haciendaResponse: Buffer.from("<respuesta/>"),
};
const config = {
  host: "localhost",
  port: 1025,
  secure: false,
  from: "invoices@example.com",
  environment: "test" as const,
};
it("uses server sender, stable opaque Message-ID and fixed attachments", async () => {
  const sendMail = vi.fn().mockResolvedValue({ accepted: [input.recipient] });
  const mail = new InvoiceMail({ ...config, transport: { sendMail } });
  const result = await mail.send(input);
  await mail.send(input);
  expect(result.status).toBe("provider_accepted");
  const sent = sendMail.mock.calls[0][0];
  expect(sent.from).toBe(config.from);
  expect(sent.messageId).toBe(sendMail.mock.calls[1][0].messageId);
  expect(sent.messageId).not.toContain(input.invoiceId);
  expect(sent.attachments.map((a: any) => a.contentType)).toEqual([
    "application/xml",
    "application/pdf",
    "application/xml",
  ]);
  expect(sent.html).toBeUndefined();
});
it("distinguishes definitive rejection and uncertain failures", async () => {
  for (const [response, status] of [
    [{ accepted: [], rejected: [input.recipient] }, "rejected"],
    [new Error("timeout after DATA"), "uncertain"],
  ] as const) {
    const sendMail = vi.fn();
    response instanceof Error
      ? sendMail.mockRejectedValue(response)
      : sendMail.mockResolvedValue(response);
    expect(
      (
        await new InvoiceMail({ ...config, transport: { sendMail } }).send(
          input,
        )
      ).status,
    ).toBe(status);
  }
});
it("rejects production injection, remote plaintext, and header injection", async () => {
  expect(
    () =>
      new InvoiceMail({
        ...config,
        environment: "production",
        transport: { sendMail: vi.fn() },
      }),
  ).toThrow();
  expect(
    () => new InvoiceMail({ ...config, host: "smtp.example.com" }),
  ).toThrow();
  const m = new InvoiceMail({ ...config, transport: { sendMail: vi.fn() } });
  await expect(
    m.send({
      ...input,
      recipient: "customer@example.com\r\nBcc:bad@example.com",
    }),
  ).rejects.toThrow();
});
it("labels the fiscal environment without weakening SMTP transport security", async () => {
  const sendMail = vi.fn().mockResolvedValue({ accepted: [input.recipient] });
  const mail = new InvoiceMail({ ...config, transport: { sendMail } });
  await mail.send({ ...input, fiscalEnvironment: "test" });
  expect(sendMail.mock.calls[0][0].subject).toContain("[PRUEBAS]");
  expect(sendMail.mock.calls[0][0].text).toContain("Ambiente de pruebas");
  await mail.send({ ...input, fiscalEnvironment: "production" });
  expect(sendMail.mock.calls[1][0].subject).not.toContain("[PRUEBAS]");
  expect(sendMail.mock.calls[1][0].text).toContain("Ambiente de producción");
});
