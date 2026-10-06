import type { ReactNode } from "react";
import { ABILITY_FIELDS, type AbilityKind, type Player } from "@bomb-arena/engine";
import { COLOR_CSS } from "./colors";
import { ItemIcon, PetIcon } from "./ItemIcon";
import { DISEASE_NAME, PET_INFO } from "./items";
import { TEAM_NAMES, teamStyle } from "./teams";

const ABILITIES = Object.entries(ABILITY_FIELDS) as [AbilityKind, (typeof ABILITY_FIELDS)[AbilityKind]][];

/** Numbers for the basics plus an icon for every special the player owns. */
export function PlayerStats({ p }: { p: Player }) {
  return (
    <span className="stats">
      <span title="Bombas">💣{p.bombsMax}</span>
      <span title="Alcance">🔥{p.range}</span>
      <span title="Velocidade">👟{p.speedLevel}</span>
      {p.pet && (
        <span className="pet-badge" title={`${PET_INFO[p.pet.kind].name}: ${PET_INFO[p.pet.kind].desc}`}>
          <PetIcon kind={p.pet.kind} size={18} />
          <span className="desktop-only">{PET_INFO[p.pet.kind].name}</span>
        </span>
      )}
      {ABILITIES.filter(([, key]) => p[key]).map(([kind]) => (
        <ItemIcon key={kind} kind={kind} size={18} />
      ))}
      {([["line", p.lineCharges], ["mine", p.mineCharges]] as const).map(
        ([kind, charges]) =>
          charges > 0 && (
            <span key={kind} className="line-charges">
              <ItemIcon kind={kind} size={18} />×{charges}
            </span>
          ),
      )}
      {p.disease && (
        <span className="curse" title={`Maldição: ${DISEASE_NAME[p.disease.kind]}`}>
          ☠ <span className="desktop-only">{DISEASE_NAME[p.disease.kind]}</span>
        </span>
      )}
    </span>
  );
}

/**
 * One player's card in the HUD: colour chip, label and stats; outlined if it's `me`, greyed out once
 * eliminated and, in a team match, edged with the team's colour.
 */
export function HudPlayer({ p, label, me = false }: { p: Player; label: ReactNode; me?: boolean }) {
  return (
    <div
      className={`hud-player${p.alive ? "" : " dead"}${me ? " me" : ""}${p.team !== null ? " teamed" : ""}`}
      style={p.team !== null ? teamStyle(p.team) : undefined}
      title={p.team !== null ? TEAM_NAMES[p.team] : undefined}
    >
      <span className="hud-name">
        <span className="hud-chip" style={{ background: COLOR_CSS[p.color] }} />
        <span className="hud-label">{label}</span>
        {!p.alive && p.ghost && <span title="Fantasma: joga bombas da borda">👻</span>}
      </span>
      <PlayerStats p={p} />
    </div>
  );
}
