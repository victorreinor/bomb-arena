import { useRef, type ReactNode } from "react";
import { CONTROL_HINTS } from "../game/controls";
import { ItemIcon, PetIcon } from "../game/ItemIcon";
import { ITEM_INFO, PET_INFO } from "../game/items";

/** One entry per kind (an item, a pet): its icon, its name and what it does. */
function LegendList<K extends string>({ info, icon }: { info: Record<K, { name: string; desc: string }>; icon: (kind: K) => ReactNode }) {
  return (
    <ul>
      {(Object.keys(info) as K[]).map((kind) => (
        <li key={kind}>
          {icon(kind)}
          <span>
            <b>{info[kind].name}</b>
            <span className="desc">{info[kind].desc}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The lobby's "items, pets and controls": a button that opens them in a modal dialog (Esc, the ✕ or a click
 * outside closes it), so reading them doesn't push the rest of the lobby down.
 */
export function LegendDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className="ghost legend-open" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        📖 Itens, pets e controles
      </button>
      {/* the dialog itself has no padding: a click whose target is the dialog landed on the backdrop */}
      <dialog ref={dialog} className="legend-dialog" aria-labelledby="legend-title" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="legend">
          <header className="legend-header">
            <h2 id="legend-title">Itens, pets e controles</h2>
            <button type="button" className="ghost" aria-label="Fechar" title="Fechar" onClick={close}>
              ✕
            </button>
          </header>

          <h3>Controles</h3>
          <table className="controls-table">
            <thead>
              <tr>
                <th />
                <th>Teclado</th>
                <th>Controle</th>
              </tr>
            </thead>
            <tbody>
              {CONTROL_HINTS.map((c) => (
                <tr key={c.what}>
                  <th>{c.what}</th>
                  <td>{c.keys}</td>
                  <td>{c.pad}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">No celular, o direcional e os botões aparecem na tela.</p>

          <h3>Itens</h3>
          <LegendList info={ITEM_INFO} icon={(kind) => <ItemIcon kind={kind} size={28} />} />

          <h3>Pets (saem do ovo; aguentam um golpe por você)</h3>
          <LegendList info={PET_INFO} icon={(kind) => <PetIcon kind={kind} size={28} />} />
        </div>
      </dialog>
    </>
  );
}
