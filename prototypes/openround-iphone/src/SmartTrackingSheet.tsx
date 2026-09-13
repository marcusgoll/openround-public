import { useEffect, useRef, useState } from 'react';
import { BottomSheet, KeyboardInput } from './mobile';
import { nativeTracking, nativeTrackingAvailable } from './nativeTracking';
import { predictShots, type PredictedShot, type TrackingClub, type TrackingCorrection, type TrackingLie, type TrackingSnapshot } from './openroundSmartTracking';
import type { LoadedHoleGeometry } from './openroundGeometry';

const lies: TrackingLie[] = ['unknown', 'tee', 'fairway', 'rough', 'bunker', 'recovery', 'green'];
export function SmartTrackingSheet({open, onClose, roundID, courseID, hole, clubs, geometry, roundLabels}: {
  open: boolean; onClose: () => void; roundID: string | null; courseID?: string; hole: number;
  clubs: TrackingClub[]; geometry?: LoadedHoleGeometry; roundLabels: Record<string,string>;
}) {
  const [snapshot, setSnapshot] = useState<TrackingSnapshot>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PredictedShot>();
  const request = useRef(0);
  async function refresh() {
    const id = ++request.current;
    try {
      const next = await nativeTracking.snapshot(selected ? {sessionID: selected} : undefined);
      if (id === request.current) { setSnapshot(next); setError(''); }
    } catch (reason) { if (id === request.current) setError(String(reason)); }
  }
  useEffect(() => {
    if (!nativeTrackingAvailable || !open) return;
    void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    const foreground = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', foreground);
    return () => { ++request.current; window.clearInterval(interval); document.removeEventListener('visibilitychange', foreground); };
  }, [open, selected]);
  async function record(start: boolean) {
    if (busy) return;
    setBusy(true); setError(''); ++request.current;
    try {
      const next = start && roundID && courseID ? await nativeTracking.start({roundID, courseID, hole}) : await nativeTracking.stop();
      setSelected(undefined); setSnapshot(next);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function correct(correction: TrackingCorrection) {
    if (!snapshot?.session || busy) return;
    setBusy(true); setError(''); ++request.current;
    try { setSnapshot(await nativeTracking.correct({...correction, sessionID: snapshot.session.sessionID})); setEditing(undefined); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  const session = snapshot?.session;
  const shots = open && session ? predictShots(session.fixes, clubs, session.corrections, session.context.courseID === courseID ? geometry : undefined) : [];
  const latest = session?.fixes.at(-1);
  const fresh = latest && Date.now() - latest.time < 30000;
  const status = snapshot?.recording ? snapshot.activeSessionID !== session?.sessionID ? 'Recording another session' : fresh ? 'Recording location' : 'Recording requested · waiting for GPS' : snapshot?.requested ? 'Waiting for location permission' : 'Recording stopped';
  return <BottomSheet open={open} onOpenChange={value => { if (!value) onClose(); }} title="Smart Tracking" description="Pocket capture · iPhone field trial" snap={0.92}>
    <div className="sheet-stack smart-tracking-sheet">
      {!nativeTrackingAvailable ? <>
        <div className="local-status-card"><strong>Native iPhone app required</strong><p>Locked-screen capture is being built for the iPhone app. This browser preview cannot record a round from your pocket.</p></div>
        <p>Keep using the shot and score controls here. The native field trial will save location on your phone and suggest likely shots for review. Apple Watch support comes later.</p>
      </> : <>
        <div className="local-status-card" role="status"><strong>{status}</strong>
          <p>{latest ? `Last saved location ${new Date(latest.time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})} · ±${Math.round(latest.accuracy)} m` : 'No accurate locations saved yet.'}</p>
          {snapshot && !snapshot.precise && <p>Turn on Precise Location in iPhone Settings for useful shot predictions.</p>}
          {snapshot?.problem && <p>{snapshot.problem}</p>}
        </div>
        {error && <p className="smart-error" role="alert">{error}</p>}
        <button className="sheet-primary-button" disabled={busy || !snapshot || (!snapshot.requested && (!roundID || !courseID))} onClick={() => void record(!snapshot?.requested)}>{snapshot?.requested ? 'STOP RECORDING' : 'START / RESUME RECORDING'}</button>
        {!roundID && <p>Start a real round to record. Saved predictions remain available below.</p>}
        <details><summary>How pocket tracking works</summary><p>Start while the app is open, then keep your phone in your pocket. Advance the hole in the app. After force-quitting or a restart, reopen and resume.</p><p>Stops can also be practice swings, searches or cart stops. These are suggestions, not detected ball contact. Short shots and putts still need manual entry.</p></details>
        <label className="smart-field">Review a recording<select value={session?.sessionID ?? ''} disabled={busy} onChange={event => {setEditing(undefined); setSelected(event.target.value);}}>
          {!snapshot?.sessions.length && <option value="">No recordings yet</option>}
          {snapshot?.sessions.map((item, index) => <option key={item.sessionID} value={item.sessionID}>{roundLabels[item.roundID] ?? `Recording ${snapshot.sessions.length-index}`} · {item.fixCount} locations</option>)}
        </select></label>
        <div><strong>{shots.filter(shot => shot.status !== 'dismissed').length} likely shot{shots.filter(shot => shot.status !== 'dismissed').length === 1 ? '' : 's'}</strong><p>Review these suggestions. Scores and learned club distances stay unchanged.</p></div>
        {shots.length === 0 && <p>No shot candidates yet. A candidate needs accurate stops before and after a move of at least 25 yards.</p>}
        {shots.map(shot => <div className="smart-candidate" key={shot.id}>
          <strong>Hole {shot.hole} · {shot.yards} yd</strong><span>{shot.status} · {clubs.find(club => club.clubID === shot.clubID)?.label ?? 'Club unknown'} · {shot.lie} lie</span>
          <button className="sheet-secondary-button" onClick={() => setEditing(editing?.id === shot.id ? undefined : shot)} disabled={busy}>EDIT / REVIEW</button>
          {editing?.id === shot.id && <CandidateEditor key={shot.id} shot={editing} clubs={clubs} busy={busy} onSave={correct} />}
        </div>)}
      </>}
    </div>
  </BottomSheet>;
}
function CandidateEditor({shot, clubs, busy, onSave}: {shot: PredictedShot; clubs: TrackingClub[]; busy: boolean; onSave: (correction: TrackingCorrection) => Promise<void>}) {
  const [clubID, setClubID] = useState(shot.clubID ?? '');
  const [lie, setLie] = useState(shot.lie);
  const [coordinates, setCoordinates] = useState({startLat: String(shot.start.lat), startLon: String(shot.start.lon), endLat: String(shot.end.lat), endLon: String(shot.end.lon)});
  const parsed = Object.fromEntries(Object.entries(coordinates).map(([key,value]) => [key, value.trim() === '' ? NaN : Number(value)])) as Pick<TrackingCorrection,'startLat'|'startLon'|'endLat'|'endLon'>;
  const valid = Object.entries(parsed).every(([key,value]) => Number.isFinite(value) && Math.abs(value) <= (key.endsWith('Lat') ? 90 : 180));
  return <div className="sheet-stack">
    <label className="smart-field">Club<select value={clubID} onChange={event => setClubID(event.target.value)}><option value="">Unknown</option>{clubs.map(club => <option key={club.clubID} value={club.clubID}>{club.label}</option>)}</select></label>
    <label className="smart-field">Starting lie<select value={lie} onChange={event => setLie(event.target.value as TrackingLie)}>{lies.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <details><summary>Correct shot locations</summary><p>GPS coordinates, in decimal degrees. Distance updates after saving.</p>{Object.entries(coordinates).map(([key,value]) => <label className="smart-field" key={key}>{({startLat:'Start latitude',startLon:'Start longitude',endLat:'Finish latitude',endLon:'Finish longitude'})[key as keyof typeof coordinates]}<KeyboardInput value={value} inputMode="decimal" onChange={event => setCoordinates(current => ({...current,[key]:event.target.value}))} /></label>)}</details>
    {!valid && <p role="alert">Enter valid latitude and longitude for both locations.</p>}
    <button className="sheet-primary-button" disabled={busy || !valid} onClick={() => void onSave({id:shot.id,status:'reviewed',clubID,lie,...parsed})}>SAVE REVIEW</button>
    <button className="sheet-secondary-button" disabled={busy || !valid} onClick={() => void onSave({id:shot.id,status:'dismissed',clubID,lie,...parsed})}>NOT A SHOT</button>
  </div>;
}
