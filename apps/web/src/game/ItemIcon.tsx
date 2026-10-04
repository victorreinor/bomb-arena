import type { PowerUpKind } from "@bomberman/engine";
import { ITEM_COL, ITEM_COUNT, ITEM_INFO } from "./items";

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
