'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';


import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Match } from '../domain/tournament';

type Connection = { source: string; target: string; path: string; advanced: boolean };
type Geometry = { width: number; height: number; connections: Connection[] };

export default function KnockoutBracket({ matches, renderMatch }: {
  matches: Match[];
  renderMatch: (match: Match) => ReactNode;
}) {useLanguage();
  const root = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry>({ width: 0, height: 0, connections: [] });
  const geometryKey=matches.map(m=>[m.id,m.round,m.position,m.winner,m.sources]).map(v=>JSON.stringify(v)).join('|');
  const latestMatches=useRef(matches);latestMatches.current=matches;
  const rounds = [...new Set(matches.map(match => match.round))].sort((a, b) => a - b);

  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    let timer:ReturnType<typeof setTimeout>|undefined;

    function measure() {
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const cards = new Map(Array.from(container.querySelectorAll<HTMLElement>('[data-bracket-match]'))
        .map(element => [element.dataset.bracketMatch!, element.getBoundingClientRect()]));
      const measuredMatches=latestMatches.current;
      const byId = new Map(measuredMatches.map(match => [match.id, match]));
      const connections: Connection[] = [];

      for (const target of measuredMatches) {
        const targetBounds = cards.get(target.id);
        if (!targetBounds) continue;
        for (const source of target.sources) {
          if (source.kind !== 'winner') continue;
          const sourceBounds = cards.get(source.id);
          if (!sourceBounds) continue;
          const x1 = sourceBounds.right - bounds.left;
          const y1 = sourceBounds.top + sourceBounds.height / 2 - bounds.top;
          const x2 = targetBounds.left - bounds.left;
          const y2 = targetBounds.top + targetBounds.height / 2 - bounds.top;
          const junction = (x1 + x2) / 2;
          connections.push({
            source: source.id,
            target: target.id,
            path: `M ${x1} ${y1} H ${junction} V ${y2} H ${x2}`,
            advanced: !!byId.get(source.id)?.winner,
          });
        }
      }

      const next = { width: bounds.width, height: bounds.height, connections };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }

    function schedule() {
      if(timer)clearTimeout(timer);
      timer=setTimeout(measure,80);
    }

    // Card heights can change when long names wrap or a walkover notice appears.
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    container.querySelectorAll('[data-bracket-match]').forEach(element => observer.observe(element));
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if(timer)clearTimeout(timer);
    };
  }, [geometryKey]);

  return <div className="bracket-scroll">
    <div className="bracket" ref={root}>
      {geometry.width > 0 && <svg
        className="bracket-connectors"
        aria-hidden="true"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      >
        {geometry.connections.map(connection => <path
          key={`${connection.source}-${connection.target}`}
          d={connection.path}
          data-source-match={connection.source}
          data-target-match={connection.target}
          className={connection.advanced ? 'advanced' : undefined}
        />)}
      </svg>}
      {rounds.map(round => {
        const list = matches.filter(match => match.round === round).sort((a, b) => a.position - b.position);
        return <section className="bracket-round" key={round}>
          <h3>{list.length === 1 ? translateUi("Finale") : list.length === 2 ? translateUi("Halbfinale") : list.length === 4 ? translateUi("Viertelfinale") : translateUi("Runde {0}",round)}
            <span>{list.length} {list.length === 1 ? translateUi("Paarung") : translateUi("Paarungen")}</span>
          </h3>
          <div className="round-matches">
            {list.map(match => <div className="bracket-match" key={match.id} data-bracket-match={match.id}>
              {renderMatch(match)}
            </div>)}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
