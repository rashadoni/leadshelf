// Демо-плейсхолдер упаковки товара. ОДИН источник для двух потребителей:
// seed-demo заливает этот файл в бакет по ключу demoProductImageKey(), а
// media-proxy отдаёт то же изображение как fallback профиля demo. Пока
// источник был один (inline в route), объекта в хранилище не существовало —
// на профиле client картинка отдавала 404, и товар в 2D-планограмме
// отрисовывался пустотой.

export const DEMO_PRODUCT_IMAGE_FILENAME = "demo-pack.svg"

export function demoProductImageKey(organizationId: string, productId: string): string {
  return `products/${organizationId}/${productId}/${DEMO_PRODUCT_IMAGE_FILENAME}`
}

export const DEMO_PRODUCT_PACK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" role="img" aria-label="Demo product package">
  <rect width="640" height="640" fill="#f5f5f4"/>
  <rect x="172" y="82" width="296" height="476" rx="34" fill="#ffffff" stroke="#d4d4d4" stroke-width="8"/>
  <rect x="204" y="124" width="232" height="92" rx="18" fill="#dbeafe"/>
  <rect x="204" y="246" width="232" height="24" rx="12" fill="#d4d4d4"/>
  <rect x="204" y="292" width="176" height="18" rx="9" fill="#e5e7eb"/>
  <rect x="204" y="330" width="214" height="18" rx="9" fill="#e5e7eb"/>
  <circle cx="320" cy="442" r="54" fill="#dcfce7" stroke="#16a34a" stroke-width="8"/>
  <text x="320" y="180" text-anchor="middle" fill="#1d4ed8" font-family="Arial, sans-serif" font-size="34" font-weight="700">SKU</text>
  <text x="320" y="456" text-anchor="middle" fill="#15803d" font-family="Arial, sans-serif" font-size="30" font-weight="700">OTC</text>
</svg>`
