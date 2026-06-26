import csv, io, json, os, re, shutil, socket, tempfile, time, uuid, zipfile
from datetime import datetime
from pathlib import Path
from lxml import etree
from .schemas import FixtureDocument
from .catalog import ATTRIBUTES

MA_NS = "http://schemas.malighting.de/grandma2/xml/MA"
def safe_name(value): return re.sub(r'[^A-Za-z0-9_.-]+', '_', value).strip('_') or 'fixture'
def bytes_for(ch): return ch.resolution // 8
def max_dmx(ch): return (1 << ch.resolution) - 1

def validate_fixture(f: FixtureDocument):
    issues = []
    for mode in f.modes:
        used = {}
        for ch in mode.channels:
            for address in range(ch.address, ch.address + bytes_for(ch)):
                if address > 512: issues.append({"level":"error","code":"ADDRESS_OVERFLOW","message":f"{mode.name}: {ch.name} exceeds 512 channels"})
                if address in used: issues.append({"level":"error","code":"ADDRESS_CONFLICT","message":f"{mode.name}: address {address} conflicts with {used[address]}"})
                used[address] = ch.name
            ordered = sorted(ch.functions, key=lambda x:x.dmxFrom)
            for i, fn in enumerate(ordered):
                if fn.dmxFrom > fn.dmxTo or fn.dmxTo > max_dmx(ch): issues.append({"level":"error","code":"FUNCTION_RANGE","message":f"{ch.name} function range is invalid"})
                if i and fn.dmxFrom <= ordered[i-1].dmxTo: issues.append({"level":"error","code":"FUNCTION_OVERLAP","message":f"{ch.name} function ranges overlap"})
                if i and fn.dmxFrom > ordered[i-1].dmxTo + 1: issues.append({"level":"warning","code":"FUNCTION_GAP","message":f"{ch.name} function range has a gap"})
    return {"valid": not any(x["level"] == "error" for x in issues), "issues": issues}

def export_ma2(f: FixtureDocument, mode_index=0):
    nsmap = {None: MA_NS, "xsi":"http://www.w3.org/2001/XMLSchema-instance", "xsd":"http://www.w3.org/2001/XMLSchema"}
    root = etree.Element(f"{{{MA_NS}}}MA", nsmap=nsmap, major_vers="2", minor_vers="8", stream_vers="123")
    mode = f.modes[mode_index]
    ft = etree.SubElement(root, f"{{{MA_NS}}}FixtureType", name=f.name, mode=mode.name)
    etree.SubElement(ft, f"{{{MA_NS}}}short_name").text = f.shortName or f.name[:8]
    etree.SubElement(ft, f"{{{MA_NS}}}manufacturer").text = f.manufacturer.name
    etree.SubElement(ft, f"{{{MA_NS}}}short_manufacturer").text = f.manufacturer.shortName or f.manufacturer.name[:4]
    modules = etree.SubElement(ft, f"{{{MA_NS}}}Modules")
    module = etree.SubElement(modules, f"{{{MA_NS}}}Module", name="Main Module", **{"class":f.category.upper().replace(' ','_')})
    etree.SubElement(etree.SubElement(module, f"{{{MA_NS}}}Body"), f"{{{MA_NS}}}Size", x="0.5", y="0.5", z="0.5")
    for ch in mode.channels:
        # MA2 XML stores default / highlight_value in the coarse (8-bit) range 0–255.
        # Scale the full-resolution values down to 8-bit for the XML attributes.
        coarse_default = round(ch.defaultValue / max_dmx(ch) * 255)
        coarse_highlight = round(ch.highlightValue / max_dmx(ch) * 255)
        attrs = {"attribute":ch.attribute,"feature":ch.group,"preset":ch.group,"coarse":str(ch.address),"default":str(coarse_default),"highlight_value":str(coarse_highlight)}
        if ch.resolution >= 16: attrs["fine"] = str(ch.address + 1)
        if ch.resolution >= 24: attrs["ultra"] = str(ch.address + 2)
        if ch.resolution >= 32: attrs["ultimo"] = str(ch.address + 3)
        ct = etree.SubElement(module, f"{{{MA_NS}}}ChannelType", **attrs)
        # ChannelFunction from/to must also be in coarse (8-bit) range for MA2 XML
        funcs = ch.functions or [type('F',(),{"name":ch.name,"dmxFrom":0,"dmxTo":max_dmx(ch),"physicalFrom":ch.physicalFrom,"physicalTo":ch.physicalTo,"attribute":ch.attribute})()]
        for fn in funcs:
            coarse_from = round(fn.dmxFrom / max_dmx(ch) * 255)
            coarse_to = round(fn.dmxTo / max_dmx(ch) * 255)
            etree.SubElement(ct, f"{{{MA_NS}}}ChannelFunction", name=fn.name, from_=str(coarse_from), to=str(coarse_to), min_dmx_24=str(round(fn.dmxFrom/max_dmx(ch)*16777215)), max_dmx_24=str(round(fn.dmxTo/max_dmx(ch)*16777215)), physfrom=str(fn.physicalFrom), physto=str(fn.physicalTo), attribute=fn.attribute, feature=ch.group, preset=ch.group)
    instances = etree.SubElement(ft, f"{{{MA_NS}}}Instances")
    etree.SubElement(instances, f"{{{MA_NS}}}Instance", module_index="0", patch="1", locked="true")
    etree.SubElement(ft, f"{{{MA_NS}}}Wheels")
    return etree.tostring(root, encoding="utf-8", xml_declaration=True, pretty_print=True).replace(b'from_=', b'from=')

def import_ma2(data: bytes):
    root = etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True, recover=False))
    ft = root.xpath('//*[local-name()="FixtureType"]')[0]
    manufacturer = ''.join(ft.xpath('./*[local-name()="manufacturer"]/text()')) or "鏈煡鍏徃"
    short_m = ''.join(ft.xpath('./*[local-name()="short_manufacturer"]/text()'))
    channels=[]
    for i, ct in enumerate(ft.xpath('.//*[local-name()="ChannelType"]')):
        attr=ct.get('attribute','DIM'); coarse=int(ct.get('coarse',i+1)); res=8
        if ct.get('fine'): res=16
        if ct.get('ultra'): res=24
        if ct.get('ultimo'): res=32
        meta=next((x for x in ATTRIBUTES if x['ma2Attribute']==attr),None)
        max_val=(1<<res)-1
        # MA2 XML stores values in coarse (8-bit) range; scale up to full resolution
        scale=lambda v: round(int(v)/255*max_val)
        funcs=[]
        for fn in ct.xpath('./*[local-name()="ChannelFunction"]'):
            funcs.append({"id":str(uuid.uuid4()),"name":fn.get('name',attr),"dmxFrom":scale(fn.get('from',0)),"dmxTo":scale(fn.get('to',255)),"physicalFrom":float(fn.get('physfrom',0)),"physicalTo":float(fn.get('physto',1)),"attribute":fn.get('attribute',attr)})
        channels.append({"id":str(uuid.uuid4()),"address":coarse,"attribute":attr,"group":ct.get('feature',meta['maFeature'] if meta else 'CONTROL'),"name":meta['ueAttribute'] if meta else attr,"resolution":res,"byteOrder":"MSB","defaultValue":scale(ct.get('default',0)),"highlightValue":scale(ct.get('highlight_value',255)),"ueAttribute":meta['ueAttribute'] if meta else attr,"functions":funcs})
    return {"id":str(uuid.uuid4()),"schemaVersion":"1.0","revision":0,"name":ft.get('name','瀵煎叆鐏叿'),"shortName":''.join(ft.xpath('./*[local-name()="short_name"]/text()')),"manufacturer":{"id":str(uuid.uuid4()),"name":manufacturer,"shortName":short_m},"category":"Other","version":"1.0","notes":"鐢?MA2 XML 瀵煎叆","modes":[{"id":str(uuid.uuid4()),"name":ft.get('mode','榛樿妯″紡'),"channels":channels}],"wheels":[]}

def export_gdtf(f: FixtureDocument):
    feature_names={'DIMMER':('Dimmer','Dimmer'),'POSITION':('Position','PanTilt'),'GOBO':('Gobo','Gobo'),'COLOR':('Color','RGB'),'BEAM':('Beam','Beam'),'FOCUS':('Focus','Focus'),'CONTROL':('Control','Control')}
    root=etree.Element('GDTF',DataVersion='1.2')
    ft=etree.SubElement(root,'FixtureType',CanHaveChildren='No',Description='Generated by Fixture Forge for UE 5.7 DMX Library',Name=f.name,LongName=f.name,ShortName=f.shortName or f.name[:8],Manufacturer=f.manufacturer.name,FixtureTypeID=str(uuid.uuid5(uuid.NAMESPACE_DNS,f.id)).upper(),RefFT='',Thumbnail='')
    definitions=etree.SubElement(ft,'AttributeDefinitions'); etree.SubElement(definitions,'ActivationGroups'); groups=etree.SubElement(definitions,'FeatureGroups')
    for group in sorted({c.group for m in f.modes for c in m.channels}):
        group_name,feature_name=feature_names.get(group,feature_names['CONTROL']); fg=etree.SubElement(groups,'FeatureGroup',Name=group_name,Pretty=group_name); etree.SubElement(fg,'Feature',Name=feature_name)
    attributes=etree.SubElement(definitions,'Attributes'); seen=set()
    for ch in (c for m in f.modes for c in m.channels):
        if ch.ueAttribute in seen: continue
        seen.add(ch.ueAttribute); group_name,feature_name=feature_names.get(ch.group,feature_names['CONTROL']); unit='Angle' if ch.attribute in ('PAN','TILT','ANGLE') else 'None'; etree.SubElement(attributes,'Attribute',Name=ch.ueAttribute,Pretty=ch.name,Feature=f'{group_name}.{feature_name}',PhysicalUnit=unit)
    etree.SubElement(ft,'Wheels'); etree.SubElement(ft,'Models')
    identity='{1.000000,0.000000,0.000000,0.000000}{0.000000,1.000000,0.000000,0.000000}{0.000000,0.000000,1.000000,0.000000}{0.000000,0.000000,0.000000,1.000000}'
    geos=etree.SubElement(ft,'Geometries'); base=etree.SubElement(geos,'Geometry',Name='Base',Position=identity); yoke=etree.SubElement(base,'Axis',Name='Yoke',Position=identity); head=etree.SubElement(yoke,'Axis',Name='Head',Position=identity); etree.SubElement(head,'Beam',Name='Beam',Position=identity,LampType='Discharge',PowerConsumption='1000',LuminousFlux='1000',ColorTemperature='6500',BeamAngle='25',FieldAngle='25',BeamRadius='0.05',BeamType='Wash',ColorRenderingIndex='100')
    modes=etree.SubElement(ft,'DMXModes')
    for mode in f.modes:
        mn=etree.SubElement(modes,'DMXMode',Name=mode.name,Description='Fixture Forge DMX Mode',Geometry='Base'); chans=etree.SubElement(mn,'DMXChannels')
        for ch in mode.channels:
            byte_count=bytes_for(ch); offsets=','.join(str(ch.address+i) for i in range(byte_count)); geometry='Yoke' if ch.attribute=='PAN' else ('Head' if ch.attribute=='TILT' else 'Beam'); function_name=(ch.name or ch.ueAttribute).replace('.','_'); initial=f'{geometry}_{ch.ueAttribute}.{ch.ueAttribute}.{function_name}'
            dc=etree.SubElement(chans,'DMXChannel',DMXBreak='1',Offset=offsets,Highlight='None',Geometry=geometry,InitialFunction=initial); lc=etree.SubElement(dc,'LogicalChannel',Attribute=ch.ueAttribute,Snap='No',Master='None',MibFade='0',DMXChangeTimeLimit='0')
            funcs=ch.functions or [type('F',(),{"name":function_name,"dmxFrom":0,"physicalFrom":ch.physicalFrom,"physicalTo":ch.physicalTo})()]
            for fn in funcs: etree.SubElement(lc,'ChannelFunction',Name=(fn.name or function_name).replace('.','_'),Attribute=ch.ueAttribute,OriginalAttribute='',DMXFrom=f'{fn.dmxFrom}/{byte_count}',Default=f'{ch.defaultValue}/{byte_count}',PhysicalFrom=str(fn.physicalFrom),PhysicalTo=str(fn.physicalTo),RealFade='0',RealAcceleration='0')
        etree.SubElement(mn,'Relations'); etree.SubElement(mn,'FTMacros')
    etree.SubElement(ft,'FTPresets'); etree.SubElement(ft,'Revisions')
    xml=etree.tostring(root,encoding='utf-8',xml_declaration=True,pretty_print=True)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z: z.writestr('description.xml',xml)
    return out.getvalue()

def import_gdtf(data: bytes):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos=z.infolist()
        if len(infos)>1000 or sum(x.file_size for x in infos)>50_000_000: raise ValueError('GDTF archive is too large')
        if any('..' in x.filename.replace('\\','/').split('/') for x in infos): raise ValueError('GDTF archive contains unsafe paths')
        xml=z.read('description.xml')
    root=etree.fromstring(xml,etree.XMLParser(resolve_entities=False,no_network=True))
    ft=root.find('.//FixtureType'); modes=[]
    for mn in ft.findall('.//DMXMode'):
        channels=[]
        for dc in mn.findall('./DMXChannels/DMXChannel'):
            offsets=[int(x) for x in dc.get('Offset','1').split(',')]; lc=dc.find('./LogicalChannel'); attr=lc.get('Attribute','DIM'); meta=next((x for x in ATTRIBUTES if x['gdtfAttribute']==attr or x['ueAttribute']==attr),None); funcs=[]
            for fn in lc.findall('./ChannelFunction'):
                raw=fn.get('DMXFrom','0/1').split('/')[0]; funcs.append({"id":str(uuid.uuid4()),"name":fn.get('Name',attr),"dmxFrom":int(raw),"dmxTo":(1<<(8*len(offsets)))-1,"physicalFrom":float(fn.get('PhysicalFrom',0)),"physicalTo":float(fn.get('PhysicalTo',1)),"attribute":fn.get('Attribute',attr)})
            default_raw=dc.get('Default') or (lc.find('./ChannelFunction').get('Default') if lc.find('./ChannelFunction') is not None else '0') or '0'; highlight_raw=dc.get('Highlight') or str((1<<(8*len(offsets)))-1); highlight_raw=str((1<<(8*len(offsets)))-1) if highlight_raw=='None' else highlight_raw; ma_attr=meta['ma2Attribute'] if meta else attr
            channels.append({"id":str(uuid.uuid4()),"address":offsets[0],"attribute":ma_attr,"group":meta['maFeature'] if meta else 'CONTROL',"name":meta['ueAttribute'] if meta else attr,"resolution":8*len(offsets),"byteOrder":"MSB","defaultValue":int(default_raw.split('/')[0]),"highlightValue":int(highlight_raw.split('/')[0]),"ueAttribute":meta['ueAttribute'] if meta else attr,"functions":funcs})
        modes.append({"id":str(uuid.uuid4()),"name":mn.get('Name','榛樿妯″紡'),"channels":channels})
    return {"id":str(uuid.uuid4()),"schemaVersion":"1.0","revision":0,"name":ft.get('Name','瀵煎叆鐏叿'),"shortName":ft.get('ShortName',''),"manufacturer":{"id":str(uuid.uuid4()),"name":ft.get('Manufacturer','鏈煡鍏徃'),"shortName":""},"category":"Other","version":"1.0","notes":"鐢?GDTF 瀵煎叆","modes":modes,"wheels":[]}

def _checked_zip(data: bytes, label: str, max_entries=2000, max_size=150_000_000):
    archive=zipfile.ZipFile(io.BytesIO(data))
    infos=archive.infolist()
    if len(infos)>max_entries or sum(x.file_size for x in infos)>max_size: raise ValueError(f'{label} archive is too large')
    if any('..' in x.filename.replace('\\','/').split('/') or x.filename.startswith(('/', '\\')) for x in infos): raise ValueError(f'{label} archive contains unsafe paths')
    return archive

def import_mvr_fixture_options(data: bytes):
    with _checked_zip(data,'MVR') as archive:
        names={x.filename.replace('\\','/'):x.filename for x in archive.infolist()}
        gdtf_names=[name for name in names if name.lower().endswith('.gdtf')]
        ordered=[]
        xml_key='MVR/GeneralSceneDescription.xml' if 'MVR/GeneralSceneDescription.xml' in names else 'GeneralSceneDescription.xml'
        if xml_key in names:
            root=etree.fromstring(archive.read(names[xml_key]),etree.XMLParser(resolve_entities=False,no_network=True))
            for spec in root.xpath('//*[local-name()="Fixture"]/*[local-name()="GDTFSpec"]/text()'):
                candidate=spec if spec.lower().endswith('.gdtf') else spec+'.gdtf'
                match=next((name for name in gdtf_names if name.lower()==candidate.lower() or name.lower().endswith('/'+candidate.lower())),None)
                if match and match not in ordered: ordered.append(match)
        ordered += [name for name in gdtf_names if name not in ordered]
        result=[]
        for index,name in enumerate(ordered):
            fixture=FixtureDocument.model_validate(import_gdtf(archive.read(names[name])))
            fixture.notes='鐢?MVR 鍐呭祵 GDTF 瀵煎叆'
            footprint=max((c.address+bytes_for(c)-1 for mode in fixture.modes for c in mode.channels),default=0)
            result.append({'key':name,'index':index,'name':fixture.name,'manufacturer':fixture.manufacturer.name,'modes':[m.name for m in fixture.modes],'footprint':footprint,'fixture':fixture.model_dump()})
        return result

def export_ue_bundle(f: FixtureDocument):
    report=validate_fixture(f); mapping={"schemaVersion":"1.0","fixture":f.name,"manufacturer":f.manufacturer.name,"modes":[{"name":m.name,"footprint":max((c.address+bytes_for(c)-1 for c in m.channels),default=0),"channels":[{"address":c.address,"name":c.name,"maAttribute":c.attribute,"ueAttribute":c.ueAttribute,"resolution":c.resolution,"byteOrder":c.byteOrder} for c in m.channels]} for m in f.modes]}
    script='''import json, os, unreal\n# 鍦?UE 5.7 缂栬緫鍣ㄤ腑杩愯锛涜鍙栧悓鐩綍 ue-fixture-map.json 鍒涘缓 DMX Library銆俓nroot=os.path.dirname(__file__)\nwith open(os.path.join(root,"ue-fixture-map.json"),encoding="utf-8") as h: data=json.load(h)\nunreal.log("Fixture Forge: loaded %s (%d modes)" % (data["fixture"],len(data["modes"])))\n# 鎺ㄨ崘锛氬厛閫氳繃 DMXGDTF 鎻掍欢瀵煎叆鍚屽寘鍐?.gdtf锛屽啀鎸夋槧灏勬鏌?Blueprint 灞炴€с€俓n'''
    out=io.BytesIO(); filename=safe_name(f.name)
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr(filename+'.gdtf',export_gdtf(f)); z.writestr('ue-fixture-map.json',json.dumps(mapping,ensure_ascii=False,indent=2)); z.writestr('validation-report.json',json.dumps(report,ensure_ascii=False,indent=2)); z.writestr('import_ue_fixture.py',script); z.writestr('README.md',f'# {f.name} UE 5.7 瀵煎叆鍖匼n\n1. 鍚敤 DMXEngine銆丏MXGDTF銆丏MXFixtures銆俓n2. 鍦ㄥ唴瀹规祻瑙堝櫒瀵煎叆 `{filename}.gdtf`銆俓n3. 浣跨敤 `ue-fixture-map.json` 鏍稿 Blueprint 灞炴€с€俓n4. 濡傞渶鑷姩妫€鏌ワ紝鍦?UE Python 鎺у埗鍙拌繍琛?`import_ue_fixture.py`銆俓n')
    return out.getvalue()

def export_mvr_scene(fixtures: dict[str, FixtureDocument], scene_name: str, items: list[dict]):
    """Build an MVR scene with embedded GDTF fixture types and fixture patch addresses."""
    root=etree.Element('GeneralSceneDescription',verMajor='1',verMinor='5')
    user=etree.SubElement(root,'UserData'); data=etree.SubElement(user,'Data',provider='FixtureForge',ver='1.0'); etree.SubElement(data,'CreationDate').text=datetime.now().strftime('%Y.%m.%d-%H.%M.%S')
    scene=etree.SubElement(root,'Scene')
    layers=etree.SubElement(scene,'Layers'); layer=etree.SubElement(layers,'Layer',uuid=str(uuid.uuid5(uuid.NAMESPACE_DNS,scene_name+'-layer')).upper()); children=etree.SubElement(layer,'ChildList')
    gdtf_files={}
    for index,item in enumerate(items,start=1):
        fixture_doc=fixtures[item['fixtureId']]
        gdtf_base=safe_name(f'{fixture_doc.manufacturer.name}@{fixture_doc.name}@FixtureForge')
        if gdtf_base not in gdtf_files:
            gdtf_files[gdtf_base]=export_gdtf(fixture_doc)
        patch_name=item.get('name') or f'{fixture_doc.name}_{index:04d}'
        fixture=etree.SubElement(children,'Fixture',name=patch_name,uuid=str(uuid.uuid5(uuid.NAMESPACE_DNS,f'{scene_name}:{item.get("id",index)}:{patch_name}')).upper())
        etree.SubElement(fixture,'Matrix').text='{-1.000000,0.000000,0.000000}{0.000000,1.000000,0.000000}{-0.000000,0.000000,-1.000000}{0.000000,0.000000,0.000000}'
        etree.SubElement(fixture,'GDTFSpec').text=gdtf_base
        etree.SubElement(fixture,'GDTFMode').text=item.get('modeName') or (fixture_doc.modes[0].name if fixture_doc.modes else 'Default')
        etree.SubElement(fixture,'FixtureID').text=str(item.get('fid') or index)
        etree.SubElement(fixture,'UnitNumber').text='0'
        addresses=etree.SubElement(fixture,'Addresses')
        mode_name=item.get('modeName')
        mode=next((m for m in fixture_doc.modes if m.name==mode_name),fixture_doc.modes[0]) if fixture_doc.modes else None
        footprint=max((ch.address+ch.resolution//8-1 for ch in (mode.channels if mode else [])),default=1)
        universe=max(1,min(256,int(item.get('universe') or 1)))
        dmx_address=max(1,min(512,int(item.get('address') or 1)))
        absolute_address=(universe-1)*512+dmx_address
        address=etree.SubElement(addresses,'Address',attrib={'break':'0'})
        address.text=str(absolute_address)
    xml=etree.tostring(root,encoding='utf-8',xml_declaration=True,pretty_print=True)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('GeneralSceneDescription.xml',xml)
        for base,gdtf in gdtf_files.items(): archive.writestr(base+'.gdtf',gdtf)
    return out.getvalue()

def _ma2_quote(value: str) -> str:
    return str(value).replace('"', "'")


def _strip_ansi(value: str) -> str:
    return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', value)


def _ma2_read_feedback(sock, wait=0.2) -> str:
    time.sleep(wait)
    chunks=[]
    while True:
        try:
            data=sock.recv(8192)
            if not data:
                break
            chunks.append(data)
        except socket.timeout:
            break
    return _strip_ansi(b''.join(chunks).decode('utf-8','replace'))


def _ma2_feedback_errors(feedback: str) -> list[str]:
    errors=[]
    for line in feedback.replace('\r','\n').split('\n'):
        text=line.strip()
        if not text:
            continue
        upper=text.upper()
        if 'LOGIN INCORRECT' in upper or 'LOGIN NEEDED' in upper:
            errors.append(text)
        elif upper.startswith('ERROR #') or upper.startswith('ERROR :'):
            # ERROR #14 OBJECT DOES NOT EXIST is handled by ignore_missing
            errors.append(text)
        elif 'NO OBJECTS FOUND' in upper:
            errors.append(text)
        elif 'OVERWRITE CONFIRMATION' in upper or 'INVALID KEY' in upper:
            errors.append(text)
    return errors


def _ma2_feedback_warnings(feedback: str) -> list[str]:
    upper=feedback.upper()
    warnings=[]
    if 'ERROR #22' in upper or 'CANNOT ENTER DESTINATION' in upper:
        warnings.append('MA2 rejected EditSetup access. Close Patch/Fixture Schedule/EditSetup windows or stale Telnet sessions, then retry.')
    if 'ERROR #23' in upper and 'FILE NOT FOUND' in upper:
        warnings.append('MA2 could not find the XML in the current object import folder.')
    if 'NO OBJECTS FOUND' in upper:
        warnings.append('MA2 could not find the requested Fixture ID.')
    return warnings


def _parse_fixturetype_numbers(feedback: str, wanted: set[str]) -> dict[str, int]:
    result={}
    for line in feedback.splitlines():
        match=re.search(r'FixtureType\s+(\d+)\s+\d+\s+(.+)', line)
        if not match:
            continue
        number=int(match.group(1))
        rest=match.group(2)
        for name in wanted:
            if name in rest:
                result[name]=number
    return result


def _ma2_data_dir(kind: str) -> str | None:
    root=Path(os.environ.get('PROGRAMDATA', r'C:\ProgramData'))/'MA Lighting Technologies'/'grandma'
    if not root.exists():
        return None
    candidates=sorted(root.glob('gma2_V_*'), key=lambda path: path.name, reverse=True)
    for candidate in candidates:
        target=candidate/kind
        if target.exists():
            return str(target)
    return None


def _ma2_local_addresses() -> set[str]:
    addresses={'127.0.0.1','localhost','::1'}
    try:
        hostname=socket.gethostname()
        addresses.add(socket.gethostbyname(hostname))
        for value in socket.gethostbyname_ex(hostname)[2]:
            addresses.add(value)
    except OSError:
        pass
    return addresses


def _ma2_is_local_target(ma2_ip: str) -> bool:
    return str(ma2_ip).strip().lower() in _ma2_local_addresses()


def _ma2_layer_name(scene_name: str, universe: int) -> str:
    prefix=safe_name(scene_name or 'FixtureForge')
    return f'{prefix}_Universe_{max(1,min(256,int(universe))):03d}'[:31]


def _ma2_group_items_by_universe(items: list[dict]) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]]={}
    for item in items:
        universe=max(1,min(256,int(item.get('universe') or 1)))
        grouped.setdefault(universe,[]).append(item)
    return grouped


def export_ma2_layer(fixtures: dict[str, FixtureDocument], scene_name: str, items: list[dict], fixture_type_numbers: dict[str, int], layer_name: str | None = None):
    safe_scene=safe_name(layer_name or scene_name or 'FixtureForge_Layer')
    root=etree.Element(f"{{{MA_NS}}}MA",nsmap={None:MA_NS,"xsi":"http://www.w3.org/2001/XMLSchema-instance"},major_vers='3',minor_vers='7',stream_vers='0')
    etree.SubElement(root,f"{{{MA_NS}}}Info",datetime=datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),showfile='FixtureForge')
    layer=etree.SubElement(root,f"{{{MA_NS}}}Layer",index='0',name=safe_scene[:31] or 'FixtureForge')
    for index,item in enumerate(items):
        fixture_doc=fixtures[item['fixtureId']]
        fid=max(1,int(item.get('fid') or index+1))
        universe=max(1,min(256,int(item.get('universe') or 1)))
        address=max(1,min(512,int(item.get('address') or 1)))
        absolute_address=(universe-1)*512+address
        name=str(item.get('name') or f'{fixture_doc.name}_{index+1:04d}')
        fixture=etree.SubElement(layer,f"{{{MA_NS}}}Fixture",index=str(index),name=name,fixture_id=str(fid),channel_id='0')
        fixture_type=etree.SubElement(fixture,f"{{{MA_NS}}}FixtureType",name=fixture_doc.name)
        etree.SubElement(fixture_type,f"{{{MA_NS}}}No").text=str(fixture_type_numbers.get(fixture_doc.name,0))
        sub=etree.SubElement(fixture,f"{{{MA_NS}}}SubFixture",index='0',name=name)
        patch=etree.SubElement(sub,f"{{{MA_NS}}}Patch")
        etree.SubElement(patch,f"{{{MA_NS}}}Address").text=str(absolute_address)
    return etree.tostring(root,encoding='utf-8',xml_declaration=True,pretty_print=True)


def _ma2_patch_assets(fixtures: dict[str, FixtureDocument], scene_name: str, items: list[dict], include_imports=False, import_paths: dict[str, str] | None = None):
    safe_scene=safe_name(scene_name or 'FixtureForge_MA2_Patch')
    fixture_files={}
    commands=[
        'CD /',
    ]
    if include_imports and import_paths:
        commands.extend(['CD EditSetup','CD FixtureTypes'])
    rows=[]
    imported=set()
    for index,item in enumerate(items,start=1):
        fixture_doc=fixtures[item['fixtureId']]
        mode_name=str(item.get('modeName') or (fixture_doc.modes[0].name if fixture_doc.modes else 'Profile'))
        fixture_file=safe_name(f'{fixture_doc.manufacturer.name}_{fixture_doc.name}_{mode_name}')
        if fixture_file not in fixture_files:
            fixture_files[fixture_file]=export_ma2(fixture_doc)
        if include_imports and import_paths and fixture_file in import_paths and fixture_file not in imported:
            commands.append(f'Import "{_ma2_quote(import_paths[fixture_file])}"')
            imported.add(fixture_file)
        fid=int(item.get('fid') or index)
        universe=max(1,min(256,int(item.get('universe') or 1)))
        address=max(1,min(512,int(item.get('address') or 1)))
        name=str(item.get('name') or f'{fixture_doc.name}_{index:04d}')
        rows.append({
            'fid':fid,
            'name':name,
            'manufacturer':fixture_doc.manufacturer.name,
            'fixture_type':fixture_doc.name,
            'mode':mode_name,
            'universe':universe,
            'address':address,
            'ma2_fixture_type_xml':fixture_file+'.xml',
        })
    if include_imports and import_paths:
        commands.append('CD /')
    for row in rows:
        commands.append(f'Assign Fixture {row["fid"]} At DMX {row["universe"]}.{row["address"]}')
        commands.append(f'Label Fixture {row["fid"]} "{_ma2_quote(row["name"])}"')
    commands.append('CD Root')
    return safe_scene, fixture_files, commands, rows


def push_ma2_to_onpc(fixtures: dict[str, FixtureDocument], items: list[dict], scene_name: str, ma2_ip="127.0.0.1", ma2_port=30000, username="", password="", options: dict | None = None):
    options=options or {}
    test_only=bool(options.get('testOnly'))
    import_types=bool(options.get('importFixtureTypes', True))
    patch_fixtures=bool(options.get('patchFixtures', True))
    mode=str(options.get('mode', 'all'))
    errors=[]
    warnings=[]
    sent_commands=[]
    feedback_log=[]
    temp_path=None
    cleanup_files=[]
    fixture_type_numbers={}
    is_local=_ma2_is_local_target(ma2_ip)

    def send_command(sock, command: str, wait=0.2, ignore_missing=False) -> bool:
        sock.sendall((command+'\r\n').encode('utf-8'))
        sent_commands.append(command)
        feedback=_ma2_read_feedback(sock, wait=wait)
        feedback_log.append({'command':command,'feedback':feedback})
        command_errors=_ma2_feedback_errors(feedback)
        if ignore_missing and command.startswith('Delete '):
            # For Delete commands in overwrite mode, all errors are expected
            # when the target doesn't exist (Error #14, NO OBJECTS FOUND, etc.)
            command_errors=[]
        elif ignore_missing:
            command_errors=[err for err in command_errors if 'NO OBJECTS FOUND' not in err.upper() and 'OBJECT DOES NOT EXIST' not in err.upper()]
        errors.extend(command_errors)
        command_warnings=_ma2_feedback_warnings(feedback)
        if ignore_missing:
            command_warnings=[w for w in command_warnings if 'could not find' not in w.lower()]
        warnings.extend(w for w in command_warnings if w not in warnings)
        return not command_errors

    try:
        with socket.create_connection((ma2_ip, int(ma2_port or 30000)), timeout=3) as sock:
            sock.settimeout(0.35)
            _ma2_read_feedback(sock, wait=0.35)
            login=f'Login "{_ma2_quote(username)}" "{_ma2_quote(password)}"' if username or password else None
            if login:
                send_command(sock, login)
                if errors:
                    return {'success':False,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}
            if test_only:
                return {'success':True,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}
            if not items:
                raise ValueError('MA2 push requires at least one fixture item')
            if not is_local:
                errors.append('Automatic MA2 overwrite requires Fixture Forge to run on the same computer as grandMA2 onPC. Use the MA2 patch package for remote consoles.')
                return {'success':False,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}
            if patch_fixtures and not import_types:
                errors.append('FixtureType import is required because the web page is the source of truth for one-click MA2 overwrite.')
                return {'success':False,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}

            import_dir=_ma2_data_dir('library')
            layer_dir=_ma2_data_dir('importexport')
            if import_types and not import_dir:
                errors.append('MA2 library directory was not found; cannot import current web FixtureType XML automatically.')
            if patch_fixtures and not layer_dir:
                errors.append('MA2 importexport directory was not found; cannot import current web Layer XML automatically.')
            if errors:
                return {'success':False,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}

            temp_path=import_dir
            _, fixture_files, _, _=_ma2_patch_assets(fixtures, scene_name, items)
            import_paths={}
            for fixture_file,xml in fixture_files.items():
                path=os.path.join(import_dir, fixture_file+'.xml')
                with open(path,'wb') as handle:
                    handle.write(xml)
                cleanup_files.append(path)
                import_paths[fixture_file]=fixture_file+'.xml'

            # In overwrite mode, clear the show entirely, then reuse the "all" import logic
            if mode == 'overwrite':
                # NewShow creates a blank show file — this is the only reliable way to
                # remove all fixtures, fixture types, and layers from MA2 via telnet.
                # /noconfirm is required because MA2 pops up a "Save current show?"
                # dialog by default, which blocks the telnet session with "INVALID KEY".
                send_command(sock, 'NewShow "FixtureForge_Clean" /noconfirm', wait=2.0)
                if errors:
                    warnings.append('NewShow failed — attempting to unpatch all fixtures as fallback.')
                    # Fallback: unpatch all fixtures (doesn't truly delete them but clears the patch)
                    send_command(sock, 'Delete Fixture Thru', wait=0.5, ignore_missing=True)
                    errors.clear()
                else:
                    warnings.append('Created blank show — all fixtures, fixture types, and layers cleared.')
                # Fall through to "all" mode logic below

            wanted={doc.name for doc in fixtures.values()}
            if import_types:
                for command in ['CD /','CD EditSetup','CD FixtureTypes']:
                    if not send_command(sock, command):
                        break
                if not errors:
                    # Delete the FixtureTypes being imported (for replacement)
                    delete_targets=sorted(wanted)
                    for name in delete_targets:
                        if not send_command(sock, f'Delete FixtureType "{_ma2_quote(name)}"', ignore_missing=True):
                            break
                    for fixture_file in fixture_files:
                        if not send_command(sock, f'Import "{_ma2_quote(import_paths[fixture_file])}"'):
                            break
                        if not send_command(sock, 'List', wait=0.35):
                            break
                        fixture_type_numbers.update(_parse_fixturetype_numbers(feedback_log[-1]['feedback'], wanted))
                missing=[name for name in wanted if name not in fixture_type_numbers]
                if not errors and missing:
                    errors.append('Unable to resolve MA2 FixtureType number(s): '+', '.join(missing))

            layer_files=[]
            if not errors and patch_fixtures:
                for universe, universe_items in sorted(_ma2_group_items_by_universe(items).items()):
                    layer_name=_ma2_layer_name(scene_name, universe)
                    layer_file=safe_name(layer_name)+'.xml'
                    layer_path=os.path.join(layer_dir, layer_file)
                    with open(layer_path,'wb') as handle:
                        handle.write(export_ma2_layer(fixtures, scene_name, universe_items, fixture_type_numbers, layer_name=layer_name))
                    cleanup_files.append(layer_path)
                    layer_files.append(layer_file)
                    for command in ['CD /','CD EditSetup','CD Layers',f'Delete Layer "{_ma2_quote(layer_name)}"',f'Import "{_ma2_quote(layer_file)}"']:
                        if not send_command(sock, command, ignore_missing=command.startswith('Delete Layer ')):
                            break
                    if errors:
                        break
                if not errors:
                    warnings.append('MA2 Layer overwrite complete. Fixture Forge web data replaced existing target Universe Layer(s).')
                    send_command(sock, 'CD Root')
            return {'success':not errors,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[name+'.xml' for name in fixture_files],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}
    except Exception as exc:
        errors.append(str(exc))
        return {'success':False,'sent':len(sent_commands),'errors':errors,'warnings':warnings,'files':[],'tempPath':temp_path,'commands':sent_commands,'feedback':feedback_log}
    finally:
        for path in cleanup_files:
            try: os.remove(path)
            except OSError: pass
        if temp_path and 'fixture-forge-ma2-import-' in os.path.basename(temp_path):
            shutil.rmtree(temp_path, ignore_errors=True)


def export_ma2_patch_package(fixtures: dict[str, FixtureDocument], scene_name: str, items: list[dict]):
    """Build a grandMA2 helper package from the MVR patch plan.

    The package contains fixture type XML files plus a command macro/text file
    that patches fixture IDs to the same universe/address used by the MVR plan.
    """
    safe_scene, fixture_files, commands, rows=_ma2_patch_assets(fixtures, scene_name, items)
    macro=etree.Element(f"{{{MA_NS}}}MA",nsmap={None:MA_NS},major_vers='2',minor_vers='8',stream_vers='123')
    macros=etree.SubElement(macro,f"{{{MA_NS}}}Macros")
    macro_node=etree.SubElement(macros,f"{{{MA_NS}}}Macro",name=safe_scene)
    for no,command in enumerate(commands,start=1):
        etree.SubElement(macro_node,f"{{{MA_NS}}}Macroline",index=str(no),command=command)
    patch_csv=io.StringIO()
    writer=csv.DictWriter(patch_csv,fieldnames=['fid','name','manufacturer','fixture_type','mode','universe','address','ma2_fixture_type_xml'])
    writer.writeheader()
    writer.writerows(rows)
    readme=f"""# {scene_name} grandMA2 patch package

This package was generated by Fixture Forge.

Files:
- `fixture_types/*.xml`: grandMA2 Fixture Type XML files.
- `ma2_patch_macro.xml`: macro containing patch commands.
- `ma2_patch_commands.txt`: same commands as plain text for manual copy/paste.
- `patch_plan.csv`: FID, fixture type, mode, universe, and address.

Recommended workflow in grandMA2/onPC:
1. Import the XML files in `fixture_types/` into the show as Fixture Types.
2. Create fixture instances with the FIDs listed in `patch_plan.csv`.
3. Import or copy the commands from `ma2_patch_macro.xml` / `ma2_patch_commands.txt`.
4. Run the macro. It uses `Assign Fixture <FID> At DMX <Universe>.<Address>`.

The patch syntax follows MA Lighting's grandMA2 DMX keyword documentation:
`Assign [Fixture-list] (At) [DMX start]`.
"""
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
        for filename,xml in fixture_files.items():
            archive.writestr(f'fixture_types/{filename}.xml',xml)
        archive.writestr('ma2_patch_macro.xml',etree.tostring(macro,encoding='utf-8',xml_declaration=True,pretty_print=True))
        archive.writestr('ma2_patch_commands.txt','\n'.join(commands)+'\n')
        archive.writestr('patch_plan.csv',patch_csv.getvalue().encode('utf-8-sig'))
        archive.writestr('README.md',readme)
    return out.getvalue()
