/**
 * ProCyclingStats: nur Links und Einfügen. Die PCS-Seite öffnet in einem eigenen Fenster
 * namens „pcs“, das bei jedem Klick wiederverwendet wird (mit deiner Anmeldung und allen
 * Pro-Funktionen). Rechtsklick → „Link in Split View öffnen“ legt sie in Chrome direkt neben
 * das Center. Kein automatischer Abruf, kein Einbetten (PCS-Nutzungsbedingungen).
 */
export function openPcs(url: string, focus = true) {
  const w = window.open(url, 'pcs');
  if (w) { try { w.opener = null; } catch { /* egal */ } if (focus) w.focus(); }
  return !!w;
}

export function PcsLink({ url, children = 'PCS', className = 'btn small pcs', title }: { url: string; children?: React.ReactNode; className?: string; title?: string }) {
  return (
    <a href={url} target="pcs" className={className} title={title ?? 'Auf ProCyclingStats öffnen (immer im selben PCS-Fenster). Tipp: Rechtsklick → „Link in Split View öffnen“.'}
      onClick={(e) => { if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); openPcs(url); } }}
      style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
      {children} ↗
    </a>
  );
}
