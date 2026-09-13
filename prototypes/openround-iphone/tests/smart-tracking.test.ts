import assert from 'node:assert/strict';
import test from 'node:test';
import { predictShots, suggestLie, type TrackingFix } from '../src/openroundSmartTracking.ts';
const fix = (id: string, time: number, yards: number, patch: Partial<TrackingFix> = {}): TrackingFix => ({id, time, lat: 32 + yards / 121600, lon: -97, accuracy: 4, hole: 1, segment: 'one', ...patch});
const route = [fix('a',1000,0), fix('b',9000,0), fix('c',17000,0), fix('d',61000,200), fix('e',69000,200), fix('f',77000,200)];
test('stable stops create one replay-stable candidate, never a confirmed stroke', () => {
 const shots = predictShots(route, [{clubID:'driver',label:'Driver',yards:200}], []);
 assert.equal(shots.length,1); assert.equal(shots[0].id,'a:d'); assert.equal(shots[0].status,'predicted'); assert.equal(shots[0].clubID,'driver');
 assert.deepEqual(predictShots([...route,route[5]],[],[]).map(s=>s.id), ['a:d']);
 assert.equal(predictShots(route.slice(0,5),[],[]).length,0);
});
test('drift, recording gaps, hole changes and jumps never bridge into a shot', () => {
 assert.equal(predictShots(route.map(f=>({...f,accuracy:40})),[],[]).length,0);
 assert.equal(predictShots(route.map(f=>({...f,lat:32+0.00001*Math.sin(f.time)})),[],[]).length,0);
 assert.equal(predictShots(route.map((f,i)=>i>2?{...f,time:f.time+200000}:f),[],[]).length,0);
 assert.equal(predictShots(route.map((f,i)=>i>2?{...f,hole:2}:f),[],[]).length,0);
 assert.equal(predictShots(route.map((f,i)=>i>2?{...f,segment:'two'}:f),[],[]).length,0);
 assert.equal(predictShots(route.map((f,i)=>i>2?{...f,lat:40}:f),[],[]).length,0);
});
test('corrections and dismissals survive replay without training club evidence', () => {
 const correction = {id:'a:d',status:'reviewed' as const,clubID:'iron',lie:'rough' as const,startLat:32,startLon:-97,endLat:32.001,endLon:-97};
 const shots=predictShots(route,[],[correction]);
 assert.equal(shots[0].clubID,'iron'); assert.equal(shots[0].lie,'rough'); assert.equal(shots[0].end.lat,32.001);
 assert.equal(predictShots(route,[],[{...correction,status:'dismissed'}])[0].status,'dismissed');
});


test('lie suggestions require one mapped surface containing the uncertainty circle', () => {
 const feature = {id:'fairway',kind:'fairway' as const,geometry:{type:'Polygon' as const,coordinates:[[[-97.001,31.999],[-96.999,31.999],[-96.999,32.001],[-97.001,32.001],[-97.001,31.999]]] as [number,number][][]}};
 const geometry = {hole:{number:1,tees:[],features:[feature],geometryStatus:'complete' as const},quality:{grade:'A' as const,status:'complete' as const,missing:[],hazardsUsable:true,pinUsable:true,attribution:'© OpenStreetMap contributors (ODbL 1.0)' as const},provider:'openstreetmap-overpass' as const,sourceVersion:'test'};
 assert.equal(suggestLie(route[0],geometry),'fairway');
 assert.equal(suggestLie({...route[0],lat:32.001},geometry),'unknown');
 assert.equal(suggestLie({...route[0],hole:2},geometry),'unknown');
 assert.equal(suggestLie(route[0],{...geometry,hole:{...geometry.hole,features:[feature,{...feature,kind:'water'}]}}),'unknown');
 assert.equal(suggestLie(route[0],{...geometry,hole:{...geometry.hole,features:[feature,{...feature,kind:'green'}]}}),'unknown');
});
