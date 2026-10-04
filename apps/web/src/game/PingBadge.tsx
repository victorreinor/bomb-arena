/**
 * Round trips from here on look yellow, then red. The server sits outside South America, so about 140 ms
 * from Brazil is the normal case (and the client's prediction hides it for your own bomber).
 */
const FAIR_MS = 180;
const POOR_MS = 300;

/** The round trip to the server, coloured by how it plays; nothing until it has been measured. */
export function PingBadge({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  const level = ms < FAIR_MS ? "good" : ms < POOR_MS ? "fair" : "poor";
  return (
    <span className={`ping ${level}`} title="Tempo de ida e volta até o servidor">
      📶 {ms} ms
    </span>
  );
}
