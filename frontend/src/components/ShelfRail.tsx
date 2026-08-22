import { Archive, BookMarked, Inbox, Plus } from "lucide-react";
import type { Shelf } from "../api";

export type ShelfFilter = "all" | "inbox" | string;

type Props = {
  shelves: Shelf[];
  filter: ShelfFilter;
  counts: Record<string, number>;
  onFilterChange: (filter: ShelfFilter) => void;
  onCreateShelf: () => void;
};

export default function ShelfRail({
  shelves,
  filter,
  counts,
  onFilterChange,
  onCreateShelf,
}: Props) {
  return (
    <aside className="shelf-rail" aria-label="资料架">
      <p className="shelf-rail-label">资料架</p>
      <button
        type="button"
        className={`shelf-rail-item${filter === "all" ? " active" : ""}`}
        onClick={() => onFilterChange("all")}
      >
        <Archive size={15} />
        <span>全部资料</span>
        <em>{counts.all ?? 0}</em>
      </button>
      <button
        type="button"
        className={`shelf-rail-item${filter === "inbox" ? " active" : ""}`}
        onClick={() => onFilterChange("inbox")}
      >
        <Inbox size={15} />
        <span>未分类</span>
        <em>{counts.inbox ?? 0}</em>
      </button>
      <div className="shelf-rail-divider" />
      <p className="shelf-rail-label">我的架子</p>
      {shelves.map((shelf) => (
        <button
          key={shelf.id}
          type="button"
          className={`shelf-rail-item${filter === shelf.id ? " active" : ""}`}
          onClick={() => onFilterChange(shelf.id)}
        >
          <BookMarked size={15} />
          <span>{shelf.name}</span>
          <em>{counts[shelf.id] ?? shelf.source_count ?? 0}</em>
        </button>
      ))}
      <button type="button" className="shelf-rail-add" onClick={onCreateShelf}>
        <Plus size={14} /> 新建资料架
      </button>
    </aside>
  );
}
