import {describe,expect,it} from 'vitest';
import {compactModeAddresses,removeChannelAndCompact} from './model';
import type {FixtureMode} from './types';

describe('DMX channel address compaction',()=>{
  it('moves following channels forward after deletion',()=>{
    const mode={id:'m',name:'test',channels:[
      {id:'1',address:1,resolution:8},
      {id:'2',address:2,resolution:8},
      {id:'3',address:3,resolution:8},
    ]} as FixtureMode;

    removeChannelAndCompact(mode,'2');

    expect(mode.channels.map(channel=>channel.address)).toEqual([1,2]);
  });

  it('reserves two slots for a 16 bit channel',()=>{
    const mode={id:'m',name:'test',channels:[
      {id:'1',address:1,resolution:16},
      {id:'2',address:2,resolution:8},
      {id:'3',address:3,resolution:8},
    ]} as FixtureMode;

    compactModeAddresses(mode);

    expect(mode.channels.map(channel=>channel.address)).toEqual([1,3,4]);
  });
});
