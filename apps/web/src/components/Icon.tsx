/**
 * Ícones de contorno, 16px, traço 1.5 (um só conjunto, sempre em cinza ao lado de um texto).
 * Desenhados aqui para não depender de biblioteca; acrescente um caminho novo em PATHS.
 */
const PATHS = {
  card: 'M2.5 4h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm-1 3h13M4 9.5h2.5',
  home: 'M3 7.5 8 3l5 4.5V13a.5.5 0 0 1-.5.5h-3v-4h-3v4h-3A.5.5 0 0 1 3 13Z',
  user: 'M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Zm-5 5.5c.4-2.4 2.5-4 5-4s4.6 1.6 5 4',
  shield: 'M8 2 3 4v3.6c0 3 2.1 5.5 5 6.4 2.9-.9 5-3.4 5-6.4V4Z',
  lock: 'M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm1.5 0V5.5a2 2 0 1 1 4 0v2',
  users:
    'M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm-4 5.5c.3-2 1.9-3.3 4-3.3s3.7 1.3 4 3.3m1-9.4a2.25 2.25 0 0 1 0 4.4m1 1.5c1.2.4 2 1.4 2.2 2.8',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  logout: 'M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6m4 9 3-3-3-3m3 3H6',
  menu: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  close: 'm4 4 8 8m0-8-8 8',
  back: 'M10 3.5 5.5 8l4.5 4.5',
  check: 'm3.5 8.5 3 3 6-7',
  dash: 'M4 8h8',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm6.5 1.5-3-3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Marca do produto: um escudo com a inicial, no petróleo da marca. Troque pelo logo do seu projeto. */
export function ProductMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <path d="M12 2 4 5v5.6c0 4.6 3.3 8.6 8 10.4 4.7-1.8 8-5.8 8-10.4V5Z" fill="var(--accent)" />
      <path
        d="M9 15.5v-7l6 7v-7"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
