import io, json, re, uuid, zipfile
from datetime import datetime
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
                if address > 512: issues.append({"level":"error","code":"ADDRESS_OVERFLOW","message":f"{mode.name}：{ch.name} 超出512通道"})
                if address in used: issues.append({"level":"error","code":"ADDRESS_CONFLICT","message":f"{mode.name}：地址 {address} 与 {used[address]} 重复"})
                used[address] = ch.name
            ordered = sorted(ch.functions, key=lambda x:x.dmxFrom)
            for i, fn in enumerate(ordered):
                if fn.dmxFrom > fn.dmxTo or fn.dmxTo > max_dmx(ch): issues.append({"level":"error","code":"FUNCTION_RANGE","message":f"{ch.name} 的功能范围无效"})
                if i and fn.dmxFrom <= ordered[i-1].dmxTo: issues.append({"level":"error","code":"FUNCTION_OVERLAP","message":f"{ch.name} 的功能范围重叠"})
                if i and fn.dmxFrom > ordered[i-1].dmxTo + 1: issues.append({"level":"warning","code":"FUNCTION_GAP","message":f"{ch.name} 的功能范围存在空洞"})
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
        attrs = {"attribute":ch.attribute,"feature":ch.group,"preset":ch.group,"coarse":str(ch.address),"default":str(ch.defaultValue),"highlight_value":str(ch.highlightValue)}
        if ch.resolution >= 16: attrs["fine"] = str(ch.address + 1)
        if ch.resolution >= 24: attrs["ultra"] = str(ch.address + 2)
        if ch.resolution >= 32: attrs["ultimo"] = str(ch.address + 3)
        ct = etree.SubElement(module, f"{{{MA_NS}}}ChannelType", **attrs)
        funcs = ch.functions or [type('F',(),{"name":ch.name,"dmxFrom":0,"dmxTo":max_dmx(ch),"physicalFrom":ch.physicalFrom,"physicalTo":ch.physicalTo,"attribute":ch.attribute})()]
        for fn in funcs:
            etree.SubElement(ct, f"{{{MA_NS}}}ChannelFunction", name=fn.name, from_=str(fn.dmxFrom), to=str(fn.dmxTo), min_dmx_24=str(round(fn.dmxFrom/max_dmx(ch)*16777215)), max_dmx_24=str(round(fn.dmxTo/max_dmx(ch)*16777215)), physfrom=str(fn.physicalFrom), physto=str(fn.physicalTo), attribute=fn.attribute, feature=ch.group, preset=ch.group)
    instances = etree.SubElement(ft, f"{{{MA_NS}}}Instances")
    etree.SubElement(instances, f"{{{MA_NS}}}Instance", module_index="0", patch="1", locked="true")
    etree.SubElement(ft, f"{{{MA_NS}}}Wheels")
    return etree.tostring(root, encoding="utf-8", xml_declaration=True, pretty_print=True).replace(b'from_=', b'from=')

def import_ma2(data: bytes):
    root = etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True, recover=False))
    ft = root.xpath('//*[local-name()="FixtureType"]')[0]
    manufacturer = ''.join(ft.xpath('./*[local-name()="manufacturer"]/text()')) or "未知公司"
    short_m = ''.join(ft.xpath('./*[local-name()="short_manufacturer"]/text()'))
    channels=[]
    for i, ct in enumerate(ft.xpath('.//*[local-name()="ChannelType"]')):
        attr=ct.get('attribute','DIM'); coarse=int(ct.get('coarse',i+1)); res=8
        if ct.get('fine'): res=16
        if ct.get('ultra'): res=24
        if ct.get('ultimo'): res=32
        meta=next((x for x in ATTRIBUTES if x['ma2Attribute']==attr),None)
        funcs=[]
        for fn in ct.xpath('./*[local-name()="ChannelFunction"]'):
            funcs.append({"id":str(uuid.uuid4()),"name":fn.get('name',attr),"dmxFrom":int(fn.get('from',0)),"dmxTo":int(fn.get('to',(1<<res)-1)),"physicalFrom":float(fn.get('physfrom',0)),"physicalTo":float(fn.get('physto',1)),"attribute":fn.get('attribute',attr)})
        channels.append({"id":str(uuid.uuid4()),"address":coarse,"attribute":attr,"group":ct.get('feature',meta['maFeature'] if meta else 'CONTROL'),"name":meta['ueAttribute'] if meta else attr,"resolution":res,"byteOrder":"MSB","defaultValue":int(ct.get('default',0)),"highlightValue":int(ct.get('highlight_value',(1<<res)-1)),"ueAttribute":meta['ueAttribute'] if meta else attr,"functions":funcs})
    return {"id":str(uuid.uuid4()),"schemaVersion":"1.0","revision":0,"name":ft.get('name','导入灯具'),"shortName":''.join(ft.xpath('./*[local-name()="short_name"]/text()')),"manufacturer":{"id":str(uuid.uuid4()),"name":manufacturer,"shortName":short_m},"category":"Other","version":"1.0","notes":"由 MA2 XML 导入","modes":[{"id":str(uuid.uuid4()),"name":ft.get('mode','默认模式'),"channels":channels}],"wheels":[]}

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
        if len(infos)>1000 or sum(x.file_size for x in infos)>50_000_000: raise ValueError('GDTF 压缩包过大')
        if any('..' in x.filename.replace('\\','/').split('/') for x in infos): raise ValueError('GDTF 包含非法路径')
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
        modes.append({"id":str(uuid.uuid4()),"name":mn.get('Name','默认模式'),"channels":channels})
    return {"id":str(uuid.uuid4()),"schemaVersion":"1.0","revision":0,"name":ft.get('Name','导入灯具'),"shortName":ft.get('ShortName',''),"manufacturer":{"id":str(uuid.uuid4()),"name":ft.get('Manufacturer','未知公司'),"shortName":""},"category":"Other","version":"1.0","notes":"由 GDTF 导入","modes":modes,"wheels":[]}

def _checked_zip(data: bytes, label: str, max_entries=2000, max_size=150_000_000):
    archive=zipfile.ZipFile(io.BytesIO(data))
    infos=archive.infolist()
    if len(infos)>max_entries or sum(x.file_size for x in infos)>max_size: raise ValueError(f'{label} 压缩包过大')
    if any('..' in x.filename.replace('\\','/').split('/') or x.filename.startswith(('/', '\\')) for x in infos): raise ValueError(f'{label} 包含非法路径')
    return archive

def import_mvr_fixture_options(data: bytes):
    with _checked_zip(data,'MVR') as archive:
        names={x.filename.replace('\\','/'):x.filename for x in archive.infolist()}
        gdtf_names=[name for name in names if name.lower().endswith('.gdtf')]
        ordered=[]
        if 'GeneralSceneDescription.xml' in names:
            root=etree.fromstring(archive.read(names['GeneralSceneDescription.xml']),etree.XMLParser(resolve_entities=False,no_network=True))
            for spec in root.xpath('//*[local-name()="Fixture"]/*[local-name()="GDTFSpec"]/text()'):
                candidate=spec if spec.lower().endswith('.gdtf') else spec+'.gdtf'
                match=next((name for name in gdtf_names if name.lower()==candidate.lower() or name.lower().endswith('/'+candidate.lower())),None)
                if match and match not in ordered: ordered.append(match)
        ordered += [name for name in gdtf_names if name not in ordered]
        result=[]
        for index,name in enumerate(ordered):
            fixture=FixtureDocument.model_validate(import_gdtf(archive.read(names[name])))
            fixture.notes='由 MVR 内嵌 GDTF 导入'
            footprint=max((c.address+bytes_for(c)-1 for mode in fixture.modes for c in mode.channels),default=0)
            result.append({'key':name,'index':index,'name':fixture.name,'manufacturer':fixture.manufacturer.name,'modes':[m.name for m in fixture.modes],'footprint':footprint,'fixture':fixture.model_dump()})
        return result

def export_ue_bundle(f: FixtureDocument):
    report=validate_fixture(f); mapping={"schemaVersion":"1.0","fixture":f.name,"manufacturer":f.manufacturer.name,"modes":[{"name":m.name,"footprint":max((c.address+bytes_for(c)-1 for c in m.channels),default=0),"channels":[{"address":c.address,"name":c.name,"maAttribute":c.attribute,"ueAttribute":c.ueAttribute,"resolution":c.resolution,"byteOrder":c.byteOrder} for c in m.channels]} for m in f.modes]}
    script='''import json, os, unreal\n# 在 UE 5.7 编辑器中运行；读取同目录 ue-fixture-map.json 创建 DMX Library。\nroot=os.path.dirname(__file__)\nwith open(os.path.join(root,"ue-fixture-map.json"),encoding="utf-8") as h: data=json.load(h)\nunreal.log("Fixture Forge: loaded %s (%d modes)" % (data["fixture"],len(data["modes"])))\n# 推荐：先通过 DMXGDTF 插件导入同包内 .gdtf，再按映射检查 Blueprint 属性。\n'''
    out=io.BytesIO(); filename=safe_name(f.name)
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr(filename+'.gdtf',export_gdtf(f)); z.writestr('ue-fixture-map.json',json.dumps(mapping,ensure_ascii=False,indent=2)); z.writestr('validation-report.json',json.dumps(report,ensure_ascii=False,indent=2)); z.writestr('import_ue_fixture.py',script); z.writestr('README.md',f'# {f.name} UE 5.7 导入包\n\n1. 启用 DMXEngine、DMXGDTF、DMXFixtures。\n2. 在内容浏览器导入 `{filename}.gdtf`。\n3. 使用 `ue-fixture-map.json` 核对 Blueprint 属性。\n4. 如需自动检查，在 UE Python 控制台运行 `import_ue_fixture.py`。\n')
    return out.getvalue()

def export_mvr_scene(fixtures: dict[str, FixtureDocument], scene_name: str, items: list[dict]):
    """Build an MVR scene with embedded GDTF fixture types and fixture patch addresses."""
    root=etree.Element('GeneralSceneDescription',verMajor='1',verMinor='5')
    user=etree.SubElement(root,'UserData'); data=etree.SubElement(user,'Data',provider='FixtureForge',ver='1.0'); etree.SubElement(data,'CreationDate').text=datetime.now().strftime('%Y.%m.%d-%H.%M.%S')
    scene=etree.SubElement(root,'Scene'); layers=etree.SubElement(scene,'Layers'); layer=etree.SubElement(layers,'Layer',uuid=str(uuid.uuid5(uuid.NAMESPACE_DNS,scene_name+'-layer')).upper()); children=etree.SubElement(layer,'ChildList')
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
        address=etree.SubElement(addresses,'Address',break_='0',universe=str(max(1,min(256,int(item.get('universe') or 1)))))
        address.text=str(max(1,min(512,int(item.get('address') or 1))))
    xml=etree.tostring(root,encoding='utf-8',xml_declaration=True,pretty_print=True).replace(b'break_=',b'break=')
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('GeneralSceneDescription.xml',xml)
        for base,gdtf in gdtf_files.items(): archive.writestr(base+'.gdtf',gdtf)
    return out.getvalue()
