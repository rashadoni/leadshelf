# LeadShelf UI semantic vocabulary

Статус: принят 2026-07-10. Этот документ согласует смысл цветов и
компонентных паттернов между mobile и web, но не создаёт общий runtime
пакет и не связывает их release cycles.

## Семантические роли

| Роль | Mobile (`src/theme.ts`) | Web (`globals.css` / Tailwind) | Назначение |
|---|---|---|---|
| `primary` | `#6366F1`, pressed `#4F46E5` | indigo-600, hover indigo-700 | главное действие, текущий раздел или выбранный фильтр |
| `success` | `#16A34A`, soft `#E9F8EF` | green-600, green-50 | завершённый визит, подтверждённый результат |
| `warning` | `#B45309`, soft `#FEF3C7` | amber-700, amber-50 | pending review, задержка или обратимое внимание |
| `danger` | `#EF4444`, soft `#FEE2E2` | red-600, red-50 | destructive action, rejected или блокирующая ошибка |
| `surface` | `card #FFFFFF`, `bg #F4F4F6` | white, neutral-50 | карточки и общий canvas |

Web CSS variables `--ls-*` фиксируют эти роли для нетипичных компонентов;
обычные экраны используют эквивалентные Tailwind tokens. Тёмный neutral
сохраняется для текста, фото/видео и плотных технических поверхностей, но
не обозначает primary action.

## Компонентные паттерны

- Primary button: indigo fill, white label, 40–44 px touch target, visible
  focus ring, loading state и disabled cursor/opacity.
- Secondary button: white surface, neutral border, neutral label; destructive
  secondary action получает red border/text, а не сплошной primary fill.
- Field: white surface, neutral border, явный label/accessible name и indigo
  focus ring. Ошибка объявляется через `role=alert` рядом с полем или группой.
- Status pill: только статусный цвет; статус не используется как кнопка.
  Pending — amber, success — green, rejected/error — red, neutral terminal — gray.
- Card: mobile использует `colors.card + radii.card + cardShadow`; web — white
  surface, neutral border и `rounded-xl` без тяжёлой декоративной тени.
- Empty state: короткий заголовок, объяснение причины и не более одного
  релевантного recovery/primary action. Пустота не маскирует loading/error.

## Проверка применения

Execution surfaces (`Маршрут`, Field Force, задачи, review, заказы) используют
indigo для primary/current selection и одинаковую success/warning/danger
семантику. Camera, scanner и proof viewer остаются тёмными по функциональной
причине и не переводятся на светлую surface-роль.
