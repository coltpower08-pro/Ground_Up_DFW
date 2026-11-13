import { useEffect, useRef, useState } from 'react';
import * as S from '../engine/sim';
import { IsoMap } from '../render/map';
import { Map3D } from '../render/map3d';
import { Btn } from './kit';
import { useUI, type Overlay } from './store';

const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'zoning', label: 'Zoning' }, { id: 'flood', label: 'Flood' }, { id: 'utilities', label: 'Utilities' }, { id: 'land', label: 'Land price' },
];
const LEGEND: Record<Overlay, [string, string][]> = {
  none: [],
  zoning: [['#5f7fa8', 'Industrial'], ['#d2694c', 'Commercial'], ['#7fa35f', 'Agricultural'], ['#c2a04a', 'County ETJ']],
  flood: [['#3f87b5', 'Floodplain']],
  utilities: [['#2f8f8a', 'Water and sewer'], ['#d09a2e', 'Water only'], ['#8a8580', 'None']],
  land: [['hsl(38,80%,78%)', '$2/SF'], ['hsl(25,80%,61%)', '$9'], ['hsl(12,80%,44%)', '$16+']],
};

export function MapView({ dim }: { dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null), map = useRef<IsoMap | Map3D | null>(null), fromMap = useRef(false);
  const flat = useUI((s) => s.flat);
  const [is3d, setIs3d] = useState(false), [sky, setSky] = useState('');
  const gfx = useUI((s) => s.gfx);
  useEffect(() => { if (map.current instanceof Map3D) map.current.setGfx(gfx); }, [gfx, is3d]);
  useEffect(() => { if (!is3d) return; const id = setInterval(() => { if (map.current instanceof Map3D) setSky(map.current.status()); }, 1000); return () => clearInterval(id); }, [is3d]);
  const rev = useUI((s) => s.rev), sel = useUI((s) => s.sel), overlay = useUI((s) => s.overlay), set = useUI((s) => s.set);
  const game = useUI((s) => s.game), focusReq = useUI((s) => s.focusReq);
  useEffect(() => { if (focusReq) map.current?.centerTile(focusReq.x, focusReq.y, focusReq.z); }, [focusReq]);

  useEffect(() => {
    // 3D when the device supports WebGL and the player has not chosen the simple map
    let m: IsoMap | Map3D;
    const can3d = !flat && !!document.createElement('canvas').getContext('webgl2');
    try { m = can3d ? new Map3D(ref.current!) : new IsoMap(ref.current!); } catch { m = new IsoMap(ref.current!); }
    setIs3d(m instanceof Map3D);
    map.current = m;
    if (m instanceof Map3D) { m.setGfx(useUI.getState().gfx); (window as unknown as { __map3d?: Map3D }).__map3d = m; }
    m.onSelect = (id) => {
      const g = useUI.getState().game;
      if (!g) return;
      fromMap.current = true;
      if (!id) { useUI.getState().set({ sel: null }); return; }
      const d = g.deals.find((x) => x.parcelId === id && x.phase !== 'dead');
      useUI.getState().set({ sel: d ? { kind: 'deal', id: d.id } : { kind: 'parcel', id }, panel: null });
    };
    const s = useUI.getState();
    if (s.game) m.setView({ game: s.game, visible: new Set(S.visibleParcels(s.game).map((p) => p.id)) });
    return () => m.destroy();
  }, [flat]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!game) { m.setView({ game: null }); return; }
    const selParcel = sel ? (sel.kind === 'parcel' ? sel.id : game.deals.find((d) => d.id === sel.id)?.parcelId ?? null) : null;
    const pulse = game.deals.length === 0 && !sel ? 'bluemound' : null;
    m.setView({ game, selParcel, overlay, visible: new Set(S.visibleParcels(game).map((p) => p.id)), pulse });
  }, [game, rev, sel, overlay, flat]);

  // center the map on a deal picked from the pipeline or a panel
  useEffect(() => {
    if (sel && !fromMap.current) { const g = useUI.getState().game; const pid = sel.kind === 'parcel' ? sel.id : g?.deals.find((d) => d.id === sel.id)?.parcelId; if (pid) map.current?.focusParcel(pid); }
    fromMap.current = false;
  }, [sel?.id]);

  return (
    <>
      <canvas key={flat ? "2d" : "3d"} ref={ref} className="absolute inset-0 h-full w-full touch-none" style={{ filter: dim ? 'blur(3px) saturate(.9)' : undefined }} aria-label="Isometric map of the Dallas-Fort Worth area" />
      {!dim && (
        <div className="glass absolute bottom-[124px] left-[92px] z-10 flex flex-wrap items-center gap-1 px-2 py-1.5">
          <span className="eyebrow px-1.5">Overlay</span>
          {OVERLAYS.map((o) => (
            <button key={o.id} type="button" aria-pressed={overlay === o.id} onClick={() => set({ overlay: o.id })} className={`rounded-md px-2 py-1 text-[12.5px] font-medium ${overlay === o.id ? 'bg-ink text-white' : 'text-ink2 hover:bg-black/8'}`}>{o.label}</button>
          ))}
          {LEGEND[overlay].length > 0 && <span className="ml-1 flex items-center gap-2.5 border-l border-line pl-2.5 text-[12px]">{LEGEND[overlay].map(([c, l]) => <span key={l} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}</span>}
          <span className="ml-1 flex gap-1 border-l border-line pl-2">
            <Btn small kind="ghost" onClick={() => map.current?.zoomBy(1.25)} title="Zoom in">＋</Btn>
            <Btn small kind="ghost" onClick={() => map.current?.zoomBy(0.8)} title="Zoom out">－</Btn>
            {is3d && <>
              <Btn small kind="ghost" onClick={() => (map.current as Map3D).rotateBy(0.4)} title="Rotate left (Q)">⟲</Btn>
              <Btn small kind="ghost" onClick={() => (map.current as Map3D).rotateBy(-0.4)} title="Rotate right (E)">⟳</Btn>
              <Btn small kind="ghost" onClick={() => (map.current as Map3D).tiltBy(0.15)} title="Tilt toward the horizon">⤓</Btn>
              <Btn small kind="ghost" onClick={() => (map.current as Map3D).tiltBy(-0.15)} title="Tilt toward overhead">⤒</Btn>
            </>}
          </span>
          {is3d && sky && gfx.cycle && <button type="button" title="Time of day on the map. Click to jump ahead three hours." onClick={() => { (map.current as Map3D).skipTime(3); setSky((map.current as Map3D).status()); }} className="num ml-1 rounded-md border-l border-line px-2.5 py-1 text-[12.5px] font-medium text-ink2 hover:bg-black/8">{sky}</button>}
        </div>
      )}
    </>
  );
}
