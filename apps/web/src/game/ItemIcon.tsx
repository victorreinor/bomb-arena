import { PET_KINDS, type PetKind, type PowerUpKind } from "@bomberman/engine";
import { PET_COLUMNS, PET_ICON_COLUMN } from "./sprites";
import { ITEM_COL, ITEM_COUNT, ITEM_INFO, PET_INFO } from "./items";

/** A power-up icon cut out of the sprite sheet, so the UI matches the game. */
export function ItemIcon({ kind, size = 24 }: { kind: PowerUpKind; size?: number }) {
  return (
    <span
      className="item-icon"
      role="img"
      aria-label={ITEM_INFO[kind].name}
      title={`${ITEM_INFO[kind].name}: ${ITEM_INFO[kind].desc}`}
      style={{
        width: size,
        height: size,
        backgroundSize: `${ITEM_COUNT * size}px ${size}px`,
        backgroundPosition: `${-ITEM_COL[kind] * size}px 0`,
      }}
    />
  );
}

/** A mount, facing the viewer, cut out of pets.png (its icon column). */
export function PetIcon({ kind, size = 24 }: { kind: PetKind; size?: number }) {
  return (
    <span
      className="pet-icon"
      role="img"
      aria-label={PET_INFO[kind].name}
      style={{
        width: size,
        height: size,
        backgroundSize: `${PET_COLUMNS * size}px ${PET_KINDS.length * size}px`,
        backgroundPosition: `${-PET_ICON_COLUMN * size}px ${-PET_KINDS.indexOf(kind) * size}px`,
      }}
    />
  );
}
