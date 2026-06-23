import type {FixtureMode} from './types';

export function modeFootprint(mode?:FixtureMode){
  if(!mode?.channels.length)return 0;
  return Math.max(...mode.channels.map(channel=>channel.address+channel.resolution/8-1));
}

export function nextChannelAddress(mode?:FixtureMode){
  return modeFootprint(mode)+1;
}

export function compactModeAddresses(mode:FixtureMode){
  let address=1;
  mode.channels.forEach(channel=>{
    channel.address=address;
    address+=channel.resolution/8;
  });
}

export function removeChannelAndCompact(mode:FixtureMode,channelId:string){
  mode.channels=mode.channels.filter(channel=>channel.id!==channelId);
  compactModeAddresses(mode);
}
