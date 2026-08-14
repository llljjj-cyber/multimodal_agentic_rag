import { Box, Grid2x2 } from "lucide-react";

export type WarehouseView = "spatial" | "grid";

type Props = {
  value: WarehouseView;
  onChange: (view: WarehouseView) => void;
  /** canvas = 3D 画布右上角；toolbar = 卡片列表顶栏 */
  variant?: "canvas" | "toolbar";
};

export default function WarehouseViewSwitch({ value, onChange, variant = "canvas" }: Props) {
  return (
    <div
      className={`wh-view-toggle wh-view-toggle--${variant}`}
      data-view={value}
      role="group"
      aria-label="仓库视图"
    >
      <button
        type="button"
        className={value === "spatial" ? "active" : ""}
        onClick={() => onChange("spatial")}
        title="立体空间"
        aria-pressed={value === "spatial"}
        aria-label="立体空间"
      >
        <Box size={15} strokeWidth={1.65} aria-hidden />
      </button>
      <span className="wh-view-toggle-sep" aria-hidden />
      <button
        type="button"
        className={value === "grid" ? "active" : ""}
        onClick={() => onChange("grid")}
        title="资料卡片"
        aria-pressed={value === "grid"}
        aria-label="资料卡片"
      >
        <Grid2x2 size={15} strokeWidth={1.65} aria-hidden />
      </button>
    </div>
  );
}
