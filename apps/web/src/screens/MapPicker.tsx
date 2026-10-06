import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLOOR, GRID_H, GRID_W, MAPS, MAX_MEMBERS, RANDOM_MAP, floorCode, getMap, mapSeats, wrap, type MapDef } from "@bomb-arena/engine";
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

/** What the choice of a map drawn at random is called. */
const RANDOM_NAME = "Aleatório";

/** What stands in for a preview when the map is left to chance: a board-shaped card with a question mark. */
function RandomPreview() {
  return (
    <div className="map-preview map-random" style={{ aspectRatio: `${GRID_W} / ${GRID_H}` }} role="img" aria-label="Mapa sorteado a cada partida">
      ?
    </div>
  );
}

/** What the carousel says under a slide: the name, a tag, how many it seats, what it is like and a note in passing. */
interface Slide {
  name: string;
  tag: string;
  seats: number;
  desc: string;
  note: string;
}

function describe(map: MapDef): Slide {
  const info = mapInfo(map.id);
  const stats = mapStats(map);
  return { name: map.name, tag: info.level, seats: mapSeats(map), desc: info.desc, note: `Pilares: ${stats.pillars} · tijolos em ~${stats.bricks}% das casas livres.` };
}

const RANDOM_SLIDE: Slide = {
  name: RANDOM_NAME,
  tag: "Sorteio",
  seats: MAX_MEMBERS,
  desc: "Um mapa sorteado a cada partida, entre os que têm lugar para todos da sala.",
  note: "Nunca o mesmo duas vezes seguidas.",
};

/**
 * Map carousel: one big preview at a time. The host flips through with the arrows (or the dots,
 * or the keyboard arrows while it has focus); everyone else sees the map the host picked. After the maps
 * comes RANDOM_MAP, a map drawn for every match, where the server knows how (`offerRandom`).
 */
export function MapPicker({ selected, offerRandom, editable, onSelect }: {
  selected: string;
  offerRandom: boolean;
  editable: boolean;
  onSelect: (id: string) => void;
}) {
  const choices = [...MAPS.map((m) => m.id), ...(offerRandom ? [RANDOM_MAP] : [])];
  const index = Math.max(0, choices.indexOf(selected)); // an id nobody knows shows as the first map
  const go = (step: number) => onSelect(choices[wrap(index + step, choices.length)]);
  // what the slide shows: the map picked, or the card that stands for any of them
  const map = choices[index] === RANDOM_MAP ? null : getMap(choices[index]);
  const slide = map ? describe(map) : RANDOM_SLIDE;

  // every map's tiles, ready before anyone flips to it
  useEffect(() => TILE_THEMES.forEach((theme) => void load(tileSheetUrl(theme)).catch(() => {})), []);

  // which way the carousel turned, so the new map slides in from that side (React's "previous value in state")
  const [shown, setShown] = useState({ index, turn: "next" as "next" | "prev" });
  let turn = shown.turn;
  if (shown.index !== index) {
    turn = wrap(index - shown.index, choices.length) <= choices.length / 2 ? "next" : "prev";
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
        <div key={choices[index]} className={`map-slide ${turn}`}>
          {map ? <MapPreview map={map} /> : <RandomPreview />}
        </div>
        {editable && (
          <button type="button" className="map-arrow" onClick={() => go(1)} aria-label="Próximo mapa">
            ▶
          </button>
        )}
      </div>
      <div key={choices[index]} className="map-text">
        <div className="map-caption">
          <b>{slide.name}</b> <span className="tag">{slide.tag}</span>
          {slide.seats < MAX_MEMBERS && <span className="tag"> · só {slide.seats} jogadores</span>}
          {!editable && <span className="muted"> · escolhido pelo anfitrião</span>}
        </div>
        <p className="map-info">
          {slide.desc} <span className="muted">{slide.note}</span>
        </p>
      </div>
      {editable && (
        <div className="map-dots" role="radiogroup" aria-label="Escolher mapa">
          {choices.map((id, i) => {
            const name = id === RANDOM_MAP ? RANDOM_NAME : getMap(id).name;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={i === index}
                aria-label={name}
                title={name}
                className={`${i === index ? "selected" : ""}${id === RANDOM_MAP ? " random" : ""}`}
                onClick={() => onSelect(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
