import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
} from "../../packages/domain/src/invoice-fiscal";
import { emissionOptionsInput } from "../../packages/domain/src/emission";
import {
  generateInvoiceXml,
  type InvoiceXmlInput,
} from "../../apps/api/src/services/invoice-xml";
export function xmlFixture(): InvoiceXmlInput {
  const lines = [
    {
      quantity: "2",
      unit_price: "1000",
      description: "Artículo & prueba",
      fiscal: lineFiscalInput.parse({
        cabys: "1234567890123",
        unit: "Unid",
        treatment: "taxable",
        tariff_code: "08",
      }),
    },
  ];
  const consecutivo = "00100001010000000001";
  return {
    snapshot: {
      issuer: {
        legal_name: "Empresa prueba",
        trade_name: "",
        identification_type: "02",
        identification: "3101234567",
        contact_email: "emisor@example.com",
        phone: "",
        address: "San José centro",
        configuration: {
          location: {
            province: "1",
            canton: "01",
            district: "01",
            neighborhood: "",
          },
        },
      },
      receiver: receiverInput.parse({
        name: "Cliente prueba",
        identification_type: "01",
        identification: "123456789",
        domicile: "domestic",
        province: "1",
        canton: "01",
        district: "01",
        address: "San José centro",
      }),
      currency: "CRC",
      lines,
      totals: calculateInvoice(lines),
    },
    options: emissionOptionsInput.parse({
      branch_code: "001",
      terminal_code: "00001",
      issuer_activity: "123456",
      payment_methods: [{ code: "01", amount: "2260" }],
    }),
    clave: "506241126003101234567" + consecutivo + "112345678",
    consecutivo,
    issued_at: "2026-11-24T12:00:00-06:00",
    software_provider_id: "3101234567",
  };
}
