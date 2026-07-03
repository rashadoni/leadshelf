// Живой 2D-превью (вид спереди). Чистый SVG без канваса: рама + полки.
// Общий для клиентской формы и серверных страниц.

interface Shelf {
  shelfIndex: number
  yMm: number
  thicknessMm: number
}

export function EquipmentPreviewSvg({
  widthMm,
  heightMm,
  shelves,
  maxPx = 320,
}: {
  widthMm: number
  heightMm: number
  shelves: Shelf[]
  maxPx?: number
}) {
  if (widthMm <= 0 || heightMm <= 0) return null
  const k = maxPx / Math.max(widthMm, heightMm)
  const w = widthMm * k
  const h = heightMm * k
  const frame = Math.max(2, 30 * k) // стойки/рама ~30мм

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      className="rounded-md border border-neutral-200 bg-neutral-50"
    >
      {/* рама */}
      <rect x={0} y={0} width={w} height={h} fill="#f5f5f4" stroke="#a8a29e" strokeWidth={1} />
      <rect x={0} y={0} width={frame} height={h} fill="#d6d3d1" />
      <rect x={w - frame} y={0} width={frame} height={h} fill="#d6d3d1" />
      {/* полки: yMm — нижняя кромка от пола, SVG растет вниз */}
      {shelves.map((s) => {
        const shelfH = Math.max(1.5, s.thicknessMm * k)
        const y = h - (s.yMm + s.thicknessMm) * k
        return (
          <rect
            key={s.shelfIndex}
            x={frame}
            y={y}
            width={w - frame * 2}
            height={shelfH}
            fill="#78716c"
          />
        )
      })}
    </svg>
  )
}
