import {useEffect,useMemo,useRef,useState} from 'react';
import {App as AntApp,Button,Checkbox,Divider,Empty,Input,InputNumber,Modal,Popconfirm,Select,Switch,Tag,Tooltip} from 'antd';
import {ApartmentOutlined,CheckCircleOutlined,CopyOutlined,DeleteOutlined,DownloadOutlined,HolderOutlined,PlusOutlined,SaveOutlined,SearchOutlined,SettingOutlined,UploadOutlined,WarningOutlined} from '@ant-design/icons';
import {arrayMove} from '@dnd-kit/sortable';
import {api,download,downloadMvr} from './api';
import {draft} from './draft';
import {useStore} from './store';
import {compactModeAddresses,modeFootprint,removeChannelAndCompact} from './model';
import type {AttributeDef,Catalog,DmxChannel,FixtureDocument,MvrImportOption,Resolution} from './types';

const uid=()=>crypto.randomUUID();
const patchColors=['#18d5e8','#75e900','#2820bb','#ffb000','#d44aff','#ff4d4f','#00b578','#4096ff'];

interface MvrItem{
  id:string;
  fixtureId:string;
  fid:number;
  modeName:string;
  universe:number;
  address:number;
  color:string;
  name:string;
}

const emptyFixture=():FixtureDocument=>({
  id:uid(),
  schemaVersion:'1.0',
  revision:0,
  name:'NewFixture',
  shortName:'NewFixture',
  manufacturer:{id:uid(),name:'自定义',shortName:'CUS'},
  category:'Moving Head',
  version:'1.0',
  notes:'',
  modes:[{id:uid(),name:'Profile',channels:[]}],
  wheels:[]
});

const defaultChannel=(address:number,attr?:AttributeDef):DmxChannel=>({
  id:uid(),
  address,
  attribute:attr?.id||'DIM',
  group:attr?.maFeature||'DIMMER',
  name:attr?.ueAttribute||'Dimmer',
  resolution:8,
  byteOrder:'MSB',
  defaultValue:0,
  highlightValue:255,
  physicalFrom:0,
  physicalTo:1,
  unit:'Percent',
  inverted:false,
  ueAttribute:attr?.ueAttribute||'Dimmer',
  functions:[]
});

const defaultPatchPrefix=(fixture?:FixtureDocument)=>(
  (fixture?.shortName||fixture?.name||'Fixture').replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'')||'Fixture'
);
const patchName=(prefix:string,index:number)=>`${(prefix||'Fixture').trim()||'Fixture'}_${String(index).padStart(4,'0')}`;
const fixtureFootprint=(fixture?:FixtureDocument,modeName?:string)=>{
  const mode=fixture?.modes.find(m=>m.name===modeName)||fixture?.modes[0];
  return modeFootprint(mode);
};
const attributeOptions=(catalog?:Catalog)=>catalog?.groups.map(group=>({
  label:`${group.id} / ${group.nameZh}`,
  options:catalog.attributes.filter(a=>a.maFeature===group.id).map(a=>({value:a.id,label:`${a.id} · ${a.nameZh}`}))
}))||[];

function Workbench(){
  const {message}=AntApp.useApp();
  const {fixtures,active,modeId,channelId,dirty,setFixtures,select,setActive,selectMode,selectChannel}=useStore();

  const [catalog,setCatalog]=useState<Catalog>();
  const [workspace,setWorkspace]=useState<'fixture'|'mvr'>(()=>localStorage.getItem('fixture-forge:workspace')==='mvr'?'mvr':'fixture');
  const [query,setQuery]=useState('');
  const [libraryQuery,setLibraryQuery]=useState('');
  const [managerOpen,setManagerOpen]=useState(false);
  const [editorOpen,setEditorOpen]=useState(false);
  const [editingId,setEditingId]=useState<string>();
  const [custom,setCustom]=useState({id:'',nameZh:'',ueAttribute:'',maFeature:'CONTROL'});
  const [validation,setValidation]=useState<{valid:boolean;issues:{level:string;message:string}[]}>({valid:true,issues:[]});
  const [autoSaveState,setAutoSaveState]=useState<'idle'|'saving'|'saved'|'error'>('idle');

  const [sceneName,setSceneName]=useState('UE_DMXLibrary');
  const [mvrItems,setMvrItems]=useState<MvrItem[]>([]);
  const [selectedPatch,setSelectedPatch]=useState<string>();
  const [selectedPatchIds,setSelectedPatchIds]=useState<string[]>([]);
  const [patchSelectionAnchor,setPatchSelectionAnchor]=useState<string>();
 const [editingPatchId,setEditingPatchId]=useState<string>();
  const [modeEditorOpen,setModeEditorOpen]=useState(false);
  const [editingModeId,setEditingModeId]=useState<string>();
  const [editingModeName,setEditingModeName]=useState('');
  const [universeView,setUniverseView]=useState(1);
  const [mvrDraftReady,setMvrDraftReady]=useState(false);
 const [dragFixtureId,setDragFixtureId]=useState<string>();
 const [addPatchOpen,setAddPatchOpen]=useState(false);
  const [addPatch,setAddPatch]=useState({fixtureId:'',modeName:'',prefix:'Fixture',universe:1,address:1,quantity:1,increment:true});
  const [mvrImportFile,setMvrImportFile]=useState<File>();
  const [mvrImportOptions,setMvrImportOptions]=useState<MvrImportOption[]>([]);
  const [mvrImportSelected,setMvrImportSelected]=useState<number[]>([]);
 const [mvrImportOpen,setMvrImportOpen]=useState(false);
  useEffect(()=>{
    if(!editingPatchId)return;
    const handler=(e:PointerEvent)=>{
      const target=e.target as HTMLElement;
      if(target.closest('.patch-row.editing')||target.closest('.ant-select-dropdown')||target.closest('.ant-modal'))return;
      setEditingPatchId(undefined);
    };
    window.addEventListener('pointerdown',handler,true);
    return()=>window.removeEventListener('pointerdown',handler,true);
  },[editingPatchId]);

  const fileRef=useRef<HTMLInputElement>(null);
  const mvrFileRef=useRef<HTMLInputElement>(null);
  const universeGridRef=useRef<HTMLDivElement>(null);

  const mode=active?.modes.find(m=>m.id===modeId)||active?.modes[0];
  const channel=mode?.channels.find(c=>c.id===channelId);
  const selectedMvrItem=mvrItems.find(x=>x.id===selectedPatch);
  const fixtureById=useMemo(()=>new Map(fixtures.map(f=>[f.id,f])),[fixtures]);

  const setPatchSelection=(ids:string[])=>{
    const unique=Array.from(new Set(ids)).filter(id=>mvrItems.some(item=>item.id===id));
    setSelectedPatchIds(unique);
    setSelectedPatch(unique[unique.length-1]);
    if(unique.length!==1)setEditingPatchId(undefined);
  };

  useEffect(()=>{
    Promise.all([api.catalog(),api.fixtures()]).then(async([c,fs])=>{
      setCatalog(c);
      setFixtures(fs);
      const first=fs[0];
      if(first){
        const d=await draft.get(first.id);
        select(d||first);
        if(d)message.info('已恢复浏览器中的灯具草稿');
      }
    }).catch(e=>message.error(e.message));
  },[]);

  useEffect(()=>{
    try{
      const raw=localStorage.getItem('fixture-forge:mvr-draft');
      if(raw){
        const d=JSON.parse(raw);
        setSceneName(d.sceneName||'UE_DMXLibrary');
        setMvrItems(Array.isArray(d.items)?d.items:[]);
        setUniverseView(Math.max(1,Math.min(256,d.universeView||1)));
        setSelectedPatch(d.selectedPatch);
      }
    }catch{}finally{
      setMvrDraftReady(true);
    }
  },[]);

  useEffect(()=>{
    if(!mvrDraftReady)return;
    localStorage.setItem('fixture-forge:mvr-draft',JSON.stringify({sceneName,items:mvrItems,universeView,selectedPatch}));
  },[mvrDraftReady,sceneName,mvrItems,universeView,selectedPatch]);

 useEffect(()=>localStorage.setItem('fixture-forge:workspace',workspace),[workspace]);

  useEffect(()=>{
    const valid=new Set(mvrItems.map(item=>item.id));
    setSelectedPatchIds(ids=>ids.filter(id=>valid.has(id)));
    if(selectedPatch&&!valid.has(selectedPatch))setSelectedPatch(undefined);
    if(editingPatchId&&!valid.has(editingPatchId))setEditingPatchId(undefined);
  },[mvrItems,selectedPatch,editingPatchId]);

  useEffect(()=>{
    const onKeyDown=(e:KeyboardEvent)=>{
      if(workspace!=='mvr'||e.key!=='Delete'||!selectedPatchIds.length)return;
      const target=e.target as HTMLElement|null;
      if(target?.closest('input,textarea,[contenteditable="true"],.ant-select-dropdown'))return;
      e.preventDefault();
      const doomed=new Set(selectedPatchIds);
      setMvrItems(items=>items.filter(item=>!doomed.has(item.id)));
      setSelectedPatch(undefined);
      setSelectedPatchIds([]);
      setEditingPatchId(undefined);
      message.success(`已删除 ${doomed.size} 个配接`);
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[workspace,selectedPatchIds,message]);

  useEffect(()=>{
    if(!active||!dirty)return;
    const persisted=fixtures.some(x=>x.id===active.id);
    const timer=setTimeout(async()=>{
      await draft.set(active);
      if(!persisted)return;
      setAutoSaveState('saving');
      try{
        const saved=await api.save(active);
        setFixtures(useStore.getState().fixtures.map(x=>x.id===saved.id?saved:x));
        setActive(saved,false);
        await draft.remove(saved.id);
        setAutoSaveState('saved');
      }catch{
        setAutoSaveState('error');
      }
    },persisted?1500:500);
    return()=>clearTimeout(timer);
  },[active,dirty,fixtures,setActive,setFixtures]);

  useEffect(()=>{
    if(active&&!dirty&&fixtures.some(x=>x.id===active.id))api.validate(active.id).then(setValidation).catch(()=>{});
  },[active?.revision,dirty,fixtures.length]);

  useEffect(()=>{
    if(!selectedMvrItem||selectedMvrItem.universe!==universeView)return;
    requestAnimationFrame(()=>{
      universeGridRef.current?.querySelector(`[data-channel="${selectedMvrItem.address}"]`)?.scrollIntoView({block:'nearest',inline:'center'});
    });
  },[selectedMvrItem?.id,selectedMvrItem?.address,selectedMvrItem?.universe,universeView]);

  const patch=(fn:(fixture:FixtureDocument)=>void)=>{
    if(!active)return;
    const next=structuredClone(active);
    fn(next);
    setActive(next,true);
  };

  const patchChannelById=(id:string,p:Partial<DmxChannel>)=>patch(f=>{
    const target=f.modes.find(m=>m.id===modeId)||f.modes[0];
    const ch=target.channels.find(c=>c.id===id);
    if(!ch)return;
    Object.assign(ch,p);
    if(p.resolution!==undefined)compactModeAddresses(target);
  });

  const save=async()=>{
    if(!active)return;
    setAutoSaveState('saving');
    try{
      const saved=fixtures.some(x=>x.id===active.id)?await api.save(active):await api.create(active);
      setFixtures([...fixtures.filter(x=>x.id!==saved.id),saved]);
      setActive(saved,false);
      await draft.remove(saved.id);
      setAutoSaveState('saved');
      message.success('灯具已保存，局域网用户均可读取');
    }catch(e){
      setAutoSaveState('error');
      message.error((e as Error).message);
    }
  };

  const addFixture=()=>{
    const f=emptyFixture();
    select(f);
    setActive(f,true);
  };

  const removeFixture=async(id:string)=>{
    try{
      await api.remove(id);
      const next=fixtures.filter(f=>f.id!==id);
      setFixtures(next);
      if(active?.id===id)select(next[0]);
      await draft.remove(id);
      message.success('灯具已删除');
    }catch(e){
      message.error((e as Error).message);
    }
  };

  const addChannel=()=>{
    if(!mode||!catalog)return;
    const ch=defaultChannel(modeFootprint(mode)+1,catalog.attributes[0]);
    patch(f=>(f.modes.find(m=>m.id===mode.id)||f.modes[0]).channels.push(ch));
    selectChannel(ch.id);
  };

  const copyChannel=(id:string)=>{
    if(!mode)return;
    const source=mode.channels.find(c=>c.id===id);
    if(!source)return;
    const copy={...structuredClone(source),id:uid(),address:modeFootprint(mode)+1};
    patch(f=>(f.modes.find(m=>m.id===mode.id)||f.modes[0]).channels.push(copy));
    selectChannel(copy.id);
  };

  const removeChannel=(id:string)=>{
    if(!mode)return;
    patch(f=>removeChannelAndCompact(f.modes.find(m=>m.id===mode.id)||f.modes[0],id));
    selectChannel(undefined);
  };

  const importFile=async(file:File)=>{
    try{
      const f=await api.importFile(file);
      select(f);
      setActive(f,true);
      message.success('文件解析成功，请检查后保存');
    }catch(e){
      message.error((e as Error).message);
    }
  };

  const openAttributeEditor=(attr?:AttributeDef)=>{
    setEditingId(attr?.id);
    setCustom(attr?{id:attr.id,nameZh:attr.nameZh,ueAttribute:attr.ueAttribute,maFeature:attr.maFeature}:{id:'',nameZh:'',ueAttribute:'',maFeature:'CONTROL'});
    setEditorOpen(true);
  };

  const saveCustomAttribute=async()=>{
    if(!custom.id.trim()||!custom.nameZh.trim()||!custom.ueAttribute.trim()){
      message.error('请完整填写英文标识、中文显示名和 UE 英文名');
      return;
    }
    try{
      await (editingId?api.updateAttribute(editingId,custom):api.createAttribute(custom));
      setCatalog(await api.catalog());
      setEditorOpen(false);
      message.success(editingId?'自定义属性已更新':'自定义属性已添加');
    }catch(e){
      message.error((e as Error).message);
    }
  };

  const removeCustomAttribute=async(id:string)=>{
    try{
      await api.removeAttribute(id);
      setCatalog(await api.catalog());
      message.success('自定义属性已删除');
    }catch(e){
      message.error((e as Error).message);
    }
  };

  const shown=(mode?.channels||[]).filter(ch=>`${ch.address} ${ch.attribute} ${ch.name}`.toLowerCase().includes(query.toLowerCase()));
  const library=fixtures.filter(f=>`${f.name} ${f.manufacturer.name}`.toLowerCase().includes(libraryQuery.toLowerCase()));

  const nextPatchAddress=(universe:number)=>Math.min(512,Math.max(1,...mvrItems.filter(x=>x.universe===universe).map(x=>x.address+fixtureFootprint(fixtureById.get(x.fixtureId),x.modeName))));
  const prefixColor=(prefix:string)=>{
    const existing=mvrItems.find(item=>item.name.startsWith(`${prefix}_`));
    if(existing)return existing.color;
    let hash=0;
    for(const ch of prefix)hash=(hash*31+ch.charCodeAt(0))>>>0;
    return patchColors[hash%patchColors.length];
  };
  const normalizePatchPosition=(universe:number,address:number,footprint:number)=>{
    let u=Math.max(1,Math.min(256,universe));
    let a=Math.max(1,Math.min(512,address));
    if(a+footprint-1>512&&u<256){
      u+=1;
      a=1;
    }
    return {universe:u,address:a};
  };
  const advancePatchPosition=(universe:number,address:number,footprint:number)=>{
    let nextUniverse=universe;
    let nextAddress=address+footprint;
    if(nextAddress+footprint-1>512&&nextUniverse<256){
      nextUniverse+=1;
      nextAddress=1;
    }
    return {universe:nextUniverse,address:Math.min(512,nextAddress)};
  };

  const openAddPatch=(fixtureId?:string)=>{
    const fixture=fixtures.find(x=>x.id===(fixtureId||fixtures[0]?.id));
    if(!fixture)return;
    const universe=universeView;
    setAddPatch({fixtureId:fixture.id,modeName:fixture.modes[0]?.name||'Profile',prefix:defaultPatchPrefix(fixture),universe,address:nextPatchAddress(universe),quantity:1,increment:true});
    setAddPatchOpen(true);
  };

  const confirmAddPatch=()=>{
    const fixture=fixtures.find(x=>x.id===addPatch.fixtureId);
    if(!fixture)return;
    const count=Math.max(1,Math.min(512,addPatch.quantity||1));
    const footprint=Math.max(1,fixtureFootprint(fixture,addPatch.modeName));
    const startIndex=mvrItems.filter(x=>x.name.startsWith(`${addPatch.prefix}_`)).length+1;
    const color=prefixColor(addPatch.prefix);
    let cursor=normalizePatchPosition(addPatch.universe,addPatch.address,footprint);
    const created=Array.from({length:count},(_,i)=>{
      const pos=addPatch.increment?cursor:normalizePatchPosition(addPatch.universe,addPatch.address,footprint);
      const item={
        id:uid(),
        fixtureId:addPatch.fixtureId,
        fid:mvrItems.length+i+1,
        modeName:addPatch.modeName,
        universe:pos.universe,
        address:pos.address,
        color,
        name:patchName(addPatch.prefix,startIndex+i)
      } as MvrItem;
      if(addPatch.increment)cursor=advancePatchPosition(pos.universe,pos.address,footprint);
      return item;
    });
    setMvrItems([...mvrItems,...created]);
    setSelectedPatchIds(created.map(item=>item.id));
    setSelectedPatch(created[created.length-1]?.id);
    setPatchSelectionAnchor(created[0]?.id);
    setUniverseView(created[0]?.universe||addPatch.universe);
    setAddPatchOpen(false);
  };

  const patchMvrItem=(id:string,p:Partial<MvrItem>)=>setMvrItems(items=>items.map(x=>x.id===id?{...x,...p}:x));

  const deleteMvrItems=(ids:string[])=>{
    const doomed=new Set(ids);
    setMvrItems(items=>items.filter(item=>!doomed.has(item.id)));
    setSelectedPatch(undefined);
    setSelectedPatchIds([]);
    setEditingPatchId(undefined);
  };

  const selectPatchRow=(id:string,e:{shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean})=>{
    const ids=mvrItems.map(item=>item.id);
    if(e.shiftKey&&patchSelectionAnchor){
      const a=ids.indexOf(patchSelectionAnchor);
      const b=ids.indexOf(id);
      if(a>=0&&b>=0){
        const [from,to]=a<b?[a,b]:[b,a];
        setPatchSelection(ids.slice(from,to+1));
      }else{
        setPatchSelection([id]);
      }
    }else if(e.ctrlKey||e.metaKey){
      const next=selectedPatchIds.includes(id)?selectedPatchIds.filter(x=>x!==id):[...selectedPatchIds,id];
      setPatchSelection(next.length?next:[id]);
      setPatchSelectionAnchor(id);
    }else{
      setPatchSelection([id]);
      setPatchSelectionAnchor(id);
    }
    const item=mvrItems.find(x=>x.id===id);
    if(item)setUniverseView(item.universe);
  };

  const addressFromPointer=(x:number,y:number)=>{
    const grid=universeGridRef.current;
    if(!grid)return;
    const rect=grid.getBoundingClientRect();
    if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return;
    const col=Math.max(0,Math.min(31,Math.floor((x-rect.left+grid.scrollLeft)/(grid.scrollWidth/32))));
    const row=Math.max(0,Math.min(15,Math.floor((y-rect.top+grid.scrollTop)/25)));
    return row*32+col+1;
  };

  const movePatchGroup=(ids:string[],targetUniverse:number,targetAddress:number)=>{
    const draggedItem=mvrItems.find(x=>x.id===ids[ids.length-1]);
    if(!draggedItem)return;
    const delta=targetAddress-draggedItem.address;
    const idSet=new Set(ids);
    setMvrItems(items=>items.map(item=>{
      if(!idSet.has(item.id))return item;
      const footprint=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
      const sameUniverse=item.universe===draggedItem.universe;
      let universe=sameUniverse?targetUniverse:item.universe;
      let address=Math.max(1,Math.min(512,item.address+delta));
      if(address+footprint-1>512&&universe<256){
        universe+=1;
        address=1;
      }
      return {...item,universe,address};
    }));
    setSelectedPatch(ids[ids.length-1]);
  };

  const startPatchDrag=(id:string,e:React.PointerEvent<HTMLDivElement>)=>{
    e.preventDefault();
    e.stopPropagation();
    const draggedIds=selectedPatchIds.includes(id)?selectedPatchIds:[id];
    setPatchSelection(draggedIds);
    setPatchSelectionAnchor(id);
    setSelectedPatch(id);
    const draggedItem=mvrItems.find(x=>x.id===id);
    if(!draggedItem)return;
    const startAddress=draggedItem.address;
    const origins=draggedIds.map(did=>{
      const item=mvrItems.find(x=>x.id===did);
      return item?{id:did,address:item.address,universe:item.universe}:null;
    }).filter(Boolean) as {id:string;address:number;universe:number}[];
    const move=(ev:PointerEvent)=>{
      const addr=addressFromPointer(ev.clientX,ev.clientY);
      if(!addr)return;
      const delta=addr-startAddress;
      setMvrItems(items=>items.map(item=>{
        const origin=origins.find(o=>o.id===item.id);
        if(!origin)return item;
        const newAddress=Math.max(1,Math.min(512,origin.address+delta));
        const footprint=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
        let universe=origin.universe;
        let finalAddress=newAddress;
        if(newAddress+footprint-1>512&&universe<256){
          universe+=1;
          finalAddress=1;
        }else if(newAddress<1&&universe>1){
          universe-=1;
          finalAddress=512-footprint+1;
        }
        return {...item,universe,address:finalAddress};
      }));
    };
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    move(e.nativeEvent);
  };

 const sortFixtureTo=(targetId:string)=>{
   if(!dragFixtureId||dragFixtureId===targetId)return;
   const from=fixtures.findIndex(f=>f.id===dragFixtureId);
   const to=fixtures.findIndex(f=>f.id===targetId);
   if(from<0||to<0)return;
   setFixtures(arrayMove(fixtures,from,to));
   setDragFixtureId(undefined);
 };
  const openModeEditor=()=>{
    if(!active)return;
    setEditingModeId(active.modes[0]?.id||'');
    setEditingModeName(active.modes[0]?.name||'');
    setModeEditorOpen(true);
  };
  const addMode=()=>{
    if(!active)return;
    const newMode={id:uid(),name:'NewMode',channels:[]};
    patch(f=>f.modes.push(newMode));
    selectMode(newMode.id);
    setEditingModeId(newMode.id);
    setEditingModeName(newMode.name);
  };
  const removeMode=(id:string)=>{
    if(!active||active.modes.length<=1)return;
    const idx=active.modes.findIndex(m=>m.id===id);
    patch(f=>{f.modes=f.modes.filter(m=>m.id!==id)});
    if(modeId===id){
      const remaining=active.modes.filter(m=>m.id!==id);
      selectMode(remaining[Math.min(idx,remaining.length-1)]?.id||'');
    }
  };
  const renameMode=(id=editingModeId)=>{
    const name=editingModeName.trim();
    if(!active||!id||!name)return;
    patch(f=>{const m=f.modes.find(x=>x.id===id);if(m)m.name=name});
    selectMode(id);
  };

  const openMvrImport=async(file:File)=>{
    try{
      const options=await api.previewMvr(file);
      setMvrImportFile(file);
      setMvrImportOptions(options);
      setMvrImportSelected(options.map(x=>x.index));
      setMvrImportOpen(true);
      if(!options.length)message.warning('这个 MVR 中没有可导入的 GDTF 灯具类型');
    }catch(e){
      message.error((e as Error).message);
    }
  };

  const confirmMvrImport=async()=>{
    if(!mvrImportFile)return;
    try{
      const imported=await api.importMvr(mvrImportFile,mvrImportSelected);
      setFixtures([...fixtures,...imported]);
      setMvrImportOpen(false);
      message.success(`已导入 ${imported.length} 个灯具类型到灯具库`);
    }catch(e){
      message.error((e as Error).message);
    }
  };

  const generateMvr=async()=>{
    try{
      await downloadMvr({sceneName,items:mvrItems});
      message.success('MVR 文件已生成，包含 Fixture、Universe 与起始地址');
    }catch(e){
      message.error((e as Error).message);
    }
  };
  const clearMvrDraft=()=>{
    setMvrItems([]);
    setSelectedPatch(undefined);
    setSelectedPatchIds([]);
    setPatchSelectionAnchor(undefined);
    setEditingPatchId(undefined);
    setUniverseView(1);
    localStorage.removeItem('fixture-forge:mvr-draft');
    message.success('已清除 MVR 配接草稿');
  };

  const universeBars=useMemo(()=>mvrItems.filter(item=>item.universe===universeView).flatMap(item=>{
    const footprint=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
    const end=Math.min(512,item.address+footprint-1);
    const segments:{item:MvrItem;row:number;col:number;span:number;start:number;end:number}[]=[];
    for(let ch=item.address;ch<=end;){
      const row=Math.floor((ch-1)/32)+1;
      const col=((ch-1)%32)+1;
      const rowEnd=Math.min(end,row*32);
      segments.push({item,row,col,span:rowEnd-ch+1,start:ch,end:rowEnd});
      ch=rowEnd+1;
    }
    return segments;
  }),[mvrItems,fixtureById,universeView]);
  const occupiedUniverseChannels=useMemo(()=>{
    const used=new Set<number>();
    mvrItems.filter(item=>item.universe===universeView).forEach(item=>{
      const footprint=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
      const end=Math.min(512,item.address+footprint-1);
      for(let ch=item.address;ch<=end;ch++)used.add(ch);
    });
    return used;
  },[mvrItems,fixtureById,universeView]);

  if(!catalog)return <div className="loading">正在加载灯具工作台…</div>;

  return <div className={`shell ${workspace==='mvr'?'mvr-mode':''}`}>
    <div className="workspace-switch">
      <Button type={workspace==='fixture'?'primary':'default'} onClick={()=>setWorkspace('fixture')}>灯具制作</Button>
      <Button type={workspace==='mvr'?'primary':'default'} onClick={()=>setWorkspace('mvr')}>UE 导入文件生成</Button>
    </div>

    <header>
      <div className="brand"><ApartmentOutlined/> Fixture Forge <span>灯具工坊</span></div>
      <div className="current">当前灯具 <strong>{active?.name||'未选择'}</strong>{dirty&&<Tag color="gold">{fixtures.some(x=>x.id===active?.id)?'等待自动保存':'本地草稿'}</Tag>}{!dirty&&autoSaveState==='saved'&&<Tag color="green">已自动保存</Tag>}{autoSaveState==='error'&&<Tag color="red">自动保存失败</Tag>}</div>
      <div className="toolbar">
        <input ref={fileRef} hidden type="file" accept=".xml,.gdtf" onChange={e=>e.target.files?.[0]&&importFile(e.target.files[0])}/>
        <input ref={mvrFileRef} hidden type="file" accept=".mvr" onChange={e=>e.target.files?.[0]&&openMvrImport(e.target.files[0])}/>
        {workspace==='fixture'?<>
          <Button icon={<UploadOutlined/>} onClick={()=>fileRef.current?.click()}>导入</Button>
          <Button icon={<UploadOutlined/>} onClick={()=>mvrFileRef.current?.click()}>导入 MVR</Button>
          <Button icon={<DownloadOutlined/>} disabled={!active||dirty} onClick={()=>download(`/api/export/ma2/${active!.id}`)}>导出 MA2</Button>
          <Button icon={<DownloadOutlined/>} disabled={!active||dirty} onClick={()=>download(`/api/export/gdtf/${active!.id}`)}>导出 GDTF</Button>
          <Button type="primary" icon={<SaveOutlined/>} disabled={!active} onClick={save}>保存</Button>
        </>:<>
          <Input className="mvr-filename" value={sceneName} onChange={e=>setSceneName(e.target.value)}/>
          <Popconfirm title="清除当前 MVR 草稿？" description="会清空所有配接规划，但不会删除灯具库。" onConfirm={clearMvrDraft} okText="清除" cancelText="取消">
            <Button danger icon={<DeleteOutlined/>} disabled={!mvrItems.length}>清除</Button>
          </Popconfirm>
          <Button type="primary" icon={<DownloadOutlined/>} disabled={!mvrItems.length} onClick={generateMvr}>生成 MVR</Button>
        </>}
      </div>
    </header>

    <aside className="left">
      <div className="side-title">灯具库 <Button size="small" type="text" icon={<PlusOutlined/>} onClick={addFixture}/></div>
      <Input prefix={<SearchOutlined/>} value={libraryQuery} onChange={e=>setLibraryQuery(e.target.value)} placeholder="搜索灯具或公司…"/>
      <div className="fixture-list">
        {library.map(f=>{
          const count=Math.max(0,...f.modes.map(modeFootprint));
          return <div key={f.id} draggable title={workspace==='mvr'?'拖入右侧 MVR 场景':'拖拽排序'}
            onDragStart={e=>{if(workspace==='mvr'){e.dataTransfer.setData('text/fixture-id',f.id);e.dataTransfer.effectAllowed='copy'}else{setDragFixtureId(f.id);e.dataTransfer.setData('text/fixture-sort-id',f.id);e.dataTransfer.effectAllowed='move'}}}
            onDragOver={e=>workspace==='fixture'&&e.preventDefault()}
            onDrop={e=>{if(workspace==='fixture'){e.preventDefault();sortFixtureTo(f.id)}}}
            className={`fixture-card ${f.id===active?.id&&workspace==='fixture'?'active':''}`}
            onClick={()=>workspace==='mvr'?openAddPatch(f.id):select(f)}>
            <span>{f.manufacturer.name}</span>
            <strong>{f.name}</strong>
            <Tag color="blue">{count} CH</Tag>
            {workspace==='fixture'&&<Popconfirm title="确认删除此灯具？" description="此操作无法撤销" onConfirm={()=>removeFixture(f.id)}>
              <Button className="fixture-delete" danger size="small" type="text" icon={<DeleteOutlined/>} onClick={e=>e.stopPropagation()}/>
            </Popconfirm>}
          </div>;
        })}
      </div>
    </aside>

    {workspace==='mvr'&&<div className="mvr-overlay" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect=e.dataTransfer.types.includes('text/patch-id')?'move':'copy'}} onDrop={e=>{e.preventDefault();if(e.dataTransfer.getData('text/patch-id'))return;const id=e.dataTransfer.getData('text/fixture-id');if(id)openAddPatch(id)}}>
      <section className="mvr-main dmxlib">
        <div className="dmxlib-top">
          <div><h2>UE DMX Library · 灯具配接</h2><p>左侧灯具库可点击或拖入；拖动 Universe 条可调整起始通道；生成 MVR 会写入 Fixture Type 与地址。</p></div>
          <Tag color="green">{mvrItems.length} 个配接规划</Tag>
        </div>
        <div className="dmxlib-body">
          <div className="patch-panel">
            <div className="patch-toolbar"><Button type="primary" icon={<PlusOutlined/>} disabled={!fixtures.length} onClick={()=>openAddPatch()}>添加Fixture</Button><Input prefix={<SearchOutlined/>} placeholder="搜索配接…"/></div>
            <div className="patch-table">
              <div className="patch-row header"><span>灯具配接</span><span>FID</span><span>灯具类型</span><span>模式</span><span>配接</span><span></span></div>
              {mvrItems.map(item=>{
                const f=fixtureById.get(item.fixtureId);
                if(!f)return null;
                const editing=editingPatchId===item.id;
                return <div key={item.id} className={`patch-row ${selectedPatchIds.includes(item.id)?'selected':''} ${editing?'editing':''}`} onClick={e=>selectPatchRow(item.id,e)} onDoubleClick={e=>{e.stopPropagation();setPatchSelection([item.id]);setPatchSelectionAnchor(item.id);setEditingPatchId(item.id);setSelectedPatch(item.id);setUniverseView(item.universe)}}>
                  {editing?<Input autoFocus value={item.name} onChange={e=>patchMvrItem(item.id,{name:e.target.value})}/>:<span className="patch-cell-name">{item.name}</span>}
                  {editing?<InputNumber min={1} value={item.fid} onChange={v=>patchMvrItem(item.id,{fid:v||1})}/>:<span>{item.fid}</span>}
                  {editing?<Select value={item.fixtureId} onChange={v=>{const nf=fixtureById.get(v)!;patchMvrItem(item.id,{fixtureId:v,modeName:nf.modes[0]?.name||'Profile'})}} options={fixtures.map(x=>({value:x.id,label:x.name}))}/>:<span className="patch-cell-name">{f.name}</span>}
                  {editing?<Select value={item.modeName} onChange={v=>patchMvrItem(item.id,{modeName:v})} options={f.modes.map(m=>({value:m.name,label:m.name}))}/>:<span>{item.modeName}</span>}
                  <span>{item.universe}.{item.address}</span>
                  <Button danger type="text" icon={<DeleteOutlined/>} onClick={e=>{e.stopPropagation();deleteMvrItems(selectedPatchIds.includes(item.id)?selectedPatchIds:[item.id])}}/>
                </div>;
              })}
              {!mvrItems.length&&<Empty description="从左侧灯具库拖入或点击添加 Fixture"/>}
            </div>
          </div>
         <div className="universe-panel">
            <div className="universe-head"><span>本地 Universe</span><Button size="small" disabled={universeView<=1} onClick={()=>setUniverseView(Math.max(1,universeView-1))}>上一域</Button><InputNumber min={1} max={256} value={universeView} onChange={v=>setUniverseView(Math.max(1,Math.min(256,v||1)))}/><span>/ 256</span><Button size="small" disabled={universeView>=256} onClick={()=>setUniverseView(Math.min(256,universeView+1))}>下一域</Button><Checkbox>只显示冲突</Checkbox><Checkbox>显示所有带配接的域</Checkbox></div>
            <div ref={universeGridRef} className="universe-grid">
              {Array.from({length:512},(_,i)=>i+1).map(ch=><div key={ch} data-channel={ch} className={`universe-cell ${occupiedUniverseChannels.has(ch)?'occupied':''}`} title={`CH ${ch}`} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}} onDrop={e=>{e.preventDefault();e.stopPropagation();const id=e.dataTransfer.getData('text/patch-id');if(id){const ids=selectedPatchIds.includes(id)?selectedPatchIds:[id];movePatchGroup(ids,universeView,ch)}}}><span>{ch}</span></div>)}
              {universeBars.map(seg=><div key={`${seg.item.id}-${seg.start}`} className={`universe-bar ${selectedPatchIds.includes(seg.item.id)?'selected':''}`} style={{left:`calc(${seg.col-1} * 100% / 32)`,top:`calc(${seg.row-1} * var(--dmx-cell-h))`,width:`calc(${seg.span} * 100% / 32)`,backgroundColor:seg.item.color}} title={`${seg.item.name} · ${seg.start}-${seg.end}`} onClick={e=>{e.stopPropagation();selectPatchRow(seg.item.id,e)}} onPointerDown={e=>startPatchDrag(seg.item.id,e)}><b>{seg.start===seg.item.address?seg.item.name:''}</b></div>)}
            </div>
          </div>
        </div>
      </section>
      <aside className="mvr-inspector">
        <div className="panel-title"><span>配接详情</span><SettingOutlined/></div>
        {selectedMvrItem?(()=>{
          const f=fixtureById.get(selectedMvrItem.fixtureId);
          if(!f)return <Empty description="灯具类型不存在"/>;
          return <>
            <div className="selected-name">{selectedMvrItem.name}</div>
            <label>灯具名称<Input value={selectedMvrItem.name} onChange={e=>patchMvrItem(selectedMvrItem.id,{name:e.target.value})}/></label>
            <label>Fixture 类型<Select value={selectedMvrItem.fixtureId} onChange={v=>{const nf=fixtures.find(x=>x.id===v)!;patchMvrItem(selectedMvrItem.id,{fixtureId:v,modeName:nf.modes[0]?.name||'Profile'})}} options={fixtures.map(x=>({value:x.id,label:`${x.manufacturer.name} · ${x.name}`}))}/></label>
            <label>模式<Select value={selectedMvrItem.modeName} onChange={v=>patchMvrItem(selectedMvrItem.id,{modeName:v})} options={f.modes.map(m=>({value:m.name,label:`${m.name} · ${fixtureFootprint(f,m.name)} CH`}))}/></label>
            <div className="two"><label>FID<InputNumber min={1} value={selectedMvrItem.fid} onChange={v=>patchMvrItem(selectedMvrItem.id,{fid:v||1})}/></label><label>Universe<InputNumber min={1} max={256} value={selectedMvrItem.universe} onChange={v=>{const universe=Math.max(1,Math.min(256,v||1));patchMvrItem(selectedMvrItem.id,{universe});setUniverseView(universe)}}/></label></div>
            <div className="two"><label>起始通道<InputNumber min={1} max={512} value={selectedMvrItem.address} onChange={v=>patchMvrItem(selectedMvrItem.id,{address:v||1})}/></label><label>编辑器颜色<Input type="color" value={selectedMvrItem.color} onChange={e=>patchMvrItem(selectedMvrItem.id,{color:e.target.value})}/></label></div>
            <Divider/><Tag color="blue">{fixtureFootprint(f,selectedMvrItem.modeName)} CH</Tag>
          </>;
        })():<Empty description="请选择一个配接"/>}
      </aside>
    </div>}

    {workspace==='fixture'&&<main>
      <section className="meta">
        <label>灯具名称<Input value={active?.name} onChange={e=>patch(f=>{f.name=e.target.value;f.shortName=defaultPatchPrefix(f)})}/></label>
        <label>公司<Input value={active?.manufacturer.name} onChange={e=>patch(f=>{f.manufacturer.name=e.target.value})}/></label>
        <label className="mode-field"><span>灯具模式</span><div className="mode-field-row"><Select value={modeId} onChange={selectMode} options={active?.modes.map(m=>({value:m.id,label:`${m.name} · ${modeFootprint(m)} CH`}))}/><Button size="small" icon={<SettingOutlined/>} onClick={openModeEditor}/></div></label>
        <div><span>DMX 通道数</span><strong>{modeFootprint(mode)} CH</strong></div>
        <div><span>UE 兼容性</span><strong className="ok">UE 5.7+</strong></div>
      </section>
      <section className="editor-head"><div><b>通道编辑器</b><small> MA FeatureGroup → Attribute 分级选择</small></div><Button icon={<SettingOutlined/>} onClick={()=>setManagerOpen(true)}>MA 属性管理</Button><Button type="primary" ghost icon={<PlusOutlined/>} onClick={addChannel}>添加通道</Button><Input prefix={<SearchOutlined/>} placeholder="搜索通道…" value={query} onChange={e=>setQuery(e.target.value)}/></section>
      <section className="table-wrap">
        <table><thead><tr><th></th><th>CH</th><th>MA 属性</th><th>自定义名称</th><th>分辨率</th><th>默认值</th><th>DMX 范围</th><th>属性族</th><th>操作</th></tr></thead><tbody>
          {shown.map(ch=><tr key={ch.id} className={ch.id===channelId?'selected':''} onClick={()=>selectChannel(ch.id)}>
            <td><HolderOutlined/></td><td>{ch.address}</td>
            <td><Select popupMatchSelectWidth={380} showSearch optionFilterProp="label" value={ch.attribute} onChange={v=>{const a=catalog.attributes.find(x=>x.id===v)!;patchChannelById(ch.id,{attribute:v,group:a.maFeature,name:a.ueAttribute,ueAttribute:a.ueAttribute})}} options={attributeOptions(catalog)}/></td>
            <td><Input value={ch.name} onChange={e=>patchChannelById(ch.id,{name:e.target.value.replace(/[^A-Za-z0-9 _.-]/g,'')})}/></td>
            <td><Select value={ch.resolution} onChange={(v:Resolution)=>patchChannelById(ch.id,{resolution:v})} options={[8,16,24,32].map(v=>({value:v,label:`${v} bit`}))}/></td>
            <td><InputNumber min={0} value={ch.defaultValue} onChange={v=>patchChannelById(ch.id,{defaultValue:v||0})}/></td>
            <td>0 – {Math.pow(2,ch.resolution)-1}</td><td><Tag color="blue">{ch.group}</Tag></td>
            <td><Tooltip title="复制"><Button type="text" icon={<CopyOutlined/>} onClick={e=>{e.stopPropagation();copyChannel(ch.id)}}/></Tooltip><Popconfirm title="删除此通道？" onConfirm={()=>removeChannel(ch.id)}><Button danger type="text" icon={<DeleteOutlined/>} onClick={e=>e.stopPropagation()}/></Popconfirm></td>
          </tr>)}
        </tbody></table>
        {!shown.length&&<Empty description="暂无通道"/>}
      </section>
    </main>}

    {workspace==='fixture'&&<aside className="right">
      <div className="panel-title"><span>通道属性</span><SettingOutlined/></div>
      {channel?<>
        <div className="selected-name">通道 {channel.address} · {channel.name}</div>
        <label>自定义名称（英文输出）<Input value={channel.name} onChange={e=>patchChannelById(channel.id,{name:e.target.value.replace(/[^A-Za-z0-9 _.-]/g,'')})}/></label>
        <label>MA 属性（中文仅显示）<Select showSearch optionFilterProp="label" value={channel.attribute} onChange={v=>{const a=catalog.attributes.find(x=>x.id===v)!;patchChannelById(channel.id,{attribute:v,group:a.maFeature,name:a.ueAttribute,ueAttribute:a.ueAttribute})}} options={attributeOptions(catalog)}/></label>
        <label>分辨率<Select value={channel.resolution} onChange={(v:Resolution)=>patchChannelById(channel.id,{resolution:v})} options={[8,16,24,32].map(v=>({value:v,label:`${v} bit`}))}/></label>
        <label>字节顺序<Select value={channel.byteOrder} onChange={v=>patchChannelById(channel.id,{byteOrder:v})} options={[{value:'MSB',label:'MSB（高位优先）'},{value:'LSB',label:'LSB（低位优先）'}]}/></label>
        <div className="two"><label>默认值<InputNumber value={channel.defaultValue} onChange={v=>patchChannelById(channel.id,{defaultValue:v||0})}/></label><label>高亮值<InputNumber value={channel.highlightValue} onChange={v=>patchChannelById(channel.id,{highlightValue:v||0})}/></label></div>
        <Divider/><div className="panel-title"><span>物理范围</span><Switch checkedChildren="反向" unCheckedChildren="正常" checked={channel.inverted} onChange={v=>patchChannelById(channel.id,{inverted:v})}/></div>
        <div className="two"><label>最小值<InputNumber value={channel.physicalFrom} onChange={v=>patchChannelById(channel.id,{physicalFrom:v||0})}/></label><label>最大值<InputNumber value={channel.physicalTo} onChange={v=>patchChannelById(channel.id,{physicalTo:v||0})}/></label></div>
        <label>UE 属性（英文输出）<Input value={channel.ueAttribute} onChange={e=>patchChannelById(channel.id,{ueAttribute:e.target.value.replace(/[^A-Za-z0-9 _.-]/g,'')})}/></label>
      </>:<Empty description="请选择一个通道"/>}
    </aside>}

    <Modal width={760} title="MA 属性管理" open={managerOpen} onCancel={()=>setManagerOpen(false)} footer={<Button onClick={()=>setManagerOpen(false)}>关闭</Button>}>
      <div className="attribute-manager"><div className="manager-head"><span>标准属性只读；自定义属性可编辑或删除。</span><Button type="primary" icon={<PlusOutlined/>} onClick={()=>openAttributeEditor()}>添加自定义属性</Button></div>{catalog.groups.map(g=><section key={g.id}><h4>{g.id} <small>{g.nameZh}</small></h4>{catalog.attributes.filter(a=>a.maFeature===g.id).map(a=><div className="attribute-row" key={a.id}><code>{a.id}</code><span>{a.nameZh}</span><span>{a.ueAttribute}</span>{a.custom?<div><Button size="small" onClick={()=>openAttributeEditor(a)}>编辑</Button><Popconfirm title="删除此自定义属性？" onConfirm={()=>removeCustomAttribute(a.id)}><Button size="small" danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm></div>:<Tag>MA 内置</Tag>}</div>)}</section>)}</div>
   </Modal>
    <Modal width={460} title="灯具模式管理" open={modeEditorOpen} onCancel={()=>setModeEditorOpen(false)} footer={<Button onClick={()=>setModeEditorOpen(false)}>关闭</Button>}>
      <div className="mode-editor">{active?.modes.map(m=><div key={m.id} className={`mode-row ${m.id===editingModeId?'active':''}`} onClick={()=>{setEditingModeId(m.id);setEditingModeName(m.name)}}>
        <Input value={editingModeId===m.id?editingModeName:m.name} onFocus={()=>{setEditingModeId(m.id);setEditingModeName(m.name)}} onChange={e=>{setEditingModeId(m.id);setEditingModeName(e.target.value)}} onPressEnter={()=>renameMode(m.id)}/>
        <Tag color="blue">{modeFootprint(m)} CH</Tag>
        <Button size="small" type={editingModeId===m.id?'primary':'default'} onClick={e=>{e.stopPropagation();renameMode(m.id)}}>重命名</Button>
        <Popconfirm title={`删除模式「${m.name}」?`} description="此操作无法撤销" onConfirm={()=>removeMode(m.id)}><Button size="small" danger icon={<DeleteOutlined/>} disabled={active.modes.length<=1}/></Popconfirm>
      </div>)}<Button type="dashed" block icon={<PlusOutlined/>} onClick={addMode} style={{marginTop:8}}>添加模式</Button></div>
    </Modal>

    <Modal title={editingId?'编辑自定义属性':'添加自定义属性'} open={editorOpen} onCancel={()=>setEditorOpen(false)} onOk={saveCustomAttribute} okText="保存属性" cancelText="取消">
      <div className="custom-form"><label>英文输出标识<Input disabled={!!editingId} placeholder="例如 LASER_PATTERN_X" value={custom.id} onChange={e=>setCustom({...custom,id:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'_')})}/></label><label>中文显示名称<Input placeholder="例如 激光图案X" value={custom.nameZh} onChange={e=>setCustom({...custom,nameZh:e.target.value})}/></label><label>UE 英文输出名称<Input placeholder="例如 Laser Pattern X" value={custom.ueAttribute} onChange={e=>{const value=e.target.value.replace(/[^A-Za-z0-9 _.-]/g,'');setCustom({...custom,ueAttribute:value,id:custom.id||value.toUpperCase().replace(/[^A-Z0-9]+/g,'_')})}}/></label><label>MA 属性簇<Select value={custom.maFeature} onChange={v=>setCustom({...custom,maFeature:v})} options={catalog.groups.map(g=>({value:g.id,label:`${g.id} / ${g.nameZh}`}))}/></label></div>
    </Modal>

    <Modal width={620} title="添加灯具配接" open={addPatchOpen} onCancel={()=>setAddPatchOpen(false)} onOk={confirmAddPatch} okText={`添加${addPatch.quantity||1}个灯具配接`} cancelText="取消">
      {(()=>{
        const fixture=fixtures.find(x=>x.id===addPatch.fixtureId);
        const footprint=fixtureFootprint(fixture,addPatch.modeName);
        return <div className="add-patch-form"><label>灯具类型<Select value={addPatch.fixtureId} onChange={v=>{const f=fixtures.find(x=>x.id===v)!;const universe=addPatch.universe;setAddPatch({...addPatch,fixtureId:v,modeName:f.modes[0]?.name||'Profile',prefix:defaultPatchPrefix(f),address:nextPatchAddress(universe)})}} options={fixtures.map(x=>({value:x.id,label:`${x.manufacturer.name} · ${x.name}`}))}/></label><label>模式<Select value={addPatch.modeName} onChange={v=>setAddPatch({...addPatch,modeName:v})} options={(fixture?.modes||[]).map(m=>({value:m.name,label:`${m.name} · ${fixtureFootprint(fixture,m.name)} CH`}))}/></label><div className="two"><label>命名前缀<Input value={addPatch.prefix} onChange={e=>setAddPatch({...addPatch,prefix:e.target.value.replace(/[^A-Za-z0-9_ -]/g,'')})}/></label><label>配接数量<InputNumber min={1} max={512} value={addPatch.quantity} onChange={v=>setAddPatch({...addPatch,quantity:v||1})}/></label></div><div className="name-preview">自动命名预览：{patchName(addPatch.prefix,1)}{(addPatch.quantity||1)>1?`、${patchName(addPatch.prefix,2)} …`:''}</div><div className="two"><label>Universe<InputNumber min={1} max={256} value={addPatch.universe} onChange={v=>{const universe=Math.max(1,Math.min(256,v||1));setAddPatch({...addPatch,universe,address:nextPatchAddress(universe)})}}/></label><label>起始通道<InputNumber min={1} max={512} value={addPatch.address} onChange={v=>setAddPatch({...addPatch,address:v||1})}/></label></div><Checkbox checked={addPatch.increment} onChange={e=>setAddPatch({...addPatch,increment:e.target.checked})}>配接后地址自动递增</Checkbox><Tag color="blue">{footprint} CH</Tag></div>;
      })()}
    </Modal>

    <Modal width={780} title="导入 MVR 灯具库" open={mvrImportOpen} onCancel={()=>setMvrImportOpen(false)} onOk={confirmMvrImport} okText="导入选中灯具" cancelText="取消" okButtonProps={{disabled:!mvrImportSelected.length}}>
      <div className="mvr-import"><div className="manager-head"><span>只导入 MVR 内嵌 GDTF 的 Fixture Type；不导入 Fixture Patch、Universe、地址或数量。</span><Checkbox checked={mvrImportSelected.length===mvrImportOptions.length&&mvrImportOptions.length>0} indeterminate={mvrImportSelected.length>0&&mvrImportSelected.length<mvrImportOptions.length} onChange={e=>setMvrImportSelected(e.target.checked?mvrImportOptions.map(x=>x.index):[])}>全选</Checkbox></div>{mvrImportOptions.map(option=><label className="mvr-import-row" key={option.key}><Checkbox checked={mvrImportSelected.includes(option.index)} onChange={e=>setMvrImportSelected(e.target.checked?[...mvrImportSelected,option.index]:mvrImportSelected.filter(x=>x!==option.index))}/><div><strong>{option.name}</strong><span>{option.manufacturer}</span></div><Tag color="blue">{option.footprint} CH</Tag><Tag>{option.modes.length} 个模式</Tag><code>{option.key}</code></label>)}{!mvrImportOptions.length&&<Empty description="未找到可导入的灯具类型"/>}</div>
    </Modal>

    <footer><div className={validation.valid?'valid':'invalid'}>{validation.valid?<CheckCircleOutlined/>:<WarningOutlined/>} {validation.valid?'无通道冲突':`${validation.issues.length} 个问题`}</div><div><Tag color={validation.valid?'green':'red'}>MA2 XML</Tag><Tag color={validation.valid?'green':'red'}>MA3 / GDTF</Tag><Tag color={validation.valid?'green':'red'}>UE 5.7+</Tag></div><div>{validation.issues[0]?.message||`${mode?.channels.length||0} 个逻辑通道`}</div></footer>
  </div>;
}

export default function App(){
  return <AntApp><Workbench/></AntApp>;
}
