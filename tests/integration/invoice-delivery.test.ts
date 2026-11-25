import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { InvoiceMail } from "../../apps/api/src/services/invoice-mail";
import { renderInvoicePdf } from "../../apps/api/src/services/invoice-pdf";
import { generateInvoiceXml } from "../../apps/api/src/services/invoice-xml";
import { xmlFixture } from "../support/invoice-fixture";
it("sends the actual MIME attachments through local SMTP capture without external delivery", async () => {
  const fixture = xmlFixture(),
    recipient = "invoice-" + randomUUID() + "@example.test";
  const pdf = await renderInvoicePdf({
    ...fixture,
    hacienda_status: "pending",
  });
  const xml = Buffer.from(generateInvoiceXml(fixture)); // Unsigned synthetic fixture, never represented as accepted by Hacienda.
  const response = Buffer.from("<synthetic-response/>");
  const result = await new InvoiceMail({
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    from: "facturas@example.test",
    environment: "test",
  }).send({
    invoiceId: randomUUID(),
    recipient,
    companyName: "Captura SMTP sintética",
    xml,
    pdf,
    haciendaResponse: response,
  });
  expect(result.status).toBe("provider_accepted");
  const mailbox = await (
    await fetch("http://127.0.0.1:54324/api/v1/messages")
  ).json();
  const summary = mailbox.messages.find((m: any) =>
    m.To.some((t: any) => t.Address === recipient),
  );
  expect(summary).toBeDefined();
  const message = await (
    await fetch("http://127.0.0.1:54324/api/v1/message/" + summary.ID)
  ).json();
  expect(message.Attachments).toHaveLength(3);
  expect(message.Attachments.map((a: any) => a.ContentType)).toEqual([
    "application/xml",
    "application/pdf",
    "application/xml",
  ]);
  expect(message.Text).toContain("comprobante");
});
