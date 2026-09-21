/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Optional transport experiment; independent peer connections, not SCTP streams.
   Local loopback only. This does not predict Internet/TURN/mobile performance. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
const browser = await chromium.launch();
const output = [];
try {
  for (const connections of [1, 4, 1, 4, 1, 4]) {
    const sender = await browser.newPage(); const receiver = await browser.newPage();
    // A local secure origin gives the receiver WebCrypto without loading the app.
    await receiver.route('http://localhost/benchmark', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Transfer benchmark</title>' }));
    await receiver.goto('http://localhost/benchmark');
    const bytes = 16 * 1024 * 1024;
    await receiver.evaluate(({connections, bytes}) => {
      window.pcs = []; window.received = 0; window.payload = new Uint8Array(bytes);
      window.createAnswer = async ({sdp,index}) => {
        const pc = new RTCPeerConnection(); pcs.push(pc);
        let offset = index * bytes / connections;
        pc.ondatachannel = e => {
          e.channel.binaryType = 'arraybuffer';
          e.channel.onmessage = ({data}) => { payload.set(new Uint8Array(data), offset); offset += data.byteLength; received += data.byteLength; if (received === bytes) window.finishedAt = performance.now(); };
        };
        await pc.setRemoteDescription(sdp); await pc.setLocalDescription(await pc.createAnswer());
        if(pc.iceGatheringState !== 'complete') await new Promise(r=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')r();}));
        return pc.localDescription.toJSON();
      };
    }, {connections,bytes});
    await sender.evaluate(() => { window.pcs=[]; window.channels=[]; });
    for (let index=0; index<connections; index++) {
      const sdp = await sender.evaluate(async () => {
        const pc = new RTCPeerConnection(); pcs.push(pc); channels.push(pc.createDataChannel('file'));
        await pc.setLocalDescription(await pc.createOffer());
        if(pc.iceGatheringState !== 'complete') await new Promise(r=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')r();}));
        return pc.localDescription.toJSON();
      });
      const answer = await receiver.evaluate(({sdp,index})=>createAnswer({sdp,index}),{sdp,index});
      await sender.evaluate(({answer,index})=>pcs[index].setRemoteDescription(answer),{answer,index});
    }
    await sender.waitForFunction(()=>channels.every(c=>c.readyState==='open'));
    const start = performance.now();
    await sender.evaluate(async ({connections,bytes}) => {
      await Promise.all(channels.map(async (ch,i)=>{
        ch.bufferedAmountLowThreshold=128*1024;
        const data=new Uint8Array(16384); for(let j=0;j<data.length;j++)data[j]=j%251;
        for(let offset=0;offset<bytes/connections;offset+=data.length){
          if(ch.bufferedAmount>512*1024)await new Promise(r=>ch.addEventListener('bufferedamountlow',r,{once:true}));
          ch.send(data);
        }
      }));
    },{connections,bytes});
    await receiver.waitForFunction(bytes=>received===bytes,bytes,{timeout:120000,polling:10});
    const elapsed=performance.now()-start;
    const actual = await receiver.evaluate(async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256', payload))].map(b => b.toString(16).padStart(2,'0')).join(''));
    const expected=Buffer.alloc(bytes); for(let i=0;i<bytes;i++)expected[i]=(i%16384)%251;
    const digest = x=>createHash('sha256').update(x).digest('hex');
    const valid=actual===digest(expected);
    const row={connections,bytes,ms:Math.round(elapsed),MiBps:Number((bytes/1048576/(elapsed/1000)).toFixed(2)),sha256Valid:valid};
    output.push(row);console.log(JSON.stringify(row));
    await sender.close();await receiver.close();
    if(!valid)throw Error('payload mismatch');
  }
} finally {await browser.close();}
console.log(JSON.stringify({scope:'local loopback, parallel with regression workload',runs:output},null,2));
