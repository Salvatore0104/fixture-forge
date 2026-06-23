import io, json, uuid
from fastapi import FastAPI, HTTPException, UploadFile, File, Response
from fastapi.middleware.cors import CORSMiddleware
from .schemas import FixtureDocument, Preset, Manufacturer
from .db import list_records, get_record, save_record, delete_record
from .catalog import GROUPS, ATTRIBUTES
from .formats import import_ma2, import_gdtf, import_mvr_fixture_options, export_ma2, export_gdtf, export_ue_bundle, export_mvr_scene, validate_fixture, safe_name

app=FastAPI(title='Fixture Forge API',version='1.0.0')
app.add_middleware(CORSMiddleware,allow_origins=['*'],allow_methods=['*'],allow_headers=['*'])

@app.get('/api/health')
def health(): return {'status':'ok','service':'fixture-forge'}
@app.get('/api/attributes')
def attributes():
    custom = list_records('custom_attribute')
    for item in custom:
        item['custom'] = True
        if item.get('maFeature') not in {x['id'] for x in GROUPS}: item['maFeature'] = 'CONTROL'
    return {'version':'1.2','groups':GROUPS,'attributes':ATTRIBUTES+custom}
@app.post('/api/attributes/custom')
def create_custom_attribute(payload:dict):
    attribute_id = str(payload.get('id','')).strip().upper().replace(' ','_')
    if not attribute_id: raise HTTPException(400,'自定义属性英文标识不能为空')
    group = str(payload.get('maFeature','CONTROL')).strip().upper().replace(' ','_') or 'CONTROL'
    if group not in {x['id'] for x in GROUPS}: raise HTTPException(400,'属性簇必须选择 MA 标准 FeatureGroup')
    item = {'id':attribute_id,'ma2Attribute':attribute_id,'maFeature':group,
            'preset':group,'gdtfAttribute':attribute_id,
            'ueAttribute':str(payload.get('ueAttribute') or attribute_id),
            'nameZh':str(payload.get('nameZh') or attribute_id),
            'keywords':str(payload.get('keywords') or ''),'custom':True}
    return save_record(attribute_id,'custom_attribute',item,None)
@app.put('/api/attributes/custom/{attribute_id}')
def update_custom_attribute(attribute_id:str,payload:dict):
    current = get_record(attribute_id,'custom_attribute')
    if not current: raise HTTPException(404,'自定义属性不存在')
    group = str(payload.get('maFeature',current.get('maFeature','CONTROL'))).upper()
    if group not in {x['id'] for x in GROUPS}: raise HTTPException(400,'属性簇必须选择 MA 标准 FeatureGroup')
    current.update({'nameZh':str(payload.get('nameZh') or current.get('nameZh') or attribute_id),
                    'ueAttribute':str(payload.get('ueAttribute') or current.get('ueAttribute') or attribute_id),
                    'maFeature':group,'preset':group,'keywords':str(payload.get('keywords') or '')})
    return save_record(attribute_id,'custom_attribute',current,current.get('revision'))
@app.delete('/api/attributes/custom/{attribute_id}')
def remove_custom_attribute(attribute_id:str): return {'ok':delete_record(attribute_id,'custom_attribute')}
@app.get('/api/fixtures')
def fixtures(): return list_records('fixture')
@app.post('/api/fixtures')
def create_fixture(f: FixtureDocument): return save_record(f.id,'fixture',f.model_dump(),None)
@app.get('/api/fixtures/{fixture_id}')
def fixture(fixture_id:str):
    value=get_record(fixture_id,'fixture')
    if not value: raise HTTPException(404,'灯具不存在')
    return value
@app.put('/api/fixtures/{fixture_id}')
def update_fixture(fixture_id:str,f:FixtureDocument):
    try: return save_record(fixture_id,'fixture',f.model_dump(),f.revision)
    except ValueError as e: raise HTTPException(409,str(e))
@app.delete('/api/fixtures/{fixture_id}')
def remove_fixture(fixture_id:str):
    if not delete_record(fixture_id,'fixture'): raise HTTPException(404,'灯具不存在')
    return {'ok':True}
@app.post('/api/fixtures/{fixture_id}/duplicate')
def duplicate_fixture(fixture_id:str):
    value=get_record(fixture_id,'fixture')
    if not value: raise HTTPException(404,'灯具不存在')
    value['id']=str(uuid.uuid4()); value['name']+=' 副本'; value['revision']=0
    return save_record(value['id'],'fixture',value,None)
@app.get('/api/fixtures/{fixture_id}/validate')
def validate(fixture_id:str): return validate_fixture(FixtureDocument.model_validate(fixture(fixture_id)))

async def read_upload(file:UploadFile,limit=20_000_000):
    data=await file.read(limit+1)
    if len(data)>limit: raise HTTPException(413,'文件超过20MB限制')
    return data
@app.post('/api/import/ma2')
async def ma2_import(file:UploadFile=File(...)):
    try: return import_ma2(await read_upload(file))
    except Exception as e: raise HTTPException(400,f'MA2 XML 解析失败：{e}')
@app.post('/api/import/gdtf')
async def gdtf_import(file:UploadFile=File(...)):
    try: return import_gdtf(await read_upload(file))
    except Exception as e: raise HTTPException(400,f'GDTF 解析失败：{e}')

@app.post('/api/import/mvr/preview')
async def mvr_preview(file:UploadFile=File(...)):
    try:
        options=import_mvr_fixture_options(await read_upload(file,80_000_000))
        return [{'key':x['key'],'index':x['index'],'name':x['name'],'manufacturer':x['manufacturer'],'modes':x['modes'],'footprint':x['footprint']} for x in options]
    except Exception as e: raise HTTPException(400,f'MVR 解析失败：{e}')
@app.post('/api/import/mvr')
async def mvr_import(file:UploadFile=File(...), selected:str=''):
    try:
        wanted={int(x) for x in selected.split(',') if x.strip()!=''}
        options=import_mvr_fixture_options(await read_upload(file,80_000_000))
        imported=[]
        for option in options:
            if wanted and option['index'] not in wanted: continue
            fixture_doc=FixtureDocument.model_validate(option['fixture'])
            imported.append(save_record(fixture_doc.id,'fixture',fixture_doc.model_dump(),None))
        return imported
    except Exception as e: raise HTTPException(400,f'MVR 导入失败：{e}')

def load_fixture(fid): return FixtureDocument.model_validate(fixture(fid))
@app.get('/api/export/ma2/{fixture_id}')
def ma2_export(fixture_id:str):
    f=load_fixture(fixture_id); return Response(export_ma2(f),media_type='application/xml',headers={'Content-Disposition':f'attachment; filename="{safe_name(f.name)}.xml"'})
@app.get('/api/export/gdtf/{fixture_id}')
def gdtf_export(fixture_id:str):
    f=load_fixture(fixture_id); return Response(export_gdtf(f),media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="{safe_name(f.name)}.gdtf"'})
@app.get('/api/export/ue/{fixture_id}')
def ue_export(fixture_id:str):
    f=load_fixture(fixture_id); payload={'sceneName':f.name,'items':[{'fixtureId':f.id}]}; return Response(export_mvr_scene({f.id:f},payload['sceneName'],payload['items']),media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="{safe_name(f.name)}-UE5.7.mvr"'})
@app.post('/api/export/mvr')
def mvr_export(payload:dict):
    items=payload.get('items') or []
    if not items: raise HTTPException(400,'MVR 场景中至少需要一个灯具实例')
    fixture_ids={str(item.get('fixtureId')) for item in items}; documents={}
    for fixture_id in fixture_ids:
        value=get_record(fixture_id,'fixture')
        if not value: raise HTTPException(404,f'灯具不存在：{fixture_id}')
        documents[fixture_id]=FixtureDocument.model_validate(value)
    scene_name=str(payload.get('sceneName') or 'FixtureForge_MVR')
    return Response(export_mvr_scene(documents,scene_name,items),media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="{safe_name(scene_name)}.mvr"'})

@app.get('/api/presets')
def presets(): return list_records('preset')
@app.post('/api/presets')
def create_preset(p:Preset): return save_record(p.id,'preset',p.model_dump(),None)
@app.put('/api/presets/{pid}')
def update_preset(pid:str,p:Preset): return save_record(pid,'preset',p.model_dump(),None)
@app.delete('/api/presets/{pid}')
def remove_preset(pid:str): return {'ok':delete_record(pid,'preset')}
@app.get('/api/manufacturers')
def manufacturers(): return list_records('manufacturer')
@app.post('/api/manufacturers')
def create_manufacturer(m:Manufacturer): return save_record(m.id,'manufacturer',m.model_dump(),None)
@app.delete('/api/manufacturers/{mid}')
def remove_manufacturer(mid:str): return {'ok':delete_record(mid,'manufacturer')}
@app.get('/api/backup')
def backup(): return {'schemaVersion':'1.0','fixtures':list_records('fixture'),'presets':list_records('preset'),'manufacturers':list_records('manufacturer')}
@app.post('/api/backup')
def restore(payload:dict):
    for kind,key in [('fixture','fixtures'),('preset','presets'),('manufacturer','manufacturers')]:
        for item in payload.get(key,[]): save_record(item['id'],kind,item,None)
    return {'ok':True}
