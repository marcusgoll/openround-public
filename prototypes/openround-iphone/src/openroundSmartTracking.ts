import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { isGeoPositionInsideGeometry, type LoadedHoleGeometry } from './openroundGeometry.ts';
import type { GeoPoint as Point } from './openroundCourseData.ts';
export type TrackingFix = Point & {id: string; time: number; accuracy: number; hole: number; segment: string};
export type TrackingLie = 'unknown' | 'tee' | 'fairway' | 'rough' | 'bunker' | 'recovery' | 'green';
export type TrackingClub = {clubID: string; label: string; yards: number};
export type TrackingCorrection = {id: string; status: 'reviewed' | 'dismissed'; clubID?: string; lie?: TrackingLie; startLat: number; startLon: number; endLat: number; endLon: number};
export type PredictedShot = {id: string; hole: number; start: TrackingFix; end: TrackingFix; yards: number; clubID?: string; lie: TrackingLie; status: 'predicted' | 'reviewed' | 'dismissed'};
export type TrackingSnapshot = {
 recording: boolean; requested: boolean; activeSessionID?: string; precise: boolean; permission: number; problem?: string;
 sessions: {sessionID: string; roundID: string; courseID: string; fixCount: number}[];
 session?: {sessionID: string; context: {roundID: string; courseID: string; hole: number}; fixes: TrackingFix[]; corrections: TrackingCorrection[]; running: boolean};
};
export function distanceBetweenYards(start: Point, end: Point) {
 return distance(point([start.lon, start.lat]), point([end.lon, end.lat]), { units: 'yards' });
}
function validFix(fix: TrackingFix) {
 return typeof fix.id === 'string' && typeof fix.segment === 'string' && Number.isFinite(fix.time) && fix.time > 0 &&
  Number.isFinite(fix.lat) && Math.abs(fix.lat)<=90 && Number.isFinite(fix.lon) && Math.abs(fix.lon)<=180 &&
  Number.isFinite(fix.accuracy) && fix.accuracy>=0 && fix.accuracy<=15 && Number.isInteger(fix.hole) && fix.hole>=1 && fix.hole<=18;
}
export function suggestLie(fix: TrackingFix, geometry?: LoadedHoleGeometry): TrackingLie {
 if (!geometry || geometry.hole.number !== fix.hole || !validFix(fix)) return 'unknown';
 const radius=Math.max(5,fix.accuracy), latDelta=radius/111320, lonDelta=latDelta/Math.max(0.01,Math.cos(fix.lat*Math.PI/180));
 const samples=[{lat:fix.lat,lon:fix.lon},...Array.from({length:16},(_,i)=>({lat:fix.lat+latDelta*Math.cos(i*Math.PI/8),lon:fix.lon+lonDelta*Math.sin(i*Math.PI/8)}))];
 if (geometry.hole.features.some(feature => ['water','waste','out_of_bounds'].includes(feature.kind) && samples.some(point=>isGeoPositionInsideGeometry([point.lon,point.lat],feature.geometry)))) return 'unknown';
 const matches=geometry.hole.features.filter(feature => ['tee','fairway','rough','bunker','green'].includes(feature.kind) &&
  samples.every(point=>isGeoPositionInsideGeometry([point.lon,point.lat],feature.geometry)));
 const kinds=[...new Set(matches.map(feature=>feature.kind))];
 return kinds.length===1 ? kinds[0] as TrackingLie : 'unknown';
}
// ponytail: conservative stop-to-stop candidates, not swing detection; calibrate with labeled rounds before promoting automatically.
export function predictShots(fixes: readonly TrackingFix[], clubs: readonly TrackingClub[], corrections: readonly TrackingCorrection[], geometry?: LoadedHoleGeometry): PredictedShot[] {
 const shots: PredictedShot[]=[];
 let cluster: {first: TrackingFix; count: number; settled: boolean}|undefined;
 let anchor: TrackingFix|undefined, previous: TrackingFix|undefined;
 const ids=new Set<string>();
 for (const fix of fixes) {
  if (!validFix(fix) || ids.has(fix.id)) continue;
  ids.add(fix.id);
  if (previous && fix.time<=previous.time) continue;
  const gap=previous && (fix.segment!==previous.segment || fix.hole!==previous.hole || fix.time-previous.time>120000 || distanceBetweenYards(previous,fix)/1.0936133/((fix.time-previous.time)/1000)>25);
  if (gap) {cluster=undefined; anchor=undefined;}
  previous=fix;
  if (!cluster || distanceBetweenYards(cluster.first,fix)>Math.max(6,cluster.first.accuracy)*1.0936133) cluster={first:fix,count:1,settled:false};
  else cluster.count++;
  if (cluster.settled || cluster.count<3 || fix.time-cluster.first.time<12000) continue;
  cluster.settled=true;
  if (anchor) {
   const yards=distanceBetweenYards(anchor,cluster.first);
   if (yards>=25 && yards<=450) {
    const closest=clubs.filter(c=>Number.isFinite(c.yards)&&c.yards>0&&c.clubID!=='putter').reduce<TrackingClub|undefined>((best,club)=>!best || Math.abs(club.yards-yards)<Math.abs(best.yards-yards)?club:best,undefined);
    const id=`${anchor.id}:${cluster.first.id}`;
    const correction=corrections.find(c=>c.id===id);
    const start=correction?{...anchor,lat:correction.startLat,lon:correction.startLon}:anchor;
    const end=correction?{...cluster.first,lat:correction.endLat,lon:correction.endLon}:cluster.first;
    shots.push({id,hole:anchor.hole,start,end,yards:Math.round(distanceBetweenYards(start,end)),
     clubID:correction?.clubID ?? (closest && Math.abs(closest.yards-yards)<=Math.max(25,yards*.25)?closest.clubID:undefined),
     lie:correction?.lie ?? suggestLie(start,geometry),status:correction?.status ?? 'predicted'});
   }
  }
  anchor=cluster.first;
 }
 return shots;
}
