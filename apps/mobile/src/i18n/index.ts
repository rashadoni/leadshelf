// Пилотный i18n без зависимостей: az (default) / ru, переключатель на логине.
import { useSyncExternalStore } from "react"

const DICT = {
  az: {
    appName: "LeadShelf",
    login: "Daxil ol",
    orgSlug: "Şirkət kodu",
    employeeCode: "Əməkdaş kodu",
    pin: "PIN",
    loginError: "Kod və ya PIN yanlışdır",
    tasks: "Tapşırıqlar",
    noTasks: "Tapşırıq yoxdur. Aşağı çəkib yeniləyin.",
    due: "Müddət",
    start: "Başla",
    takePhoto: "Foto çək",
    photoQueued: "Foto növbəyə əlavə edildi",
    comment: "Şərh",
    commentPlaceholder: "Şərh və ya problem yazın",
    sendComment: "Şərhi göndər",
    commentQueued: "Şərh növbəyə əlavə edildi",
    status_NEW: "Yeni",
    status_IN_PROGRESS: "İcradadır",
    status_PHOTO_SUBMITTED: "Foto göndərilib",
    status_COMPLETED: "Tamamlanıb",
    status_EXPIRED: "Vaxtı keçib",
    status_EMPTY: "Boş",
    syncIdle: "Sinxron",
    syncOffline: "Oflayn",
    syncError: "Sinxron xətası",
    syncRunning: "Sinxronlaşır...",
    syncRetry: "Təkrar",
    pendingOps: "növbədə",
    upgradeTitle: "Yeniləmə lazımdır",
    upgradeBody: "Tətbiqin bu versiyası köhnəlib. Yeni versiyanı quraşdırın.",
    logout: "Çıxış",
    planogram: "Planoqram",
    productDetail: "Məhsul detalı",
    productList: "Məhsullar",
    shelf: "Rəf",
    dimensions: "Ölçü",
    facings: "Feysinqlər",
    units: "Ədəd",
    barcode: "Barkod",
    conflictNote: "Server statusu fərqlidir — yenilənib",
  },
  ru: {
    appName: "LeadShelf",
    login: "Войти",
    orgSlug: "Код компании",
    employeeCode: "Код сотрудника",
    pin: "PIN",
    loginError: "Неверный код или PIN",
    tasks: "Задачи",
    noTasks: "Задач нет. Потяните вниз для обновления.",
    due: "Срок",
    start: "Начать",
    takePhoto: "Сделать фото",
    photoQueued: "Фото добавлено в очередь",
    comment: "Комментарий",
    commentPlaceholder: "Напишите комментарий или проблему",
    sendComment: "Отправить комментарий",
    commentQueued: "Комментарий добавлен в очередь",
    status_NEW: "Новая",
    status_IN_PROGRESS: "В работе",
    status_PHOTO_SUBMITTED: "Фото отправлено",
    status_COMPLETED: "Выполнена",
    status_EXPIRED: "Просрочена",
    status_EMPTY: "Пустая",
    syncIdle: "Синхронизировано",
    syncOffline: "Офлайн",
    syncError: "Ошибка синка",
    syncRunning: "Синхронизация...",
    syncRetry: "Повторить",
    pendingOps: "в очереди",
    upgradeTitle: "Нужно обновление",
    upgradeBody: "Эта версия приложения устарела. Установите новую.",
    logout: "Выход",
    planogram: "Планограмма",
    productDetail: "Детали товара",
    productList: "Товары",
    shelf: "Полка",
    dimensions: "Размер",
    facings: "Фейсинги",
    units: "Штук",
    barcode: "Штрихкод",
    conflictNote: "Статус на сервере отличается — обновлено",
  },
} as const

export type Locale = keyof typeof DICT
export type MessageKey = keyof (typeof DICT)["az"]

let current: Locale = "az"
const listeners = new Set<() => void>()

export function setLocale(l: Locale) {
  current = l
  for (const fn of listeners) fn()
}
export function getLocale(): Locale {
  return current
}

export function t(key: MessageKey): string {
  return DICT[current][key] ?? key
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}
