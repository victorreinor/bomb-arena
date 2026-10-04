import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLOOR, GRID_W, MAPS, MAX_MEMBERS, floorCode, getMap, mapSeats, wrap, type MapDef } from "@bomberman/engine";
import { ACCENT_INK } from "../game/colors";
import { mapInfo } from "../game/mapInfo";
import { TILE_PX, TILE_THEMES, drawFloor, drawFloorCell, drawTile, floorSheetUrl, load, loaded, tileName, tileSheetUrl } from "../game/sprites";

/** Counts shown under the preview. */
function mapStats(map: MapDef) {
  const inner = map.rows.slice(1, -1).map((r) => r.slice(1, -1)).join("");
  return {
    pillars: [...inner].filter((c) => c === "#").length,
    bricks: Math.round(map.softDensity * 100),
  };
}

/**
 * The map's layout drawn with its own tiles: pillars, bricks (faded: they are random each match), crates,
 * special floors and the four starting corners.
 */
export function MapPreview({ map }: { map: MapDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const url = tileSheetUrl(mapInfo(map.id).theme);
  const [tiles, setTiles] = useState<HTMLImageElement | null>(() => loaded(url) ?? null);
  const [floors, setFloors] = useState<HTMLImageElement | null>(() => loaded(floorSheetUrl) ?? null);
  useEffect(() => {
    load(url).then(setTiles, () => setTiles(null));
  }, [url]);
  useEffect(() => {
    load(floorSheetUrl).then(setFloors, () => setFloors(null));
  }, []);

  // drawn before the first paint, so a preview sliding in never shows up blank
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !tiles) return;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    map.rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === "#") return drawTile(g, tiles, "hard", x, y);
        drawTile(g, tiles, tileName("floor", "#+=".includes(map.rows[y - 1]?.[x] ?? "."), x, y), x, y);
        const code = floorCode(ch);
        if (floors && ch === "=") drawFloorCell(g, floors, "crate", x, y);
        else if (floors && code !== FLOOR.PLAIN) drawFloor(g, floors, code, x, y, 0, code === FLOOR.VENT ? 0.6 : 0);
        else if (ch === "+" || ch === "o") {
          g.globalAlpha = ch === "o" ? 0.55 : 1;
          drawTile(g, tiles, "soft", x, y);
          g.globalAlpha = 1;
        } else if (ch >= "1" && ch <= "4") {
          g.fillStyle = "#ffd23a";
          g.strokeStyle = ACCENT_INK;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x * TILE_PX + 8, y * TILE_PX + 8, 4.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }),
    );
  }, [map, tiles, floors]);

  return (
    <canvas
      ref={ref}
      className="map-preview"
      width={map.rows[0].length * TILE_PX}
      height={map.rows.length * TILE_PX}
      // a smaller arena shows smaller, next to the full-size ones
      style={{ width: `${(100 * map.rows[0].length) / GRID_W}%` }}
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
  const seats = mapSeats(map);
  const go = (step: number) => onSelect(MAPS[wrap(index + step, MAPS.length)].id);

  // every map's tiles, ready before anyone flips to it
  useEffect(() => TILE_THEMES.forEach((theme) => void load(tileSheetUrl(theme)).catch(() => {})), []);

  // which way the carousel turned, so the new map slides in from that side (React's "previous value in state")
  const [shown, setShown] = useState({ index, turn: "next" as "next" | "prev" });
  let turn = shown.turn;
  if (shown.index !== index) {
    turn = wrap(index - shown.index, MAPS.length) <= MAPS.length / 2 ? "next" : "prev";
    setShown({ index, turn });
  }

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
        <div key={map.id} className={`map-slide ${turn}`}>
          <MapPreview map={map} />
        </div>
        {editable && (
          <button type="button" className="map-arrow" onClick={() => go(1)} aria-label="Próximo mapa">
            ▶
          </button>
        )}
      </div>
      <div key={map.id} className="map-text">
        <div className="map-caption">
          <b>{map.name}</b> <span className="tag">{info.level}</span>
          {seats < MAX_MEMBERS && <span className="tag"> · só {seats} jogadores</span>}
          {!editable && <span className="muted"> · escolhido pelo anfitrião</span>}
        </div>
        <p className="map-info">
          {info.desc} <span className="muted">Pilares: {stats.pillars} · tijolos em ~{stats.bricks}% das casas livres.</span>
        </p>
      </div>
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
