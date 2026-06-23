import {describe,expect,it} from 'vitest';import {modeFootprint,nextChannelAddress} from './model';import type {FixtureMode} from './types';

describe('DMX 模式计算',()=>{
  it('按最高占用字节计算 footprint',()=>{
    const mode={id:'m',name:'测试',channels:[{id:'1',address:1,resolution:16},{id:'2',address:10,resolution:8}]} as FixtureMode;
    expect(modeFootprint(mode)).toBe(10);expect(nextChannelAddress(mode)).toBe(11);
  });
  it('空模式从地址1开始',()=>{expect(modeFootprint()).toBe(0);expect(nextChannelAddress()).toBe(1)});
});
