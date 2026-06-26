import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {App as AntApp,Button,Checkbox,Divider,Empty,Input,InputNumber,Modal,Popconfirm,Radio,Select,Switch,Tag,Tooltip} from 'antd';
import {ApartmentOutlined,CheckCircleOutlined,CloseCircleOutlined,CopyOutlined,DeleteOutlined,DownloadOutlined,HolderOutlined,PlusOutlined,RedoOutlined,ReloadOutlined,SaveOutlined,SearchOutlined,SettingOutlined,ThunderboltOutlined,UndoOutlined,UploadOutlined,WarningOutlined} from '@ant-design/icons';
import {arrayMove} from '@dnd-kit/sortable';
import {api,download,downloadMa2Patch,downloadMvr} from './api';
import {draft} from './draft';
import {useStore} from './store';
import {useUndo} from './undo';
import {compactModeAddresses,modeFootprint,removeChannelAndCompact} from './model';
import type {AttributeDef,Catalog,DmxChannel,FixtureDocument,Ma2ImportMode,Ma2Device,MvrImportOption,MvrItem,PushResult,Resolution} from './types';

const uid=()=>{
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues){
    const bytes=new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6]=(bytes[6]&0x0f)|0x40;
    bytes[8]=(bytes[8]&0x3f)|0x80;
    const hex=[...bytes].map(x=>x.toString(16).padStart(2,'0'));
    return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
};
const patchColors=['#18d5e8','#75e900','#2820bb','#ffb000','#d44aff','#ff4d4f','#00b578','#4096ff'];
const UNIVERSE_COUNT=256;
const UNIVERSE_SECTION_HEIGHT=568;
const rgba=(hex:string,alpha:number)=>{
  const value=hex.replace('#','');
  if(value.length!==6)return hex;
  const n=parseInt(value,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
};

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
  highlightValue:100,
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
  const [showAllUniverses]=useState(true);
  const [universeScrollTop,setUniverseScrollTop]=useState(0);
  const [mvrDraftReady,setMvrDraftReady]=useState(false);
 const [dragFixtureId,setDragFixtureId]=useState<string>();
 const [addPatchOpen,setAddPatchOpen]=useState(false);
  const [addPatch,setAddPatch]=useState({fixtureId:'',modeName:'',prefix:'Fixture',universe:1,address:1,quantity:1,increment:true});
  const [mvrImportFile,setMvrImportFile]=useState<File>();
  const [mvrImportOptions,setMvrImportOptions]=useState<MvrImportOption[]>([]);
  const [mvrImportSelected,setMvrImportSelected]=useState<number[]>([]);
 const [mvrImportOpen,setMvrImportOpen]=useState(false);
  const [ma2Open,setMa2Open]=useState(false);
  const [ma2Devices,setMa2Devices]=useState<Ma2Device[]>([]);
  const [ma2Selected,setMa2Selected]=useState('127.0.0.1');
  const [ma2Port,setMa2Port]=useState(30000);
  const [ma2Username,setMa2Username]=useState('administrator');
  const [ma2Password,setMa2Password]=useState('admin');
  const [ma2Scanning,setMa2Scanning]=useState(false);
  const [ma2Testing,setMa2Testing]=useState(false);
  const [ma2Importing,setMa2Importing]=useState(false);
  const [ma2Result,setMa2Result]=useState<PushResult>();
  const [ma2LogOpen,setMa2LogOpen]=useState(false);
  const [ma2Mode,setMa2Mode]=useState<Ma2ImportMode>('all');
  // ---- Undo/Redo for MVR items ----
  const mvrUndo = useUndo<MvrItem[]>();

  const pushMvrHistory = useCallback((items: MvrItem[], desc: string) => {
    mvrUndo.push(items, desc);
  }, [mvrUndo]);

  const applyMvrSnapshot = useCallback((snapshot: MvrItem[] | null) => {
    if (!snapshot) return;
    setMvrItems(snapshot);
    // Clean up selections that no longer exist
    const valid = new Set(snapshot.map(item => item.id));
    setSelectedPatchIds(ids => ids.filter(id => valid.has(id)));
    if (selectedPatch && !valid.has(selectedPatch)) setSelectedPatch(undefined);
    if (editingPatchId && !valid.has(editingPatchId)) setEditingPatchId(undefined);
  }, [selectedPatch, editingPatchId]);

  const handleMvrUndo = useCallback(() => {
    const snap = mvrUndo.undo();
    if (snap) { applyMvrSnapshot(snap); message.info(`已撤销：${mvrUndo.lastDescription}`); }
  }, [mvrUndo, applyMvrSnapshot, message]);

  const handleMvrRedo = useCallback(() => {
    const snap = mvrUndo.redo();
    if (snap) { applyMvrSnapshot(snap); message.info(`已重做：${mvrUndo.lastDescription}`); }
  }, [mvrUndo, applyMvrSnapshot, message]);

  // Ctrl+Z / Ctrl+Y keyboard shortcut for MVR workspace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (workspace !== 'mvr') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input,textarea,[contenteditable="true"],.ant-select-dropdown')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleMvrUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleMvrRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace, handleMvrUndo, handleMvrRedo]);

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
  const universeScrollRef=useRef<HTMLDivElement>(null);
  const scrollDrivenUniverseRef=useRef(false);

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
  const clearPatchSelection=()=>{
    setSelectedPatchIds([]);
    setSelectedPatch(undefined);
    setPatchSelectionAnchor(undefined);
    setEditingPatchId(undefined);
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
      const nextItems=mvrItems.filter(item=>!doomed.has(item.id));
      pushMvrHistory(mvrItems, `删除 ${doomed.size} 个配接`);
      setMvrItems(nextItems);
      setSelectedPatch(undefined);
      setSelectedPatchIds([]);
      setEditingPatchId(undefined);
      message.success(`已删除 ${doomed.size} 个配接`);
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[workspace,selectedPatchIds,message,mvrItems,pushMvrHistory]);

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
    if(!showAllUniverses)return;
    if(scrollDrivenUniverseRef.current){
      scrollDrivenUniverseRef.current=false;
      return;
    }
    universeScrollRef.current?.scrollTo({top:(universeView-1)*UNIVERSE_SECTION_HEIGHT,behavior:'smooth'});
  },[showAllUniverses,universeView]);

  useEffect(()=>{
    if(!selectedMvrItem||selectedMvrItem.universe!==universeView)return;
    requestAnimationFrame(()=>{
      const root=showAllUniverses?universeScrollRef.current:universeGridRef.current;
      root?.querySelector(`[data-universe="${selectedMvrItem.universe}"] [data-channel="${selectedMvrItem.address}"], [data-channel="${selectedMvrItem.address}"]`)?.scrollIntoView({block:'nearest',inline:'center'});
    });
  },[selectedMvrItem?.id,selectedMvrItem?.address,selectedMvrItem?.universe,universeView,showAllUniverses]);

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

  const addFixture=async()=>{
    const f=emptyFixture();
    select(f);
    setActive(f,true);
    setAutoSaveState('saving');
    try{
      const saved=await api.create(f);
      setFixtures([...fixtures.filter(x=>x.id!==saved.id),saved]);
      setActive(saved,false);
      setAutoSaveState('saved');
      message.success('已添加新灯具，可继续编辑通道和参数');
    }catch(e){
      setAutoSaveState('error');
      message.error((e as Error).message);
    }
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
    if(!fixture){
      message.warning('请先在左侧灯具库点击 + 创建灯具，或导入已有灯具文件');
      return;
    }
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
    const nextItems=[...mvrItems,...created];
    pushMvrHistory(mvrItems, `添加 ${count} 个配接`);
    setMvrItems(nextItems);
    setSelectedPatchIds(created.map(item=>item.id));
    setSelectedPatch(created[created.length-1]?.id);
    setPatchSelectionAnchor(created[0]?.id);
    setUniverseView(created[0]?.universe||addPatch.universe);
    setAddPatchOpen(false);
  };

  const patchMvrItem=(id:string,p:Partial<MvrItem>)=>setMvrItems(items=>items.map(x=>x.id===id?{...x,...p}:x));

  // Track whether we've already pushed history for the current editing session
  const editHistoryRef = useRef(false);
  const patchMvrItemWithHistory=(id:string,p:Partial<MvrItem>,desc?:string)=>{
    if (!editHistoryRef.current) {
      pushMvrHistory(mvrItems, desc || `编辑配接属性`);
      editHistoryRef.current = true;
    }
    setMvrItems(items=>items.map(x=>x.id===id?{...x,...p}:x));
  };

  // Reset edit history tracking when editing patch changes
  useEffect(() => {
    if (!editingPatchId) editHistoryRef.current = false;
  }, [editingPatchId]);
  const sortedPatchIds=(ids:string[],items=mvrItems)=>{
    const wanted=new Set(ids);
    return items.filter(item=>wanted.has(item.id)).sort((a,b)=>(a.universe-b.universe)||(a.address-b.address)||(a.fid-b.fid)).map(item=>item.id);
  };
  const nextPatchPosition=(universe:number,address:number,footprint:number)=>{
    let nextUniverse=universe;
    let nextAddress=address+Math.max(1,footprint);
    while(nextAddress>512&&nextUniverse<UNIVERSE_COUNT){
      nextUniverse+=1;
      nextAddress-=512;
    }
    return {universe:nextUniverse,address:Math.max(1,Math.min(512,nextAddress))};
  };

  const deleteMvrItems=(ids:string[])=>{
    const doomed=new Set(ids);
    const nextItems=mvrItems.filter(item=>!doomed.has(item.id));
    pushMvrHistory(mvrItems, `删除 ${doomed.size} 个配接`);
    setMvrItems(nextItems);
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
    if(item){scrollDrivenUniverseRef.current=false;setUniverseView(item.universe);}
  };

  /** Dedicated patch row click: selection + direct universe scroll (no effect dependency) */
  /** Patch row click: navigation only (selection handled by onPointerDown for reliable ctrlKey) */
  const handlePatchRowClick=(id:string,e:React.MouseEvent)=>{
    e.stopPropagation();
    const ctrl=e.ctrlKey||e.metaKey;
    const shift=e.shiftKey;
    // Plain click without modifiers: select single item
    if(!ctrl&&!shift){
      setPatchSelection([id]);
      setPatchSelectionAnchor(id);
    }
    // Always navigate to the item's universe
    const item=mvrItems.find(x=>x.id===id);
    if(item){
      setUniverseView(item.universe);
      requestAnimationFrame(()=>{
        universeScrollRef.current?.scrollTo({top:(item.universe-1)*UNIVERSE_SECTION_HEIGHT,behavior:'smooth'});
      });
    }
  };

  /** Patch row pointerdown: capture ctrl/shift reliably at press time for multi-select */
  const handlePatchRowPointerDown=(id:string,e:React.PointerEvent)=>{
    e.preventDefault();
    const ctrl=e.ctrlKey||e.metaKey;
    const shift=e.shiftKey;
    if(ctrl){
      const next=selectedPatchIds.includes(id)?selectedPatchIds.filter(x=>x!==id):[...selectedPatchIds,id];
      setPatchSelection(next.length?next:[id]);
      setPatchSelectionAnchor(id);
    }else if(shift&&patchSelectionAnchor){
      const allIds=mvrItems.map(i=>i.id);
      const a=allIds.indexOf(patchSelectionAnchor);
      const b=allIds.indexOf(id);
      if(a>=0&&b>=0){
        const [from,to]=a<b?[a,b]:[b,a];
        setPatchSelection(allIds.slice(from,to+1));
      }
    }else{
      setPatchSelectionAnchor(id);
    }
  };

  const patchPositionFromPointer=(x:number,y:number)=>{
    const target=document.elementFromPoint(x,y) as HTMLElement|null;
    const section=target?.closest<HTMLElement>('[data-universe]');
    const grid=section?.querySelector('.universe-grid') as HTMLDivElement|null;
    if(!grid||!section)return;
    const rect=grid.getBoundingClientRect();
    if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return;
    const col=Math.max(0,Math.min(31,Math.floor((x-rect.left)/(grid.clientWidth/32))));
    const rowHeight=grid.clientHeight/16;
    const row=Math.max(0,Math.min(15,Math.floor((y-rect.top)/rowHeight)));
    return {universe:Math.max(1,Math.min(UNIVERSE_COUNT,Number(section?.dataset.universe)||universeView)),address:row*32+col+1};
  };

  const movePatchGroup=(ids:string[],targetUniverse:number,targetAddress:number,anchorId?:string)=>{
    const orderedIds=sortedPatchIds(ids);
    if(!orderedIds.length)return;
    setMvrItems(items=>{
      const byId=new Map(items.map(item=>[item.id,item]));
      // Calculate how many channels precede the anchor in the sorted group
      let offsetChannels=0;
      let foundAnchor=false;
      if(anchorId){
        for(const id of orderedIds){
          if(id===anchorId){foundAnchor=true;break;}
          const item=byId.get(id);
          if(item)offsetChannels+=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
        }
      }

      // Offset the cursor so the anchor item lands at the target position
      let startAddr=targetAddress-(foundAnchor?offsetChannels:0);
      let startUni=targetUniverse;
      while(startAddr<1&&startUni>1){
        startUni-=1;
        startAddr+=512;
      }
      startAddr=Math.max(1,startAddr);
      startUni=Math.max(1,Math.min(UNIVERSE_COUNT,startUni));

      let cursor={universe:startUni,address:startAddr};
      const updates=new Map<string,Pick<MvrItem,'universe'|'address'>>();
      orderedIds.forEach(id=>{
        const item=byId.get(id);
        if(!item)return;
        const footprint=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
        if(cursor.address+footprint-1>512&&cursor.universe<UNIVERSE_COUNT)cursor={universe:cursor.universe+1,address:1};
        updates.set(id,{universe:cursor.universe,address:cursor.address});
        cursor=nextPatchPosition(cursor.universe,cursor.address,footprint);
      });
      return items.map(item=>updates.has(item.id)?{...item,...updates.get(item.id)!}:item);
    });
    setPatchSelection(orderedIds);
    setPatchSelectionAnchor(orderedIds[0]);
    setSelectedPatch(orderedIds[0]);
    if(!anchorId)setUniverseView(targetUniverse);
  };

  const startPatchDrag=(id:string,e:React.PointerEvent<HTMLDivElement>)=>{
    e.preventDefault();
    e.stopPropagation();
    const ctrl=e.ctrlKey||e.metaKey;
    const shift=e.shiftKey;
    let draggedIds:string[];
    if(shift&&patchSelectionAnchor){
      const allIds=mvrItems.map(i=>i.id);
      const a=allIds.indexOf(patchSelectionAnchor);
      const b=allIds.indexOf(id);
      if(a>=0&&b>=0){
        const [from,to]=a<b?[a,b]:[b,a];
        draggedIds=sortedPatchIds(allIds.slice(from,to+1));
      }else{
        draggedIds=sortedPatchIds([id]);
      }
    }else if(ctrl){
      const next=selectedPatchIds.includes(id)?selectedPatchIds.filter(x=>x!==id):[...selectedPatchIds,id];
      draggedIds=sortedPatchIds(next.length?next:[id]);
    }else{
      // If clicking on an already-selected item, keep the whole selection for multi-drag
      if(selectedPatchIds.includes(id)){
        draggedIds=sortedPatchIds(selectedPatchIds);
      }else{
        draggedIds=sortedPatchIds([id]);
      }
    }
    setPatchSelection(draggedIds);
    setPatchSelectionAnchor(draggedIds[0]);
    setSelectedPatch(draggedIds[0]);
    const dragItem=mvrItems.find(x=>x.id===id);
    // Push history before drag starts
    pushMvrHistory(mvrItems, `移动 ${draggedIds.length} 个配接`);
    // Calculate offset: item first channel - grid cell under cursor at press time
    const initPos=patchPositionFromPointer(e.clientX,e.clientY);
    const itemAddr=(dragItem?.address||1);
    const offset=initPos?(itemAddr-initPos.address):0;
    const move=(ev:PointerEvent)=>{
      const pos=patchPositionFromPointer(ev.clientX,ev.clientY);
      if(!pos)return;
      const addr=Math.max(1,Math.min(512,pos.address+offset));
      movePatchGroup(draggedIds,pos.universe,addr,id);
    };
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
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
  const generateMa2Patch=async()=>{
    try{
      await downloadMa2Patch({sceneName,items:mvrItems});
      message.success('MA2 配接包已生成，包含 FixtureType、配接清单和宏命令');
    }catch(e){
      message.error((e as Error).message);
    }
  };
  const scanMa2=async()=>{
    setMa2Scanning(true);
    try{
      const devices=await api.scanMa2Network();
      setMa2Devices(devices);
      const recommended=devices.find(x=>x.isLocal)||devices[0];
      if(recommended){
        setMa2Selected(recommended.ip);
        setMa2Port(recommended.remotePort||30000);
      }
      message.success(devices.length?`发现 ${devices.length} 个候选 MA2 设备`:'未发现 MA2 设备，可手动输入 IP');
    }catch(e){
      message.error((e as Error).message);
    }finally{
      setMa2Scanning(false);
    }
  };
  const openMa2Push=()=>{
    setMa2Result(undefined);
    setMa2LogOpen(false);
    setMa2Open(true);
    if(!ma2Devices.length)void scanMa2();
  };
  const pushMa2=async(testOnly=false)=>{
    if(testOnly)setMa2Testing(true);else setMa2Importing(true);
    setMa2Result(undefined);
    setMa2LogOpen(false);
    try{
      const mode=testOnly?'all':ma2Mode;
      const pushItems=mode==='selected'?mvrItems.filter(item=>selectedPatchIds.includes(item.id)):mvrItems;
      if(!testOnly&&mode==='selected'&&!pushItems.length){message.warning('请先在配接列表中选中要导入的灯具');setMa2Importing(false);return;}
      const result=await api.pushToMa2({sceneName,items:testOnly?[]:pushItems,ma2Ip:ma2Selected,ma2Port,username:ma2Username,password:ma2Password,options:{importFixtureTypes:true,patchFixtures:true,testOnly,mode}});
      setMa2Result(result);
      if(testOnly&&result.success)message.success('TCP 30000 已连通，MA2 登录成功');
      else if(testOnly)message.error(result.errors?.[0]||'MA2 登录失败');
      else if(result.success)message.success(`MA2 导入命令已发送：${result.sent} 条`);
      else message.error(result.errors?.[0]||'MA2 导入失败');
    }catch(e){
      message.error((e as Error).message);
      setMa2Result({success:false,sent:0,errors:[(e as Error).message],commands:[]});
    }finally{
      if(testOnly)setMa2Testing(false);else setMa2Importing(false);
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

  const universeLayout=useMemo(()=>{
    const bars=new Map<number,{item:MvrItem;row:number;col:number;span:number;start:number;end:number}[]>();
    const occupied=new Map<number,Set<number>>();
    mvrItems.forEach(item=>{
      const universe=Math.max(1,Math.min(UNIVERSE_COUNT,item.universe||1));
      const footprint=Math.max(1,fixtureFootprint(fixtureById.get(item.fixtureId),item.modeName));
      const end=Math.min(512,item.address+footprint-1);
      const used=occupied.get(universe)||new Set<number>();
      occupied.set(universe,used);
      for(let ch=item.address;ch<=end;ch++)used.add(ch);
      const segments=bars.get(universe)||[];
      bars.set(universe,segments);
      for(let ch=item.address;ch<=end;){
        const row=Math.floor((ch-1)/32)+1;
        const col=((ch-1)%32)+1;
        const rowEnd=Math.min(end,row*32);
        segments.push({item,row,col,span:rowEnd-ch+1,start:ch,end:rowEnd});
        ch=rowEnd+1;
      }
    });
    return {bars,occupied};
  },[mvrItems,fixtureById]);
  const visibleUniverses=useMemo(()=>{
    if(!showAllUniverses)return [universeView];
    const start=Math.max(1,Math.min(UNIVERSE_COUNT,Math.floor(universeScrollTop/UNIVERSE_SECTION_HEIGHT)+1));
    const end=Math.min(UNIVERSE_COUNT,start+2);
    return Array.from({length:end-start+1},(_,i)=>start+i);
  },[showAllUniverses,universeView,universeScrollTop]);

  const handleUniverseScroll=(top:number)=>{
    setUniverseScrollTop(top);
  };

  const renderUniverseSection=(universe:number,offsetTop?:number)=>(
    <section key={universe} data-universe={universe} className={`universe-section ${universe===universeView?'active':''}`} style={offsetTop!==undefined?{transform:`translateY(${offsetTop}px)`}:undefined}>
      {showAllUniverses&&<div className="universe-section-title">Universe {universe}</div>}
      <div ref={universe===universeView?universeGridRef:undefined} className="universe-grid" onClick={e=>{if((e.target as HTMLElement).closest('.universe-bar'))return;clearPatchSelection();}}>
        {Array.from({length:512},(_,i)=>i+1).map(ch=><div key={ch} data-channel={ch} className={`universe-cell ${universeLayout.occupied.get(universe)?.has(ch)?'occupied':''}`} title={`Universe ${universe} · CH ${ch}`} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}} onDrop={e=>{e.preventDefault();e.stopPropagation();const id=e.dataTransfer.getData('text/patch-id');if(id){const ids=selectedPatchIds.includes(id)?selectedPatchIds:[id];movePatchGroup(ids,universe,ch)}}}><span>{ch}</span></div>)}
        {(universeLayout.bars.get(universe)||[]).map(seg=><div key={`${seg.item.id}-${seg.start}`} className={`universe-bar ${selectedPatchIds.includes(seg.item.id)?'selected':''}`} style={{left:`calc(${seg.col-1} * 100% / 32)`,top:`calc(${seg.row-1} * var(--dmx-cell-h))`,width:`calc(${seg.span} * 100% / 32)`,backgroundColor:rgba(seg.item.color,selectedPatchIds.includes(seg.item.id)?0.34:0.22),borderColor:seg.item.color}} title={`${seg.item.name} · U${universe} ${seg.start}-${seg.end}`} onClick={e=>e.stopPropagation()} onPointerDown={e=>startPatchDrag(seg.item.id,e)}><b>{seg.start===seg.item.address?seg.item.name:''}</b></div>)}
      </div>
    </section>
  );

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
          <Tooltip title="撤销 Ctrl+Z"><Button icon={<UndoOutlined/>} disabled={!mvrUndo.canUndo} onClick={handleMvrUndo}/></Tooltip>
          <Tooltip title="重做 Ctrl+Y"><Button icon={<RedoOutlined/>} disabled={!mvrUndo.canRedo} onClick={handleMvrRedo}/></Tooltip>
          <Popconfirm title="清除当前 MVR 草稿？" description="会清空所有配接规划，但不会删除灯具库。" onConfirm={clearMvrDraft} okText="清除" cancelText="取消">
            <Button danger icon={<DeleteOutlined/>} disabled={!mvrItems.length}>清除</Button>
          </Popconfirm>
          <Button type="primary" icon={<DownloadOutlined/>} disabled={!mvrItems.length} onClick={generateMvr}>生成 MVR</Button>
          <Button icon={<DownloadOutlined/>} disabled={!mvrItems.length} onClick={generateMa2Patch}>生成 MA2配接包</Button>
          <Button icon={<ThunderboltOutlined/>} disabled={!mvrItems.length} onClick={openMa2Push}>一键导入MA2</Button>
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
            <div className="patch-toolbar"><Button type="primary" icon={<PlusOutlined/>} onClick={()=>openAddPatch()}>添加Fixture</Button><Input prefix={<SearchOutlined/>} placeholder="搜索配接…"/></div>
            <div className="patch-table">
              <div className="patch-row header"><span>灯具配接</span><span>FID</span><span>灯具类型</span><span>模式</span><span>配接</span><span></span></div>
              {mvrItems.map(item=>{
                const f=fixtureById.get(item.fixtureId);
                if(!f)return null;
                const editing=editingPatchId===item.id;
                return <div key={item.id} className={`patch-row ${selectedPatchIds.includes(item.id)?'selected':''} ${editing?'editing':''}`} onPointerDown={e=>handlePatchRowPointerDown(item.id,e)} onClick={e=>handlePatchRowClick(item.id,e)} onDoubleClick={e=>{e.stopPropagation();setPatchSelection([item.id]);setPatchSelectionAnchor(item.id);setEditingPatchId(item.id);setSelectedPatch(item.id);setUniverseView(item.universe)}}>
                  {editing?<Input autoFocus value={item.name} onChange={e=>patchMvrItemWithHistory(item.id,{name:e.target.value})}/>:<span className="patch-cell-name">{item.name}</span>}
                  {editing?<InputNumber min={1} value={item.fid} onChange={v=>patchMvrItemWithHistory(item.id,{fid:v||1})}/>:<span>{item.fid}</span>}
                  {editing?<Select value={item.fixtureId} onChange={v=>{const nf=fixtureById.get(v)!;patchMvrItemWithHistory(item.id,{fixtureId:v,modeName:nf.modes[0]?.name||'Profile'},'更改灯具类型')}} options={fixtures.map(x=>({value:x.id,label:x.name}))}/>:<span className="patch-cell-name">{f.name}</span>}
                  {editing?<Select value={item.modeName} onChange={v=>patchMvrItemWithHistory(item.id,{modeName:v},'更改灯具模式')} options={f.modes.map(m=>({value:m.name,label:m.name}))}/>:<span>{item.modeName}</span>}
                  <span>{item.universe}.{item.address}</span>
                  <Button danger type="text" icon={<DeleteOutlined/>} onClick={e=>{e.stopPropagation();deleteMvrItems(selectedPatchIds.includes(item.id)?selectedPatchIds:[item.id])}}/>
                </div>;
              })}
              {!mvrItems.length&&<Empty description={fixtures.length?'从左侧灯具库拖入或点击添加 Fixture':'请先在左侧灯具库点击 + 创建灯具，或导入已有灯具文件'}/>}
            </div>
          </div>
         <div className="universe-panel">
            <div className="universe-head"><span>本地 Universe</span><Button size="small" disabled={universeView<=1} onClick={()=>setUniverseView(Math.max(1,universeView-1))}>上一域</Button><InputNumber min={1} max={UNIVERSE_COUNT} value={universeView} onChange={v=>setUniverseView(Math.max(1,Math.min(UNIVERSE_COUNT,v||1)))}/><span>/ {UNIVERSE_COUNT}</span><Button size="small" disabled={universeView>=UNIVERSE_COUNT} onClick={()=>setUniverseView(Math.min(UNIVERSE_COUNT,universeView+1))}>下一域</Button></div>
            {showAllUniverses?<div ref={universeScrollRef} className="universe-scroll" onScroll={e=>handleUniverseScroll(e.currentTarget.scrollTop)}>
              <div className="universe-virtual" style={{height:UNIVERSE_COUNT*UNIVERSE_SECTION_HEIGHT}}>
                {visibleUniverses.map(universe=>renderUniverseSection(universe,(universe-1)*UNIVERSE_SECTION_HEIGHT))}
              </div>
            </div>:renderUniverseSection(universeView)}
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
            <label>灯具名称<Input value={selectedMvrItem.name} onChange={e=>patchMvrItemWithHistory(selectedMvrItem.id,{name:e.target.value})}/></label>
            <label>Fixture 类型<Select value={selectedMvrItem.fixtureId} onChange={v=>{const nf=fixtures.find(x=>x.id===v)!;patchMvrItemWithHistory(selectedMvrItem.id,{fixtureId:v,modeName:nf.modes[0]?.name||'Profile'},'更改灯具类型')}} options={fixtures.map(x=>({value:x.id,label:`${x.manufacturer.name} · ${x.name}`}))}/></label>
            <label>模式<Select value={selectedMvrItem.modeName} onChange={v=>patchMvrItemWithHistory(selectedMvrItem.id,{modeName:v},'更改灯具模式')} options={f.modes.map(m=>({value:m.name,label:`${m.name} · ${fixtureFootprint(f,m.name)} CH`}))}/></label>
            <div className="two"><label>FID<InputNumber min={1} value={selectedMvrItem.fid} onChange={v=>patchMvrItemWithHistory(selectedMvrItem.id,{fid:v||1})}/></label><label>Universe<InputNumber min={1} max={256} value={selectedMvrItem.universe} onChange={v=>{const universe=Math.max(1,Math.min(256,v||1));patchMvrItemWithHistory(selectedMvrItem.id,{universe},'调整Universe');setUniverseView(universe)}}/></label></div>
            <div className="two"><label>起始通道<InputNumber min={1} max={512} value={selectedMvrItem.address} onChange={v=>patchMvrItemWithHistory(selectedMvrItem.id,{address:v||1},'调整地址')}/></label><label>编辑器颜色<Input type="color" value={selectedMvrItem.color} onChange={e=>patchMvrItemWithHistory(selectedMvrItem.id,{color:e.target.value})}/></label></div>
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
        <table><thead><tr><th></th><th>CH</th><th>MA 属性</th><th>自定义名称</th><th>分辨率</th><th>默认值</th><th>范围</th><th>属性族</th><th>操作</th></tr></thead><tbody>
          {shown.map(ch=><tr key={ch.id} className={ch.id===channelId?'selected':''} onClick={()=>selectChannel(ch.id)}>
            <td><HolderOutlined/></td><td>{ch.address}</td>
            <td><Select popupMatchSelectWidth={380} showSearch optionFilterProp="label" value={ch.attribute} onChange={v=>{const a=catalog.attributes.find(x=>x.id===v)!;patchChannelById(ch.id,{attribute:v,group:a.maFeature,name:a.ueAttribute,ueAttribute:a.ueAttribute})}} options={attributeOptions(catalog)}/></td>
            <td><Input value={ch.name} onChange={e=>patchChannelById(ch.id,{name:e.target.value.replace(/[^A-Za-z0-9 _.-]/g,'')})}/></td>
            <td><Select value={ch.resolution} onChange={(v:Resolution)=>patchChannelById(ch.id,{resolution:v})} options={[8,16,24,32].map(v=>({value:v,label:`${v} bit`}))}/></td>
            <td><InputNumber min={0} max={100} value={ch.defaultValue} onChange={v=>patchChannelById(ch.id,{defaultValue:v||0})}/></td>
            <td>0 – 100</td><td><Tag color="blue">{ch.group}</Tag></td>
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
        <div className="two"><label>默认值<InputNumber min={0} max={100} value={channel.defaultValue} onChange={v=>patchChannelById(channel.id,{defaultValue:v||0})}/></label><label>高亮值<InputNumber min={0} max={100} value={channel.highlightValue} onChange={v=>patchChannelById(channel.id,{highlightValue:v||0})}/></label></div>
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

    <Modal width={980} className="ma2-push-modal" title="一键导入 → MA2" open={ma2Open} onCancel={()=>setMa2Open(false)} footer={<div className="ma2-modal-actions"><Button onClick={()=>pushMa2(true)} loading={ma2Testing}>测试连接/登录</Button><Button type="primary" icon={<ThunderboltOutlined/>} disabled={!mvrItems.length||(ma2Mode==='selected'&&!selectedPatchIds.length)} loading={ma2Importing} onClick={()=>pushMa2(false)}>{ma2Mode==='overwrite'?'覆盖导入全部灯具':ma2Mode==='selected'?`导入选中灯具 (${selectedPatchIds.length})`:`首次导入全部灯具 (${mvrItems.length})`}</Button></div>}>
      <div className="ma2-push-layout">
        <div className="ma2-config-panel">
          <div className="ma2-remote-notice">提示：使用前请先在 MA2 onPC 中开启 Remote — Setup → Console → Global Settings → Telnet → Login Enabled</div>
          <section>
            <div className="manager-head"><b>目标 MA2 设备</b><Button icon={<ReloadOutlined/>} loading={ma2Scanning} onClick={scanMa2}>扫描局域网</Button></div>
            {ma2Scanning&&<div className="ma2-scan-progress">正在扫描本机网段的 TCP 30000 / HTTP 80...</div>}
            <div className="ma2-device-list">
              {ma2Devices.map(device=><button key={device.ip} type="button" className={`ma2-device-item ${ma2Selected===device.ip?'selected':''}`} onClick={()=>{setMa2Selected(device.ip);setMa2Port(device.remotePort||30000)}}>
                <span><strong>{device.ip}:{device.remotePort}</strong>{device.isLocal&&<Tag color="green">本机 onPC</Tag>}</span>
                <small>{device.hostname||'未解析主机名'} · {device.detectedBy.join(', ')}</small>
              </button>)}
              {!ma2Devices.length&&!ma2Scanning&&<Empty description="尚未发现设备，可手动输入 IP"/>}
            </div>
            <div className="ma2-manual-target">
              <label>手动 IP<Input value={ma2Selected} onChange={e=>setMa2Selected(e.target.value.trim())}/></label>
              <label>端口<InputNumber min={1} max={65535} value={ma2Port} onChange={v=>setMa2Port(v||30000)}/></label>
            </div>
          </section>
          <section>
            <div className="ma2-settings-grid">
              <label>MA2 用户名<Input value={ma2Username} onChange={e=>setMa2Username(e.target.value)}/></label>
              <label>MA2 密码<Input.Password value={ma2Password} onChange={e=>setMa2Password(e.target.value)} placeholder="默认 administrator/admin"/></label>
            </div>
            <div className="ma2-import-mode">
              <b>导入模式</b>
              <Radio.Group value={ma2Mode} onChange={e=>setMa2Mode(e.target.value)}>
                <Radio.Button value="all">首次导入全部灯具 ({mvrItems.length})</Radio.Button>
                <Radio.Button value="selected" disabled={!selectedPatchIds.length}>导入选中灯具 ({selectedPatchIds.length})</Radio.Button>
                <Radio.Button value="overwrite">覆盖导入全部灯具</Radio.Button>
              </Radio.Group>
              <div className="ma2-settings-help">
                {ma2Mode==='all'&&<><b>首次导入全部灯具</b><span>将网页中全部 Fixture Type 和 Universe 配接规划导入 MA2。同名 Fixture Type 会被替换，Layer 会被覆盖；不影响其他 Layer。</span></>}
                {ma2Mode==='selected'&&<><b>导入选中的灯具</b><span>仅导入在配接列表中选中的 Fixture Type 和 Universe Layer 到 MA2，不影响其他已配接的灯具。</span></>}
                {ma2Mode==='overwrite'&&<><b>覆盖导入全部灯具</b><span>创建空白 Show（NewShow）清空全部灯具、Fixture Type 和 Layer，然后重新全部导入网页中的配接规划。适合网页配接规划大幅变更后的完全刷新。⚠ 会丢失 MA2 中所有未保存的编程数据。</span></>}
                <span>Error #22 表示 EditSetup 被占用；关闭 Patch/Fixture Schedule 或重启 onPC 后再试。</span>
              </div>
            </div>
          </section>
        </div>
        <aside className="ma2-result-panel">
          <div className={`ma2-result-card ${ma2Result?(ma2Result.success?'success':'error'):'idle'}`}>
            {ma2Result?(ma2Result.success?<CheckCircleOutlined/>:<CloseCircleOutlined/>):<ThunderboltOutlined/>}
            <div><strong>{ma2Result?(ma2Result.success?'成功':'失败'):'等待执行'}</strong><span>{ma2Result?`已发送 ${ma2Result.sent} 条命令`:'日志将显示在这里'}</span></div>
          </div>
          {ma2Result&&<Button block onClick={()=>setMa2LogOpen(!ma2LogOpen)}>{ma2LogOpen?'收起日志':'查看日志与详情'}</Button>}
          {ma2Result&&ma2LogOpen&&<div className="ma2-command-log">
            {ma2Result.warnings?.map(w=><p className="warning" key={w}>{w}</p>)}
            {ma2Result.errors?.map(err=><p className="error" key={err}>{err}</p>)}
            {(ma2Result.feedback?.length?ma2Result.feedback:(ma2Result.commands||[]).map(command=>({command,feedback:''}))).map((entry,index)=><code key={`${entry.command}-${index}`}>$ {entry.command}{entry.feedback?`\n${entry.feedback.trim()}`:''}</code>)}
          </div>}
        </aside>
      </div>
    </Modal>

    <footer><div className={validation.valid?'valid':'invalid'}>{validation.valid?<CheckCircleOutlined/>:<WarningOutlined/>} {validation.valid?'无通道冲突':`${validation.issues.length} 个问题`}</div><div><Tag color={validation.valid?'green':'red'}>MA2 XML</Tag><Tag color={validation.valid?'green':'red'}>MA3 / GDTF</Tag><Tag color={validation.valid?'green':'red'}>UE 5.7+</Tag></div><div>{validation.issues[0]?.message||`${mode?.channels.length||0} 个逻辑通道`}</div></footer>
  </div>;
}

export default function App(){
  return <AntApp><Workbench/></AntApp>;
}
