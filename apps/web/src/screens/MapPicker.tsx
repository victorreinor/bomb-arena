import { useEffect, useRef, useState } from "react";
import { MAPS, getMap, wrap, type MapDef } from "@bomberman/engine";
import { mapInfo } from "../game/mapInfo";
import { TILE_COL, TILE_PX, load } from "../game/sprites";

/** Counts shown under the preview. */
function mapStats(map: MapDef) {
  const inner = map.rows.slice(1, -1).map((r) => r.slice(1, -1)).join("");
  return {
    pillars: [...inner].filter((c) => c === "#").length,
    bricks: Math.round(map.softDensity * 100),
  };
}

/**
 * The map's layout drawn with the game's own tiles: stone pillars, bricks (faded: they are random
 * each match) and the four starting corners.
 */
export function MapPreview({ map }: { map: MapDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    load("/sprites/tiles.png").then(setTiles, () => setTiles(null));
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !tiles) return;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const tile = (col: number, x: number, y: number) =>
      g.drawImage(tiles, col * TILE_PX, 0, TILE_PX, TILE_PX, x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
    map.rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === "#") return tile(TILE_COL.hard, x, y);
        tile(TILE_COL.floor, x, y);
        if (ch === "+" || ch === "o") {
          g.globalAlpha = ch === "o" ? 0.55 : 1;
          tile(TILE_COL.soft, x, y);
          g.globalAlpha = 1;
        } else if (ch >= "1" && ch <= "4") {
          g.fillStyle = "#ffd23a";
          g.strokeStyle = "#1a1204";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x * TILE_PX + 8, y * TILE_PX + 8, 4.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }),
    );
  }, [map, tiles]);

  return (
    <canvas
      ref={ref}
      className="map-preview"
      width={map.rows[0].length * TILE_PX}
      height={map.rows.length * TILE_PX}
      aria-label={`Prévia do mapa ${map.name}`}
    />
  );
}

/**
 * Map carousel: one big preview at a time. The host flips through with the arrows (or the dots,
 * or the keyboard arrows while it has focus); everyone else sees the map the host picked.
 */
export function MapPicker({ selected, editable, onSelect }: { selected: string; editable: boolean; onSelect: (id: string) => void }) {
  const map = getMap(selected);
  const index = Math.max(0, MAPS.findIndex((m) => m.id === map.id));
  const info = mapInfo(map.id);
  const stats = mapStats(map);
  const go = (step: number) => onSelect(MAPS[wrap(index + step, MAPS.length)].id);

  return (
    <div
      className="map-carousel"
      role="group"
      aria-label="Mapa"
      tabIndex={editable ? 0 : -1}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
      }}
    >
      <div className="map-stage">
        {editable && (
          <button type="button" className="map-arrow" onClick={() => go(-1)} aria-label="Mapa anterior">
            ◀
          </button>
        )}
        <MapPreview map={map} />
        {editable && (
          <button type="button" className="map-arrow" onClick={() => go(1)} aria-label="Próximo mapa">
            ▶
          </button>
        )}
      </div>
      <div className="map-caption">
        <b>{map.name}</b> <span className="tag">{info.level}</span>
        {!editable && <span className="muted"> · escolhido pelo anfitrião</span>}
      </div>
      <p className="map-info">
        {info.desc} <span className="muted">Pilares: {stats.pillars} · tijolos em ~{stats.bricks}% das casas livres.</span>
      </p>
      {editable && (
        <div className="map-dots" role="radiogroup" aria-label="Escolher mapa">
          {MAPS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === map.id}
              aria-label={m.name}
              title={m.name}
              className={m.id === map.id ? "selected" : ""}
              onClick={() => onSelect(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
