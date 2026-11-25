"""Bounded full official FE schema validation; no signature trust or issuance claim."""
import base64, hashlib, io, json, pathlib, re, resource, socket, sys
import importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('diagnostic',ROOT/'infra/xml-validator-worker.py')
diagnostic=importlib.util.module_from_spec(spec);spec.loader.exec_module(diagnostic)
BASE=ROOT/'docs/reference/hacienda/v4.4'
MANIFEST_HASH='d4f65a9887c63fdaa10461ed106c3a16ba0172d36be03620d8e6aac3cca94474'
def validate(content):
    import xmlschema
    diagnostic.inspect_input(content)
    if len(content)>1048576: raise ValueError('XML_SIZE_EXCEEDED')
    if xmlschema.__version__!='4.3.2': raise ValueError('XSD_ENGINE_VERSION_MISMATCH')
    raw=(BASE/'manifest.json').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=MANIFEST_HASH: raise ValueError('XSD_MANIFEST_INTEGRITY_FAILED')
    m=json.loads(raw)
    if m['status']!='official-package-revision-confirmed' or not m['runtime_use_allowed']: raise ValueError('XSD_PACKAGE_DISABLED')
    resources=[]
    entries=[m]+m['dependencies']
    for item in entries:
        name=item.get('local_file',item.get('file'))
        if not name or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*',name):raise ValueError('XSD_DEPENDENCY_INVALID')
        p=BASE/name
        if p.is_symlink():raise ValueError('XSD_INTEGRITY_FAILED')
        b=p.read_bytes()
        if len(b)!=item['bytes'] or hashlib.sha256(b).hexdigest()!=item['sha256']:raise ValueError('XSD_INTEGRITY_FAILED')
        resources.append(xmlschema.XMLResource(b,allow='none',defuse='never' if name=='xmldsig-core-schema.w3c-2002.xsd' else 'always'))
    # Register dsig first; preserve the original FE schema and all signature requirements.
    schema=xmlschema.XMLSchema11(list(reversed(resources)),allow='none',defuse='always',use_fallback=False)
    source=xmlschema.XMLResource(io.BytesIO(content),allow='none',block='file url',defuse='always')
    for error in schema.iter_errors(source,use_defaults=False,use_location_hints=False):
        return dict(valid=False,issues=['XSD_STRUCTURE_INVALID'])
    return dict(valid=True,issues=[])
def main():
    resource.setrlimit(resource.RLIMIT_AS,(256*1024*1024,)*2)
    resource.setrlimit(resource.RLIMIT_CPU,(8,8))
    import xmlschema  # Load standard-library socket subclasses before sealing network access.
    # Defense in depth: even a library regression cannot resolve network resources.
    def denied(*args,**kwargs): raise OSError('network disabled')
    socket.socket=denied
    try:
        raw=sys.stdin.buffer.read(1500001)
        if len(raw)>1500000: raise ValueError('XML_SIZE_EXCEEDED')
        request=json.loads(raw)
        if not isinstance(request,dict) or set(request)!={'xml_base64'}:raise ValueError('XSD_REQUEST_INVALID')
        result=validate(base64.b64decode(request['xml_base64'],validate=True))
    except diagnostic.InputFailure as e:result=dict(valid=False,issues=[str(e)])
    except ValueError as e:
        code=str(e)
        result=dict(valid=False,issues=[code if re.fullmatch('[A-Z_]{1,64}',code) else 'XSD_REQUEST_INVALID'])
    except Exception:result=dict(valid=False,issues=['XSD_ENGINE_FAILED'])
    print(json.dumps(result))
if __name__=='__main__':main()
