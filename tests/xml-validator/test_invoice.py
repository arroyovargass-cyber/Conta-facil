"""Full runtime FE/TE package checks, with all resources kept offline."""
import importlib.util
import pathlib
import shutil
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('invoice_validator', ROOT / 'infra/invoice-validator-worker.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
FE = b'<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"/>'
TE = b'<TiqueteElectronico xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico"/>'


class InvoicePackageTests(unittest.TestCase):
    def test_both_official_profiles_require_full_structure_without_network(self):
        original = urllib.request.urlopen
        def local_only(url, *args, **kwargs):
            location = url.full_url if hasattr(url, 'full_url') else str(url)
            if location.startswith(('http:', 'https:', 'ftp:')):
                raise AssertionError('Network forbidden')
            return original(url, *args, **kwargs)
        with patch('urllib.request.urlopen', side_effect=local_only):
            for content in [FE, TE]:
                self.assertEqual(validator.validate(content), dict(valid=False, issues=['XSD_STRUCTURE_INVALID']))

    def test_crossed_profile_namespace_is_not_a_supported_invoice(self):
        with self.assertRaisesRegex(validator.diagnostic.InputFailure, '^XML_DOCUMENT_UNSUPPORTED$'):
            validator.validate(TE.replace(b'/tiqueteElectronico', b'/facturaElectronica'))

    def test_manifest_commitment_is_checked_before_schema_compilation(self):
        with patch.object(validator, 'MANIFEST_HASH', '0' * 64):
            with self.assertRaisesRegex(ValueError, '^XSD_MANIFEST_INTEGRITY_FAILED$'):
                validator.validate(TE)

    def test_changed_ticket_bytes_block_the_entire_runtime_package(self):
        with tempfile.TemporaryDirectory(prefix='invoice-schema-package-') as directory:
            base = pathlib.Path(directory)
            for name in ['manifest.json', 'FacturaElectronica.uploaded-20261123.xsd',
                         'TiqueteElectronico.downloaded-20261126.xsd', 'xmldsig-core-schema.w3c-2002.xsd']:
                shutil.copyfile(validator.BASE / name, base / name)
            ticket = base / 'TiqueteElectronico.downloaded-20261126.xsd'
            raw = ticket.read_bytes()
            ticket.write_bytes(raw[:-1] + bytes([raw[-1] ^ 1]))
            with patch.object(validator, 'BASE', base):
                with self.assertRaisesRegex(ValueError, '^XSD_INTEGRITY_FAILED$'):
                    validator.validate(FE)

    def test_dtd_is_rejected_for_ticket_before_any_external_resolution(self):
        with self.assertRaisesRegex(validator.diagnostic.InputFailure, '^XML_DTD_FORBIDDEN$'):
            validator.validate(b'<!DOCTYPE TiqueteElectronico SYSTEM "file:///private-secret">' + TE)


if __name__ == '__main__':
    unittest.main()
