'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/icons';

/* ─────────────────────────────────────────────────────────────────────────────
   The organisation chart's canvas.

   The tree itself is rendered on the server — it is the plan, and the plan is
   data. What has to happen in the browser is the part that is about looking:
   dragging the canvas around, zooming with the wheel, and fitting the whole
   chart into the frame the first time it appears.

   The zoom is deliberately not in the URL. It is a property of how somebody is
   reading the chart at this second, not of what they are looking at, and a
   shared link should open on the same chart rather than at somebody else's
   scroll position.
   ───────────────────────────────────────────────────────────────────────────*/

export function OrgCanvas({ deptKey, title, children, hint, legend }: {
  deptKey: string; title: string; children: React.ReactNode;
  hint: React.ReactNode; legend: React.ReactNode;
}) {
  const view = React.useRef<HTMLDivElement | null>(null);
  const stage = React.useRef<HTMLDivElement | null>(null);
  const [z, setZ] = React.useState(1);
  const [pos, setPos] = React.useState({ x: 0, y: 12 });
  const fitted = React.useRef<string | null>(null);

  const fit = React.useCallback(() => {
    const v = view.current, st = stage.current;
    if (!v || !st) return;
    const w = st.scrollWidth, h = st.scrollHeight;
    if (!w || !h) return;
    const next = Math.min(1.4, Math.max(0.2,
      Math.min((v.clientWidth - 32) / w, (v.clientHeight - 48) / h)));
    const rounded = Math.round(next * 100) / 100;
    setZ(rounded);
    setPos({ x: Math.max(0, (v.clientWidth - w * rounded) / 2), y: 12 });
  }, []);

  /* Fit once per chart: changing department refits, panning does not. */
  React.useEffect(() => {
    if (fitted.current === deptKey) return;
    fitted.current = deptKey;
    const t = setTimeout(fit, 30);
    return () => clearTimeout(t);
  }, [deptKey, fit]);

  React.useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setZ((z0) => {
        const next = Math.min(2.5, Math.max(0.2, z0 * (e.deltaY < 0 ? 1.1 : 0.9)));
        setPos((p) => ({ x: px - (px - p.x) * (next / z0), y: py - (py - p.y) * (next / z0) }));
        return next;
      });
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.onode, button, select, a')) return;
    const v = view.current;
    if (!v) return;
    const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
    v.classList.add('grab');
    const move = (ev: PointerEvent) => setPos({ x: ev.clientX - sx, y: ev.clientY - sy });
    const up = () => {
      v.classList.remove('grab');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  return (
    <section className="card">
      <header className="card-h">
        <span className="ibadge"><Icon name="board" size={15} sw={2} /></span>
        <h3>{title}</h3>
        <div className="act">
          <span className="row tight ozoom">
            <button className="btn icon sm ghost" type="button" aria-label="Zoom out"
              onClick={() => setZ((x) => Math.max(0.2, Math.round(x * 90) / 100))}>
              <Icon name="minus" size={14} />
            </button>
            <b className="num ozl">{Math.round(z * 100)}%</b>
            <button className="btn icon sm ghost" type="button" aria-label="Zoom in"
              onClick={() => setZ((x) => Math.min(2.5, Math.round(x * 110) / 100))}>
              <Icon name="plus" size={14} />
            </button>
            <button className="btn sm ghost" type="button" onClick={fit}>Fit</button>
            <button className="btn sm ghost" type="button"
              onClick={() => { setZ(1); setPos({ x: 0, y: 12 }); }}>100%</button>
            <button className="btn sm ghost" data-act="data.export" data-v="positions">
              <Icon name="dl" size={13} /> CSV
            </button>
          </span>
        </div>
      </header>
      <div className="card-b flush">
        <div className="oview" id="oview" data-dept={deptKey} ref={view} onPointerDown={onPointerDown}>
          <div className="ostage" id="ostage" ref={stage}
            style={{ transform: `translate(${pos.x}px,${pos.y}px) scale(${z})` }}>
            {children}
          </div>
          <div className="ohint"><Icon name="drag" size={12} /> {hint}</div>
        </div>
      </div>
      <footer className="card-f">{legend}</footer>
    </section>
  );
}
