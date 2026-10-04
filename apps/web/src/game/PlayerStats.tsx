import { ABILITY_FIELDS, type AbilityKind, type Player } from "@bomberman/engine";
import { COLOR_CSS } from "./colors";
import { ItemIcon } from "./ItemIcon";
import { DISEASE_NAME } from "./items";

const ABILITIES = Object.entries(ABILITY_FIELDS) as [AbilityKind, (typeof ABILITY_FIELDS)[AbilityKind]][];

/** Numbers for the basics plus an icon for every special the player owns. */
export function PlayerStats({ p }: { p: Player }) {
  return (
    <span className="stats">
      <span title="Bombas">💣{p.bombsMax}</span>
      <span title="Alcance">🔥{p.range}</span>
      <span title="Velocidade">👟{p.speedLevel}</span>
      {ABILITIES.filter(([, key]) => p[key]).map(([kind]) => (
        <ItemIcon key={kind} kind={kind} size={18} />
      ))}
      {p.lineCharges > 0 && (
        <span className="line-charges">
          <ItemIcon kind="line" size={18} />×{p.lineCharges}
        </span>
      )}
      {p.disease && (
        <span className="curse" title={`Maldição: ${DISEASE_NAME[p.disease.kind]}`}>
          ☠ {DISEASE_NAME[p.disease.kind]}
        </span>
      )}
    </span>
  );
}

/** One player's row in the HUD: colour chip, label and stats; greyed out once eliminated. */
export function HudPlayer({ p, label }: { p: Player; label: string }) {
  return (
    <div className={`hud-player${p.alive ? "" : " dead"}`}>
      <span className="hud-chip" style={{ background: COLOR_CSS[p.color] }} />
      <span>{label}</span>
      <PlayerStats p={p} />
    </div>
  );
}
