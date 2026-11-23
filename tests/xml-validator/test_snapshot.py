import importlib.util
import pathlib
import unittest
from unittest.mock import patch
import urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('validator', root / 'infra/xml-validator-worker.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

class SnapshotTests(unittest.TestCase):
    def test_uses_real_xsd11_assertions(self):
        import xmlschema
        source = xmlschema.XMLResource('''<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="n"><xs:complexType><xs:attribute name="value" type="xs:integer"/><xs:assert test="@value gt 0"/></xs:complexType></xs:element></xs:schema>''', allow='none', defuse='always')
        schema = validator.compile_resources([source])
        self.assertTrue(schema.is_valid('<n value="1"/>'))
        self.assertFalse(schema.is_valid('<n value="0"/>'))

    def test_missing_invoice_fields_fail_the_official_snapshot_without_network(self):
        xml = b'<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"/>'
        original = urllib.request.urlopen
        def local_only(url, *args, **kwargs):
            location = url.full_url if hasattr(url, 'full_url') else str(url)
            if location.startswith(('http:', 'https:', 'ftp:')):
                raise AssertionError('Network forbidden')
            return original(url, *args, **kwargs)
        with patch('urllib.request.urlopen', side_effect=local_only):
            result = validator.validate_snapshot(xml)
        self.assertEqual(result['status'], 'snapshot_invalid')
        self.assertFalse(result['emissionEnabled'])
        self.assertFalse(result['revisionConfirmed'])
        self.assertEqual(result['signatureVerification'], 'not_run')

    def test_dtd_is_rejected_without_disclosing_its_target(self):
        result = validator.validate_snapshot(b'<!DOCTYPE FacturaElectronica SYSTEM "file:///private-secret"><FacturaElectronica/>')
        self.assertEqual(result['issues'], ['XML_DTD_FORBIDDEN'])
        self.assertNotIn('private-secret', str(result))

    def test_tampered_schema_pin_blocks_compilation(self):
        name, length, digest = validator.PINS[0]
        with patch.object(validator, 'PINS', [(name, length, '0' * 64)]):
            result = validator.validate_snapshot(b'<FacturaElectronica xmlns="' + validator.NAMESPACE.encode() + b'"/>')
        self.assertEqual(result['issues'], ['XSD_SNAPSHOT_INTEGRITY_FAILED'])

    def test_input_limit_precedes_parsing(self):
        self.assertEqual(validator.validate_snapshot(b'A' * (2*1024*1024+1))['issues'], ['XML_SIZE_EXCEEDED'])

if __name__ == '__main__':
    unittest.main()
