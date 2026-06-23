import {del,get,set} from 'idb-keyval'; import type {FixtureDocument} from './types';
const key=(id:string)=>`fixture-forge:draft:${id}`;
export const draft={get:(id:string)=>get<FixtureDocument>(key(id)),set:(f:FixtureDocument)=>set(key(f.id),f),remove:(id:string)=>del(key(id))};

