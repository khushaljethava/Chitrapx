import type { CSSProperties } from 'react';

/**
 * A simulated phone status bar laid over the top of the screen. Sized with container query
 * units so it scales with the screen. theme 'dark' = dark text and icons (for light screenshots).
 */
export function StatusBar({ platform, theme, background, color, time, heightPct }: {
  platform: 'ios' | 'android'; theme: 'light' | 'dark'; background: 'transparent' | 'solid'; color?: string; time: string; heightPct: number;
}) {
  const ink = theme === 'dark' ? '#000000' : '#ffffff';
  // cq units resolve against an ancestor container, never the element itself, so the content sits in a child of the size container.
  const box: CSSProperties = {
    position: 'absolute', top: 0, left: 0, right: 0, height: `${heightPct}%`, zIndex: 2, containerType: 'size',
    background: background === 'solid' ? color ?? '#ffffff' : 'transparent',
  };
  const row: CSSProperties = {
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: platform === 'ios' ? '0 7% 0 9%' : '0 5% 0 5%',
    color: ink,
    fontFamily: platform === 'ios' ? '-apple-system, "SF Pro Text", Inter, sans-serif' : 'Roboto, Inter, sans-serif',
    fontWeight: platform === 'ios' ? 600 : 500, fontSize: platform === 'ios' ? '38cqh' : '34cqh', lineHeight: 1,
  };
  const icon: CSSProperties = { height: '32cqh', width: 'auto', display: 'block' };
  return (
    <div style={box} data-status-bar={platform} aria-hidden>
      <div style={row}>
      <span>{time}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8cqh' }}>
        {platform === 'ios' ? (
          <>
            <svg viewBox="0 0 18 12" style={icon} fill={ink}>{[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4.7} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="0.8" />)}</svg>
            <svg viewBox="-2 0 20 12" style={icon} fill={ink}><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0L8 11.5Zm-4.2-4.3L2.1 5.5a8.4 8.4 0 0 1 11.8 0l-1.7 1.7a6 6 0 0 0-8.4 0ZM.4 3.8-1.3 2.1a13 13 0 0 1 18.6 0l-1.7 1.7A10.7 10.7 0 0 0 .4 3.8Z" /></svg>
            <svg viewBox="0 0 27 12" style={icon}><rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke={ink} strokeOpacity="0.4" /><rect x="2" y="2" width="19" height="8" rx="2" fill={ink} /><rect x="24" y="4" width="2" height="4" rx="1" fill={ink} fillOpacity="0.4" /></svg>
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 12" style={icon} fill={ink}><path d="M8 12 0 3.6a11.6 11.6 0 0 1 16 0L8 12Z" /></svg>
            <svg viewBox="0 0 12 12" style={icon} fill={ink}><path d="M12 0v12H0L12 0Z" /></svg>
            <svg viewBox="0 0 8 14" style={{ ...icon, height: '40cqh' }} fill={ink}><rect x="2.5" y="0" width="3" height="1.5" /><rect x="0" y="1.5" width="8" height="12.5" rx="1.2" /></svg>
          </>
        )}
      </span>
      </div>
    </div>
  );
}
