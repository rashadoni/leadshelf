// Категория из 1С приходит путем: "OTC / Обезболивающие / Таблетки".
// normalizedPath — natural key дерева (Category.@@unique[org, normalizedPath]).

export interface CategoryPath {
  /** Отображаемые имена сегментов (регистр сохранен). */
  segments: string[]
  /** lowercase-путь для natural key: "otc/обезболивающие/таблетки". */
  normalizedPath: string
  /** normalizedPath каждого уровня: ["otc", "otc/обезболивающие", ...]. */
  levelPaths: string[]
}

export function parseCategoryPath(raw: string): CategoryPath | null {
  const segments = raw
    .split("/")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0)
  if (segments.length === 0) return null

  const levelPaths: string[] = []
  let acc = ""
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg.toLowerCase()}` : seg.toLowerCase()
    levelPaths.push(acc)
  }
  return { segments, normalizedPath: levelPaths[levelPaths.length - 1]!, levelPaths }
}
