import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { z } from "zod";
import {
  haciendaEnvironmentInput,
  type HaciendaEnvironment,
} from "../../../../packages/domain/src/hacienda-environment";
type Transport = {
  sendMail(
    message: Mail.Options,
  ): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
};
type Configuration = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  environment: "test" | "production";
  transport?: Transport;
};
export class InvoiceMail {
  private readonly transport: Transport;
  private readonly domain: string;
  constructor(private readonly config: Configuration) {
    z.email().parse(config.from);
    if (
      !["test", "production"].includes(config.environment) ||
      !config.host ||
      /[\s\r\n]/.test(config.host) ||
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535
    )
      throw Error("INVOICE_MAIL_INVALID_CONFIGURATION");
    if (
      config.transport &&
      (config.environment !== "test" || process.env.NODE_ENV !== "test")
    )
      throw Error("INVOICE_MAIL_TEST_TRANSPORT_ONLY");
    const local = ["localhost", "127.0.0.1", "::1"].includes(config.host);
    if (
      !config.secure &&
      !(config.environment === "test" && local) &&
      config.environment !== "production"
    )
      throw Error("INVOICE_MAIL_TLS_REQUIRED");
    if (Boolean(config.user) !== Boolean(config.password))
      throw Error("INVOICE_MAIL_INCOMPLETE_AUTH");
    this.domain = config.from.split("@")[1];
    this.transport =
      config.transport ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !(config.environment === "test" && local),
        tls: { rejectUnauthorized: true },
        auth: config.user
          ? { user: config.user, pass: config.password }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
  }
  async send(input: {
    fiscalEnvironment?: HaciendaEnvironment;
    invoiceId: string;
    recipient: string;
    companyName: string;
    xml: Buffer;
    pdf: Buffer;
    haciendaResponse: Buffer;
  }): Promise<{
    status: "provider_accepted" | "rejected" | "uncertain";
    messageId: string;
  }> {
    const environment = haciendaEnvironmentInput.parse(input.fiscalEnvironment);
    z.email().parse(input.recipient);
    if (
      !input.invoiceId ||
      input.invoiceId.length > 256 ||
      /[\r\n\x00-\x1f]/.test(input.companyName) ||
      input.companyName.length > 200 ||
      ![input.xml, input.pdf, input.haciendaResponse].every(
        (x) =>
          Buffer.isBuffer(x) && x.length > 0 && x.length <= 20 * 1024 * 1024,
      )
    )
      throw Error("INVOICE_MAIL_INVALID_INPUT");
    const messageId = `<invoice-${createHash("sha256").update(input.invoiceId).digest("hex")}@${this.domain}>`;
    try {
      const info = await this.transport.sendMail({
        from: this.config.from,
        to: input.recipient,
        messageId,
        subject: `${environment === "test" ? "[PRUEBAS] " : ""}Comprobante electrónico - ${input.companyName}`,
        text: `${input.companyName}\nAmbiente de ${environment === "test" ? "pruebas" : "producción"}.\nSe adjuntan el XML del comprobante electrónico, su representación gráfica y la respuesta de Hacienda.`,
        disableFileAccess: true,
        disableUrlAccess: true,
        attachments: [
          {
            filename: "factura.xml",
            content: input.xml,
            contentType: "application/xml",
          },
          {
            filename: "factura.pdf",
            content: input.pdf,
            contentType: "application/pdf",
          },
          {
            filename: "respuesta-hacienda.xml",
            content: input.haciendaResponse,
            contentType: "application/xml",
          },
        ],
      });
      return {
        status: info.accepted?.some(
          (a) =>
            typeof a === "string" &&
            a.toLowerCase() === input.recipient.toLowerCase(),
        )
          ? "provider_accepted"
          : info.rejected?.some(
                (a) =>
                  typeof a === "string" &&
                  a.toLowerCase() === input.recipient.toLowerCase(),
              )
            ? "rejected"
            : "uncertain",
        messageId,
      };
    } catch (error) {
      const e = error as { responseCode?: number; command?: string };
      return {
        status:
          e.responseCode !== undefined &&
          e.responseCode >= 500 &&
          e.responseCode < 600
            ? "rejected"
            : "uncertain",
        messageId,
      };
    }
  }
}
