import { useEffect, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { AccountSwitchBlockedError, mobileLogin } from "../../src/api/mobile-client"
import { BrandMark } from "../../src/components/BrandMark"
import { TabIcon } from "../../src/components/TabIcon"
import { tokenStore } from "../../src/auth/token-store"
import { setLocale, t, useLocale } from "../../src/i18n"
import { HttpError } from "../../src/sync/ports-error"
import { colors, radii } from "../../src/theme"
import { IS_LEADDRIVE_FIELD, mobileVariant } from "../../src/config/mobile-variant"
import { useResponsiveLayout } from "../../src/layout/responsive"

export default function LoginScreen() {
  const locale = useLocale()
  const scrollRef = useRef<ScrollView>(null)
  const [orgSlug, setOrgSlug] = useState(mobileVariant.organizationSlug ?? "demo")
  const [email, setEmail] = useState("")
  const [employeeCode, setEmployeeCode] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const layout = useResponsiveLayout()

  // Предзаполняем организацию и код с прошлого входа — не заставляем
  // печатать заново (docs/28 «запомнить меня»).
  useEffect(() => {
    void (async () => {
      const [savedOrg, savedEmail, savedEmployeeCode] = await Promise.all([
        tokenStore.getOrgSlug(),
        tokenStore.getLastEmail(),
        tokenStore.getLastEmployeeCode(),
      ])
      if (savedOrg) setOrgSlug(savedOrg)
      if (savedEmail) setEmail(savedEmail)
      if (savedEmployeeCode) setEmployeeCode(savedEmployeeCode)
    })()
  }, [])

  async function onLogin() {
    setPending(true)
    setError(null)
    try {
      const res = IS_LEADDRIVE_FIELD
        ? await mobileLogin({
            orgSlug: orgSlug.trim().toLowerCase(),
            email: email.trim().toLowerCase(),
            password: pin,
          })
        : await mobileLogin({
            orgSlug: orgSlug.trim().toLowerCase(),
            employeeCode: employeeCode.trim().toUpperCase(),
            pin,
          })
      if (res) {
        router.replace("/(app)/(tabs)" as never)
      } else {
        setError(t(IS_LEADDRIVE_FIELD ? "fieldLoginError" : "loginError"))
      }
    } catch (reason) {
      setError(
        reason instanceof AccountSwitchBlockedError
          ? t("loginPendingAccount", { count: reason.pendingOps + reason.pendingPhotos })
          : reason instanceof HttpError && reason.status === 429
            ? t("loginRateLimit")
            : t("loginNetworkError"),
      )
    } finally {
      setPending(false)
    }
  }

  const identityReady = IS_LEADDRIVE_FIELD ? email.trim() : employeeCode.trim()
  const canSubmit = Boolean(orgSlug.trim() && identityReady && pin && !pending)

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.topbar, layout.isTablet && styles.topbarTablet]}>
            <BrandMark />
            <View style={styles.localeRow}>
          {(["az", "ru"] as const).map((l) => (
            <Pressable
              key={l}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={l === "az" ? t("languageAz") : t("languageRu")}
              accessibilityState={{ selected: locale === l }}
              onPress={() => {
                setLocale(l)
                void tokenStore.setLocale(l)
              }}
              style={[styles.localeBtn, locale === l && styles.localeActive]}
            >
              <Text style={locale === l ? styles.localeTextActive : styles.localeText}>
                {l.toUpperCase()}
              </Text>
            </Pressable>
          ))}
            </View>
          </View>

          <View style={[styles.loginWorkspace, layout.isTablet && styles.loginWorkspaceTablet]}>
            <View style={[styles.intro, layout.isTablet && styles.introTablet]}>
              <Text style={styles.eyebrow}>{t(IS_LEADDRIVE_FIELD ? "fieldOperationsEyebrow" : "operationsEyebrow")}</Text>
              <Text style={[styles.title, layout.isTablet && styles.titleTablet]}>{t("loginTitle")}</Text>
              <Text style={[styles.welcome, layout.isTablet && styles.welcomeTablet]}>{t(IS_LEADDRIVE_FIELD ? "fieldLoginSecureHint" : "loginSecureHint")}</Text>
            </View>

            <View style={[styles.form, layout.isTablet && styles.formTablet]}>
            <View style={styles.field}>
              <View style={styles.labelRow}><View accessible={false} style={styles.stepBadge}><Text style={styles.stepText}>1</Text></View><Text style={styles.label}>{t("orgSlug")}</Text></View>
              <TextInput
                accessibilityLabel={t("orgSlug")}
                style={[styles.input, styles.orgInput]}
                autoCapitalize="none"
                autoCorrect={false}
                value={orgSlug}
                onChangeText={setOrgSlug}
              />
            </View>
            <View style={styles.field}>
              <View style={styles.labelRow}><View accessible={false} style={styles.stepBadge}><Text style={styles.stepText}>2</Text></View><Text style={styles.label}>{IS_LEADDRIVE_FIELD ? t("email") : t("employeeCode")}</Text></View>
              <TextInput
                accessibilityLabel={IS_LEADDRIVE_FIELD ? t("email") : t("employeeCode")}
                accessibilityHint={IS_LEADDRIVE_FIELD ? t("fieldLoginSecureHint") : t("loginSecureHint")}
                style={styles.input}
                autoCapitalize={IS_LEADDRIVE_FIELD ? "none" : "characters"}
                autoCorrect={false}
                autoComplete={IS_LEADDRIVE_FIELD ? "email" : "off"}
                textContentType={IS_LEADDRIVE_FIELD ? "emailAddress" : undefined}
                keyboardType={IS_LEADDRIVE_FIELD ? "email-address" : "default"}
                value={IS_LEADDRIVE_FIELD ? email : employeeCode}
                onChangeText={IS_LEADDRIVE_FIELD ? setEmail : setEmployeeCode}
              />
            </View>
            <View style={styles.field}>
              <View style={styles.labelRow}><View accessible={false} style={styles.stepBadge}><Text style={styles.stepText}>3</Text></View><Text style={styles.label}>{IS_LEADDRIVE_FIELD ? t("password") : t("pin")}</Text></View>
              <TextInput
                accessibilityLabel={IS_LEADDRIVE_FIELD ? t("password") : t("pin")}
                accessibilityHint={IS_LEADDRIVE_FIELD ? t("fieldLoginSecureHint") : t("loginSecureHint")}
                style={styles.input}
                secureTextEntry
                textContentType="password"
                autoComplete={IS_LEADDRIVE_FIELD ? "current-password" : "off"}
                keyboardType={IS_LEADDRIVE_FIELD ? "default" : "number-pad"}
                value={pin}
                onChangeText={setPin}
                onFocus={() => {
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)
                }}
                onSubmitEditing={() => canSubmit && void onLogin()}
              />
            </View>

            {error ? <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel={error} style={styles.errorBox}><TabIcon name="alert" color={colors.dangerPressed} size={18} /><Text style={styles.error}>{error}</Text></View> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pending ? t("loginPending") : t("login")}
              accessibilityHint={IS_LEADDRIVE_FIELD ? t("fieldLoginSecureHint") : t("loginSecureHint")}
              accessibilityState={{ busy: pending, disabled: !canSubmit }}
              accessibilityLiveRegion="polite"
              onPress={onLogin}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.button,
                !canSubmit && styles.buttonDisabled,
                pending && styles.buttonPending,
                pressed && canSubmit && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonText}>{pending ? t("loginPending") : t("login")}</Text>
              <TabIcon name={pending ? "refresh" : "chevronRight"} color={colors.accent} size={22} />
            </Pressable>
            </View>
          </View>
          <View accessible accessibilityRole="text" accessibilityLabel={t("loginFooter")} style={[styles.securityRow, layout.isTablet && styles.securityRowTablet]}>
            <View accessible={false} style={styles.securityDot} />
            <Text style={styles.footer}>{t("loginFooter")}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingTop: 26, paddingBottom: 40 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 52 },
  topbarTablet: { width: "100%", maxWidth: 980, alignSelf: "center", marginBottom: 64 },
  localeRow: { flexDirection: "row", gap: 4, padding: 3, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  localeBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: 7 },
  localeActive: { backgroundColor: colors.navy },
  localeText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  localeTextActive: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  intro: { marginBottom: 28 },
  loginWorkspace: { width: "100%" },
  loginWorkspaceTablet: { maxWidth: 980, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 72 },
  introTablet: { flex: 1, marginBottom: 0, paddingRight: 12 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.7, marginBottom: 9 },
  title: { fontSize: 34, lineHeight: 39, fontWeight: "900", color: colors.text, letterSpacing: -1.1 },
  titleTablet: { fontSize: 44, lineHeight: 50, letterSpacing: -1.5 },
  welcome: { fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 8, maxWidth: 330 },
  welcomeTablet: { fontSize: 17, lineHeight: 25, maxWidth: 430, marginTop: 12 },
  form: { gap: 17 },
  formTablet: { width: 420, padding: 24, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  field: { gap: 7 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepBadge: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stepText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  label: { fontSize: 12, fontWeight: "800", color: colors.muted, letterSpacing: 0.2 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.inner,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  orgInput: { borderColor: colors.primary },
  errorBox: { padding: 12, borderRadius: radii.inner, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  error: { flex: 1, color: colors.dangerPressed, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  button: {
    backgroundColor: colors.navy,
    borderRadius: radii.inner,
    minHeight: 56,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  buttonDisabled: { opacity: 0.35 },
  buttonPending: { opacity: 0.8 },
  buttonPressed: { backgroundColor: colors.navyRaised },
  buttonText: { color: colors.headerText, fontWeight: "800", fontSize: 16 },
  securityRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 8, marginTop: 24, paddingHorizontal: 12 },
  securityRowTablet: { width: 420, alignSelf: "center" },
  securityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success, marginTop: 5 },
  footer: { flexShrink: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
})
