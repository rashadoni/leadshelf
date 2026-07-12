import { useCallback, useMemo, useRef, useState } from "react"
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SyncBar } from "../../src/components/SyncBar"
import {
  enqueueOrderCreate,
  getStore,
  listLocalCatalogProducts,
  listQueuedOrders,
  listVisits,
  type LocalCatalogProductRow,
} from "../../src/db/local-store"
import type { VisitRow } from "../../src/sync/ports"
import { useSync } from "../../src/sync/sync-context"
import { t, useLocale } from "../../src/i18n"
import { colors, cardShadow, radii } from "../../src/theme"

const MAX_ORDER_LINES = 200

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function isLocalVisit(visit: VisitRow): boolean {
  return visit.id.startsWith("local-")
}

export default function OrderCreateScreen() {
  useLocale()
  const params = useLocalSearchParams<{ storeId?: string | string[]; visitId?: string | string[]; sourceOpId?: string | string[] }>()
  const storeId = firstParam(params.storeId)
  const requestedVisitId = firstParam(params.visitId)
  const sourceOpId = firstParam(params.sourceOpId)
  const { sync } = useSync()
  const initializedDraft = useRef(false)
  const [visit, setVisit] = useState<VisitRow | null>(null)
  const [storeName, setStoreName] = useState("")
  const [catalog, setCatalog] = useState<LocalCatalogProductRow[]>([])
  const [query, setQuery] = useState("")
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [validationError, setValidationError] = useState(false)

  const reload = useCallback(() => {
    const visits = listVisits()
    const activeVisit = visits.find((candidate) => (
      candidate.status === "IN_PROGRESS"
      && candidate.storeId === storeId
      && (!requestedVisitId || candidate.id === requestedVisitId)
    )) ?? null
    const products = listLocalCatalogProducts()
    setVisit(activeVisit)
    setStoreName(getStore(storeId)?.name ?? storeId)
    setCatalog(products)

    if (!initializedDraft.current) {
      initializedDraft.current = true
      if (sourceOpId) {
        const sourceOrder = listQueuedOrders().find((order) => order.clientOpId === sourceOpId)
        if (sourceOrder?.storeId === storeId) {
          const availableProductIds = new Set(products.map((product) => product.id))
          setQuantities(Object.fromEntries(
            sourceOrder.lines
              .filter((line) => availableProductIds.has(line.productId))
              .map((line) => [line.productId, line.quantity]),
          ))
        }
      }
    }
  }, [requestedVisitId, sourceOpId, storeId])
  useFocusEffect(reload)

  const selectedProducts = useMemo(
    () => catalog.filter((product) => (quantities[product.id] ?? 0) > 0),
    [catalog, quantities],
  )
  const selectedUnitCount = useMemo(
    () => selectedProducts.reduce((sum, product) => sum + (quantities[product.id] ?? 0), 0),
    [quantities, selectedProducts],
  )
  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return catalog.filter((product) => {
      if (selectedOnly && (quantities[product.id] ?? 0) <= 0) return false
      if (!normalizedQuery) return true
      return [product.name, product.sku, product.barcode, product.brandName]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
    })
  }, [catalog, quantities, query, selectedOnly])

  function setQuantity(productId: string, quantity: number) {
    setValidationError(false)
    setQuantities((current) => {
      const isNewLine = !current[productId] && quantity > 0
      if (isNewLine && Object.keys(current).length >= MAX_ORDER_LINES) return current
      const next = { ...current }
      if (quantity <= 0) delete next[productId]
      else next[productId] = quantity
      return next
    })
  }

  function confirmOrder() {
    if (!visit || selectedProducts.length === 0) return
    const currentVisit = listVisits().find((candidate) => (
      candidate.id === visit.id
      && candidate.storeId === visit.storeId
      && candidate.status === "IN_PROGRESS"
    ))
    if (!currentVisit) {
      setValidationError(true)
      setVisit(null)
      return
    }

    enqueueOrderCreate({
      clientOpId: `op-${Crypto.randomUUID()}`,
      storeId: currentVisit.storeId,
      // local-* существует только в SQLite и не является server visitId.
      visitId: isLocalVisit(currentVisit) ? null : currentVisit.id,
      lines: selectedProducts.map((product) => ({
        productId: product.id,
        quantity: quantities[product.id] ?? 1,
      })),
    })
    Vibration.vibrate(40)
    void sync()
    router.replace("/(app)/(tabs)/orders" as never)
  }

  const noResults = catalog.length === 0 ? t("noLocalProducts") : t("noMatchingProducts")
  const noResultsHint = catalog.length === 0 ? t("noLocalProductsHint") : undefined
  const atLineLimit = selectedProducts.length >= MAX_ORDER_LINES

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("back")}
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.title}>{t("createOrder")}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{storeName}</Text>
          </View>
        </View>
        <SyncBar />

        {!visit ? (
          <View style={styles.blockedCard}>
            <Text style={styles.blockedTitle}>{t("noActiveVisit")}</Text>
            <Text style={styles.blockedHint}>
              {validationError ? t("activeVisitChanged") : t("noActiveVisitHint")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
            >
              <Text style={styles.primaryButtonText}>{t("back")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.controls}>
              <TextInput
                accessibilityLabel={t("productSearchPlaceholder")}
                value={query}
                onChangeText={setQuery}
                placeholder={t("productSearchPlaceholder")}
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.search}
              />
              <View style={styles.filters}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: !selectedOnly }}
                  onPress={() => setSelectedOnly(false)}
                  style={[styles.filter, !selectedOnly && styles.filterActive]}
                >
                  <Text style={[styles.filterText, !selectedOnly && styles.filterTextActive]}>{t("allProducts")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedOnly }}
                  onPress={() => setSelectedOnly(true)}
                  style={[styles.filter, selectedOnly && styles.filterActive]}
                >
                  <Text style={[styles.filterText, selectedOnly && styles.filterTextActive]}>
                    {t("selectedOnly")} · {selectedProducts.length}
                  </Text>
                </Pressable>
              </View>
              {atLineLimit ? <Text style={styles.limitText}>{t("orderProductLimit")}</Text> : null}
            </View>

            <FlatList
              data={visibleProducts}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={visibleProducts.length === 0 ? styles.emptyList : styles.list}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>{noResults}</Text>
                  {noResultsHint ? <Text style={styles.emptyHint}>{noResultsHint}</Text> : null}
                </View>
              }
              renderItem={({ item }) => {
                const quantity = quantities[item.id] ?? 0
                return (
                  <View style={[styles.productCard, quantity > 0 && styles.productCardSelected]}>
                    <View style={styles.productBody}>
                      <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.productMeta} numberOfLines={1}>
                        {item.sku}{item.brandName ? ` · ${item.brandName}` : ""}
                      </Text>
                    </View>
                    {quantity > 0 ? (
                      <View style={styles.quantityControl}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t("decreaseQuantity")} ${item.name}`}
                          onPress={() => setQuantity(item.id, quantity - 1)}
                          style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
                        >
                          <Text style={styles.quantityButtonText}>−</Text>
                        </Pressable>
                        <Text accessibilityLiveRegion="polite" style={styles.quantityValue}>{quantity}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t("increaseQuantity")} ${item.name}`}
                          onPress={() => setQuantity(item.id, quantity + 1)}
                          style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
                        >
                          <Text style={styles.quantityButtonText}>+</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t("addProduct")} ${item.name}`}
                        disabled={atLineLimit}
                        onPress={() => setQuantity(item.id, 1)}
                        style={({ pressed }) => [
                          styles.addButton,
                          pressed && styles.addPressed,
                          atLineLimit && styles.addDisabled,
                        ]}
                      >
                        <Text style={styles.addButtonText}>{t("addProduct")}</Text>
                      </Pressable>
                    )}
                  </View>
                )
              }}
            />

            <View style={styles.summaryBar}>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryLabel}>{t("selectedOrderSummary")}</Text>
                <Text style={styles.summaryValue}>
                  {selectedProducts.length} {t("orderProductKinds")} · {selectedUnitCount} {t("orderUnits")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={selectedProducts.length === 0}
                onPress={confirmOrder}
                style={({ pressed }) => [
                  styles.confirmButton,
                  pressed && styles.primaryPressed,
                  selectedProducts.length === 0 && styles.confirmDisabled,
                ]}
              >
                <Text style={styles.confirmText}>{t("confirmOrder")}</Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.card,
  },
  backPressed: { backgroundColor: colors.primarySoft },
  backIcon: { color: colors.text, fontSize: 34, lineHeight: 36, marginTop: -2 },
  headerBody: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 1 },
  controls: { paddingHorizontal: 14, paddingTop: 12, gap: 10 },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 14,
    ...cardShadow,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: {
    minHeight: 40,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    paddingHorizontal: 13,
  },
  filterActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  filterTextActive: { color: colors.primaryPressed },
  limitText: { color: colors.warning, fontSize: 12, lineHeight: 17 },
  list: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16, gap: 9 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  emptyState: { alignItems: "center" },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800", textAlign: "center" },
  emptyHint: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: "center" },
  productCard: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...cardShadow,
  },
  productCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  productBody: { flex: 1, minWidth: 0 },
  productName: { color: colors.text, fontSize: 14, fontWeight: "700", lineHeight: 18 },
  productMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  addButton: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 13,
  },
  addPressed: { backgroundColor: colors.border },
  addDisabled: { opacity: 0.45 },
  addButtonText: { color: colors.primaryPressed, fontSize: 11, fontWeight: "800" },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  quantityButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  quantityPressed: { backgroundColor: colors.primarySoft },
  quantityButtonText: { color: colors.primaryPressed, fontSize: 20, fontWeight: "700" },
  quantityValue: { minWidth: 30, color: colors.text, fontSize: 13, fontWeight: "800", textAlign: "center" },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summaryBody: { flex: 1, minWidth: 0 },
  summaryLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  summaryValue: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 2 },
  confirmButton: {
    minHeight: 48,
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
  },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  confirmDisabled: { backgroundColor: colors.disabled },
  confirmText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  blockedCard: {
    alignItems: "center",
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 34,
    borderRadius: radii.card,
    ...cardShadow,
  },
  blockedTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  blockedHint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: "center" },
  primaryButton: {
    minHeight: 46,
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    marginTop: 18,
    paddingHorizontal: 22,
  },
  primaryButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
})
