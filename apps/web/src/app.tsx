import {
  CompanyWorkspace,
  InactiveCompanyAccess,
} from "./features/companies/CompanyWorkspace";
import React, { useEffect, useState, useRef } from "react";
import {
  LayoutDashboard,
  Building2,
  Users,
  Network,
  Settings2,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Bell,
  Check,
  LogOut,
  Menu,
  X,
  FileText,
  Inbox,
  LockKeyhole,
  HelpCircle,
  MapPin,
  MoreHorizontal,
  CheckCircle2,
  Clock3,
  Activity,
  FolderTree,
  Mail,
  KeyRound,
  PanelLeftClose,
} from "lucide-react";
import { apiRequest, post, setCsrf, onSessionExpired } from "./api/client";
import { MembershipFields } from "./features/users/membership-fields";
import { CompanyScope } from "./features/companies/scope";
import { HaciendaWorkspace } from "./features/hacienda/HaciendaWorkspace";
import { WorkInbox } from "./features/workflow/WorkInbox";
import { BillingWorkspace } from "./features/billing/BillingWorkspace";
type Row = Record<string, any>;
const nav = [
  { id: "hacienda", name: "Hacienda", icon: ShieldCheck },
  { id: "collections", name: "Cuentas por cobrar", icon: FileText },
  { id: "payables", name: "Cuentas por pagar", icon: FileText },
  { id: "customers", name: "Clientes", icon: Users },
  { id: "catalog", name: "Productos y servicios", icon: FolderTree },
  { id: "drafts", name: "Borradores", icon: FileText },
  { id: "home", name: "Inicio", icon: LayoutDashboard },
  { id: "company", name: "Mi empresa", icon: Building2 },
  { id: "users", name: "Usuarios y permisos", icon: Users },
  { id: "organization", name: "Estructura organizativa", icon: Network },
  { id: "tax", name: "Configuración tributaria", icon: Settings2 },
  { id: "audit", name: "Auditoría", icon: ShieldCheck },
];
const headings: Record<string, [string, string]> = {
  hacienda: ["Hacienda", "Credenciales y preparación del ambiente de pruebas."],
  collections: [
    "Cuentas por cobrar",
    "Bandeja de revisión documental por departamento.",
  ],
  payables: [
    "Cuentas por pagar",
    "Preparación de la recepción y revisión documental.",
  ],
  customers: ["Clientes", "Los contactos comerciales de tu empresa."],
  catalog: [
    "Productos y servicios",
    "Tu catálogo comercial, con precios y monedas.",
  ],
  drafts: [
    "Borradores",
    "Prepara una factura antes de su validación tributaria.",
  ],
  home: [
    "Tu empresa, en orden.",
    "Todo lo que necesitas para preparar el siguiente paso.",
  ],
  company: ["Mi empresa", "La información que identifica a tu negocio."],
  users: [
    "Usuarios y permisos",
    "Las personas correctas, con el acceso correcto.",
  ],
  organization: [
    "Estructura organizativa",
    "Organiza tu operación por departamentos, centros de costos y sucursales.",
  ],
  tax: [
    "Configuración tributaria",
    "Prepara los datos de tu empresa para la facturación electrónica.",
  ],
  audit: ["Auditoría", "Un registro de los cambios realizados en tu empresa."],
};
function Logo() {
  return (
    <div className="logo">
      <span className="brandmark">
        <i />
        <i />
        <i />
      </span>
      <span>
        conta<span className="logo-light">fácil</span>
        <b>CR</b>
      </span>
    </div>
  );
}
function Field({
  label,
  name,
  defaultValue = "",
  type = "text",
  required = true,
  children,
}: any) {
  return (
    <label className="field">
      {label}
      {children ?? (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue}
          required={required}
          autoComplete={type === "password" ? "current-password" : undefined}
        />
      )}
    </label>
  );
}
function Badge({ children, tone = "green" }: any) {
  return (
    <span className={"badge " + tone}>
      <span />
      {children}
    </span>
  );
}
export function App() {
  const [session, setSession] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [companies, setCompanies] = useState<Row[]>([]),
    [tenant, setTenant] = useState(""),
    [view, setView] = useState("home"),
    [overview, setOverview] = useState<Row | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [roles, setRoles] = useState<Row[]>([]),
    [departments, setDepartments] = useState<Row[]>([]),
    [branches, setBranches] = useState<Row[]>([]),
    [tab, setTab] = useState("departments"),
    [modal, setModal] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [statusFilter, setStatusFilter] = useState("all"),
    [listLoading, setListLoading] = useState(false),
    [activitiesVersion, setActivitiesVersion] = useState(0),
    [next, setNext] = useState<any>(null),
    [qr, setQr] = useState<Row | null>(null),
    [recovery, setRecovery] = useState(false);
  const scope = useRef(new CompanyScope()),
    initialized = useRef(false),
    sessionGeneration = useRef(0);
  const listContextKey = JSON.stringify([
    tenant,
    view,
    tab,
    search,
    statusFilter,
  ]);
  const listContext = useRef(listContextKey),
    listSequence = useRef(0),
    previousView = useRef("");
  listContext.current = listContextKey;
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  function clearLocalSession(message = "") {
    sessionGeneration.current++;
    scope.current.clear();
    setSession(null);
    setCompanies([]);
    setTenant("");
    setOverview(null);
    setRows([]);
    setRoles([]);
    setDepartments([]);
    setBranches([]);
    setModal(null);
    setQr(null);
    setQuery("");
    setSearch("");
    setStatusFilter("all");
    setNext(null);
    setView("home");
    setError("");
    setNotice(message);
    setMobile(false);
    setCsrf("");
  }
  useEffect(
    () =>
      onSessionExpired(() =>
        clearLocalSession(
          "Tu sesión terminó. Ingresa nuevamente para continuar.",
        ),
      ),
    [],
  );
  const refreshSession = async () => {
    const generation = sessionGeneration.current;
    const data = await apiRequest("/auth/session");
    if (generation !== sessionGeneration.current) return null;
    setCsrf(data.csrf);
    setSession(data);
    return data;
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    refreshSession()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const mfaNeeded = session?.mfaRequired && session?.aal !== "aal2";
  useEffect(() => {
    if (!session || mfaNeeded) return;
    let active = true;
    const generation = sessionGeneration.current;
    apiRequest("/companies")
      .then((data) => {
        if (!active || generation !== sessionGeneration.current) return;
        setCompanies(data.items);
        if (data.items.length === 1) choose(data.items[0].id);
      })
      .catch((e) => {
        if (active && generation === sessionGeneration.current)
          setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id, session?.aal]);
  function choose(id: string) {
    scope.current.select(id);
    setTenant(id);
    setRows([]);
    setOverview(null);
    setView("home");
    setError("");
    setMobile(false);
    setModal(null);
    setRoles([]);
    setDepartments([]);
    setBranches([]);
    setNotice("");
  }
  const base = "/companies/" + tenant;
  async function loadData(append = false) {
    if (
      !tenant ||
      scope.current.active !== tenant ||
      listContext.current !== listContextKey
    )
      return;
    const token = scope.current.capture(),
      sequence = ++listSequence.current;
    setError("");
    setListLoading(true);
    try {
      const current = await scope.current.load(async () => {
        const inactive = companies.find((c) => c.id === tenant && !c.active);
        const info =
          view === "company" && inactive
            ? { company: inactive, permissions: [], counts: {} }
            : await apiRequest(base + "/overview");
        let data: Row = { items: [] };
        if (view === "organization") {
          const params = new URLSearchParams({ search });
          if (statusFilter !== "all") params.set("active", statusFilter);
          if (append && next !== null) params.set("cursor", String(next));
          data = await apiRequest(base + "/" + tab + "?" + params);
        }
        if (view === "users") data = await apiRequest(base + "/memberships");
        if (view === "audit")
          data = await apiRequest(
            base +
              "/audit" +
              (append && next !== null ? "?cursor=" + next : ""),
          );
        if (view === "tax") data = await apiRequest(base + "/tax-settings");
        return { info, data };
      }, tenant);
      if (
        !current ||
        sequence !== listSequence.current ||
        listContext.current !== listContextKey
      )
        return;
      setOverview(current.info);
      setRows((prev) =>
        append ? [...prev, ...current.data.items] : current.data.items,
      );
      setNext(current.data.nextCursor ?? null);
    } catch (e: any) {
      if (
        !scope.current.matches(token) ||
        sequence !== listSequence.current ||
        listContext.current !== listContextKey
      )
        return;
      setError(e.message);
      setRows([]);
    } finally {
      if (
        sequence === listSequence.current &&
        listContext.current === listContextKey
      )
        setListLoading(false);
    }
  }
  useEffect(() => {
    const current = JSON.stringify([tenant, view, tab]),
      changed = previousView.current !== current;
    previousView.current = current;
    setRows([]);
    setNext(null);
    if (changed && (query || search || statusFilter !== "all")) {
      setQuery("");
      setSearch("");
      setStatusFilter("all");
      if (search || statusFilter !== "all") return;
    }
    void loadData();
  }, [tenant, view, tab, search, statusFilter]);
  async function act(fn: () => Promise<any>) {
    const token = scope.current.capture();
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      if (scope.current.matches(token)) setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submitLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(async () => {
      if (recovery) {
        const r = await post("/auth/recover", Object.fromEntries(f));
        setNotice(r.message);
      } else {
        await post("/auth/login", Object.fromEntries(f));
        await refreshSession();
      }
    });
  }
  async function logout() {
    await act(async () => {
      await post("/auth/logout", {});
      clearLocalSession();
    });
  }
  async function openModal(kind: string, row?: Row) {
    setError("");
    await act(async () => {
      const result = await scope.current.load(async () => {
        const options: { roles: Row[]; departments: Row[]; branches: Row[] } = {
          roles: [],
          departments: [],
          branches: [],
        };
        if (["invite", "membership"].includes(kind)) {
          options.roles = (await apiRequest(base + "/roles")).items;
          options.departments = (await apiRequest(base + "/departments")).items;
        }
        if (kind === "cost-centers")
          options.departments = (await apiRequest(base + "/departments")).items;
        if (kind === "terminals")
          options.branches = (await apiRequest(base + "/branches")).items;
        return options;
      }, tenant);
      if (!result) return;
      setRoles(result.roles);
      setDepartments(result.departments);
      setBranches(result.branches);
      setModal({ kind, row });
    });
  }
  async function saveModal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      kind = modal!.kind;
    const token = scope.current.capture();
    await act(async () => {
      let data: Row = Object.fromEntries(f);
      if (kind === "role") {
        data = { name: f.get("name"), permissions: f.getAll("permissions") };
        await post(base + "/roles", data);
      } else if (kind === "invite") {
        data.department_ids = f.getAll("department_ids");
        await post(base + "/invitations", data);
      } else if (kind === "membership") {
        data.active = f.get("active") === "true";
        data.department_ids = f.getAll("department_ids");
        await post(base + "/memberships/" + modal!.row.user_id, data, "PATCH");
      } else {
        data.active = f.get("active") !== "false";
        await post(
          base + "/" + kind + (modal!.row ? "/" + modal!.row.id : ""),
          data,
          modal!.row ? "PATCH" : "POST",
        );
      }
      if (!scope.current.matches(token)) return;
      setModal(null);
      if (kind === "economic-activities") setActivitiesVersion((v) => v + 1);
      setNotice("Cambios guardados correctamente.");
      await loadData();
    });
  }
  const can = (permission: string) =>
    overview?.permissions?.includes(permission);
  const company = overview?.company ?? companies.find((c) => c.id === tenant),
    counts = overview?.counts ?? {},
    filtered = rows;
  if (loading)
    return (
      <div className="loading">
        <Logo />
        <div className="spinner" />
        Cargando tu espacio…
      </div>
    );
  const path = window.location.pathname;
  if (path === "/reset" || path === "/invite")
    return <AccessCallback invite={path === "/invite"} />;
  if (!session)
    return (
      <div className="auth-page">
        <div className="auth-story">
          <Logo />
          <div>
            <span className="eyebrow light">HECHO PARA COSTA RICA</span>
            <h1>
              Menos complicaciones.
              <br />
              Más tranquilidad.
            </h1>
            <p>
              El control de tu empresa comienza con una base segura y
              organizada.
            </p>
            <div className="auth-proof">
              <ShieldCheck /> Cada empresa, en su propio espacio.
            </div>
          </div>
          <small>Conta Fácil · Tu empresa en orden.</small>
        </div>
        <main className="auth-main">
          <span className="phase-label">PLATAFORMA EMPRESARIAL</span>
          <h2>
            {recovery ? "Recupera tu acceso" : "Bienvenido a Conta Fácil"}
          </h2>
          <p>
            {recovery
              ? "Te enviaremos las instrucciones a tu correo registrado."
              : "Ingresa con tu identificación y contraseña personal."}
          </p>
          <form onSubmit={submitLogin}>
            <Field label="Tipo de identificación">
              <select name="type">
                <option value="national">Cédula nacional</option>
                <option value="dimex">DIMEX</option>
                <option value="other">Otra identificación</option>
              </select>
            </Field>
            <input type="hidden" name="country" value="CR" />
            <Field label="Número de identificación" name="identification" />
            {!recovery && (
              <Field label="Contraseña" name="password" type="password" />
            )}
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="notice">
                {notice}
              </div>
            )}
            <button disabled={busy} className="button primary full">
              {busy
                ? "Procesando…"
                : recovery
                  ? "Enviar instrucciones"
                  : "Iniciar sesión"}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setRecovery(!recovery);
              setNotice("");
              setError("");
            }}
          >
            {recovery
              ? "Volver al inicio de sesión"
              : "¿Olvidaste tu contraseña?"}
          </button>
          <div className="auth-footer">
            <LockKeyhole size={14} /> Acceso seguro · Tus datos permanecen
            privados
          </div>
        </main>
      </div>
    );
  if (mfaNeeded)
    return (
      <div className="center-page">
        <div className="access-card">
          <Logo />
          <div className="large-icon">
            <ShieldCheck />
          </div>
          <h2>Protege tu acceso</h2>
          <p>
            Tu rol administrativo requiere un código de tu aplicación de
            autenticación.
          </p>
          {qr && (
            <>
              <img
                className="qr"
                src={
                  qr.qr.startsWith("<svg")
                    ? "data:image/svg+xml;charset=utf-8," +
                      encodeURIComponent(qr.qr)
                    : qr.qr
                }
                alt="Código QR para configurar autenticación"
              />
              <details>
                <summary>Usar clave manual</summary>
                <code>{qr.secret}</code>
              </details>
            </>
          )}
          {qr || session.factors?.some((f: Row) => f.status === "verified") ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () => {
                  await post("/auth/mfa/verify", {
                    factorId:
                      qr?.factorId ??
                      session.factors.find((f: Row) => f.status === "verified")
                        .id,
                    code: f.get("code"),
                  });
                  setQr(null);
                  await refreshSession();
                });
              }}
            >
              <Field label="Código de 6 dígitos" name="code" />
              <button className="button primary full" disabled={busy}>
                Verificar y continuar <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <button
              className="button primary full"
              disabled={busy}
              onClick={() =>
                act(async () => setQr(await post("/auth/mfa/enroll", {})))
              }
            >
              Configurar autenticador
            </button>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <button className="text-button" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  if (!tenant)
    return (
      <div className="center-page">
        <div className="access-card wide">
          <Logo />
          <span className="eyebrow">TU ESPACIO DE TRABAJO</span>
          <h2>¿Con cuál empresa trabajamos?</h2>
          <p>Solo aparecen las empresas a las que tienes acceso.</p>
          {companies.map((c) => (
            <button
              className="company-option"
              key={c.id}
              onClick={() => choose(c.id)}
            >
              <span className="company-avatar">
                {c.legal_name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{c.trade_name || c.legal_name}</strong>
                <small>{c.legal_name}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
          <InactiveCompanyAccess
            onSelect={(row, saved) => {
              setCompanies((old) => [
                ...old.filter((c) => c.id !== row.id),
                row,
              ]);
              choose(row.id);
              setView("company");
              if (saved) setNotice("Empresa guardada.");
            }}
          />
          {!companies.length && (
            <div className="empty">
              <Building2 />
              <p>
                No tienes empresas activas asignadas. Solicita una invitación a
                tu administrador.
              </p>
            </div>
          )}
          {error && <div className="alert">{error}</div>}
          <button className="text-button" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  return (
    <div className="shell">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-only"
            aria-label="Cerrar menú"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <button
          className="company-select"
          onClick={() => {
            scope.current.clear();
            setTenant("");
            setOverview(null);
            setRows([]);
          }}
        >
          <span className="company-avatar">
            {(company?.trade_name || company?.legal_name || "CF")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span>
            <strong>
              {company?.trade_name || company?.legal_name || "Mi empresa"}
            </strong>
            <small>Espacio de empresa</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-caption">PRINCIPAL</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (view === n.id ? "active" : "")}
              onClick={() => {
                setView(n.id);
                setMobile(false);
              }}
            >
              <n.icon size={19} />
              {n.name}
              {view === n.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <span className="nav-caption upcoming">PRÓXIMAMENTE</span>
        <div className="nav-disabled">
          <FileText size={19} />
          Facturación electrónica
          <LockKeyhole size={13} />
        </div>
        <div className="nav-disabled">
          <Inbox size={19} />
          Recepción de facturas
          <LockKeyhole size={13} />
        </div>
        <div className="sidebar-bottom">
          <div className="foundation-note">
            <span className="tiny-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>Una base para crecer</strong>
            <p>
              Estamos preparando tu empresa para la facturación electrónica 4.4.
            </p>
            <button onClick={() => setView("tax")}>
              Ver configuración <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="profile" onClick={logout} title="Cerrar sesión">
            <span className="user-avatar">
              {session.user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{session.user.name}</strong>
              <small>Sesión protegida</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Abrir menú"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <Building2 size={16} />
            <span>{company?.trade_name || company?.legal_name}</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === view)?.name}</strong>
          </div>
          <div className="top-actions">
            <Badge tone="blue">Desarrollo · Pruebas</Badge>
            <button
              className="icon-button"
              title="Ayuda"
              onClick={() => setModal({ kind: "help" })}
            >
              <HelpCircle size={20} />
            </button>
            <div className="top-avatar">
              {session.user.name.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <main className="content">
          <div className="page-title">
            <div>
              <span className="eyebrow">
                {view === "home"
                  ? "BIENVENIDO A CONTA FÁCIL"
                  : "ADMINISTRACIÓN DE EMPRESA"}
              </span>
              <h1>{headings[view][0]}</h1>
              <p>{headings[view][1]}</p>
            </div>
            {view === "home" ? (
              <div className="secure-status">
                <ShieldCheck size={16} /> Espacio seguro
              </div>
            ) : view === "organization" && can("organization.manage") ? (
              <button className="button primary" onClick={() => openModal(tab)}>
                <Plus size={16} />
                Crear{" "}
                {tab === "departments"
                  ? "departamento"
                  : tab === "cost-centers"
                    ? "centro de costos"
                    : tab === "branches"
                      ? "sucursal"
                      : "terminal"}
              </button>
            ) : view === "users" && can("users.manage") ? (
              <button
                className="button primary"
                onClick={() => openModal("invite")}
              >
                <Plus size={16} />
                Invitar usuario
              </button>
            ) : null}
          </div>
          {error && (
            <div role="alert" className="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button onClick={() => setNotice("")} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          )}
          {["customers", "catalog", "drafts"].includes(view) && (
            <BillingWorkspace
              key={tenant + ":" + view + ":" + session.user.id}
              tenantId={tenant}
              view={view as "customers" | "catalog" | "drafts"}
              permissions={overview?.permissions ?? []}
            />
          )}
          {view === "hacienda" && (
            <HaciendaWorkspace
              key={tenant + ":" + view + ":" + session.user.id}
              tenantId={tenant}
              company={company}
              permissions={overview?.permissions ?? []}
            />
          )}
          {(view === "collections" || view === "payables") && (
            <WorkInbox
              key={tenant + ":" + view + ":" + session.user.id}
              tenantId={tenant}
              flow={view}
              permissions={overview?.permissions ?? []}
            />
          )}
          {view === "home" && (
            <>
              <section className="welcome-banner">
                <div className="banner-copy">
                  <span className="banner-kicker">
                    <span /> EMPECEMOS CON LO IMPORTANTE
                  </span>
                  <h2>
                    Una buena gestión empieza
                    <br />
                    con una buena base.
                  </h2>
                  <p>
                    Configura tu empresa, organiza tu equipo y deja todo
                    <br className="desktop-only" /> listo para lo que viene.
                  </p>
                  <button
                    className="button white"
                    onClick={() => setView("company")}
                  >
                    Configurar mi empresa <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-orbit one" />
                  <div className="art-orbit two" />
                  <div className="art-sheet">
                    <div className="art-logo">
                      <span className="mini-mark" />
                      CONTA FÁCIL
                    </div>
                    <div className="art-line long" />
                    <div className="art-line" />
                    <div className="art-chart">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="art-footer">
                      <span />
                      <span />
                    </div>
                  </div>
                  <div className="art-check">
                    <Check size={30} />
                  </div>
                  <div className="art-float">
                    <ShieldCheck size={19} />
                    <span>Todo en su lugar</span>
                  </div>
                  <span className="art-spark">✦</span>
                </div>
              </section>
              <div className="stats-grid">
                {[
                  {
                    label: "Empresas activas",
                    value: companies.length,
                    icon: Building2,
                    note: "Tus espacios autorizados",
                    color: "blue",
                  },
                  {
                    label: "Usuarios autorizados",
                    value: counts.users,
                    icon: Users,
                    note: can("users.read")
                      ? "Con acceso a esta empresa"
                      : "Dentro de tu alcance",
                    color: "purple",
                  },
                  {
                    label: "Departamentos",
                    value: counts.departments,
                    icon: FolderTree,
                    note: "Organiza tu operación",
                    color: "orange",
                  },
                  {
                    label: "Sucursales",
                    value: counts.branches,
                    icon: MapPin,
                    note: "Tu estructura comercial",
                    color: "teal",
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <div className={"stat-icon " + s.color}>
                        <s.icon size={19} />
                      </div>
                    </div>
                    <strong>{s.value ?? "—"}</strong>
                    <small>{s.note}</small>
                  </div>
                ))}
              </div>
              <div className="home-columns">
                <section className="panel setup-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Prepara tu empresa</h3>
                      <p>
                        Completa estos pasos para empezar con el pie derecho.
                      </p>
                    </div>
                    <span className="step-counter">
                      {
                        [
                          !!company?.contact_email,
                          counts.users > 0,
                          counts.departments > 0,
                          counts.activities > 0,
                        ].filter(Boolean).length
                      }{" "}
                      de 4
                    </span>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width:
                          [
                            !!company?.contact_email,
                            counts.users > 0,
                            counts.departments > 0,
                            counts.activities > 0,
                          ].filter(Boolean).length *
                            25 +
                          "%",
                      }}
                    />
                  </div>
                  {[
                    {
                      title: "Información de la empresa",
                      description: "Datos generales y contacto de tu negocio.",
                      done: !!company?.contact_email,
                      icon: Building2,
                      go: "company",
                    },
                    {
                      title: "Usuarios y permisos",
                      description:
                        "Define quién tiene acceso y qué puede hacer.",
                      done: counts.users > 0,
                      icon: Users,
                      go: "users",
                    },
                    {
                      title: "Departamentos y centros de costos",
                      description: "Dale una estructura clara a tu operación.",
                      done: counts.departments > 0,
                      icon: Network,
                      go: "organization",
                    },
                    {
                      title: "Configuración tributaria",
                      description:
                        "Registra las actividades económicas de tu empresa.",
                      done: counts.activities > 0,
                      icon: Settings2,
                      go: "tax",
                    },
                  ].map((s) => (
                    <button
                      className="setup-row"
                      key={s.title}
                      onClick={() => setView(s.go)}
                    >
                      <span className={"setup-icon " + (s.done ? "done" : "")}>
                        <s.icon size={19} />
                      </span>
                      <span className="setup-text">
                        <strong>{s.title}</strong>
                        <small>{s.description}</small>
                      </span>
                      {s.done ? (
                        <CheckCircle2 size={20} className="done-check" />
                      ) : (
                        <ChevronRight size={18} className="muted" />
                      )}
                    </button>
                  ))}
                </section>
                <div className="right-stack">
                  <section className="panel quick-panel">
                    <div className="panel-heading">
                      <h3>Accesos rápidos</h3>
                      <ArrowUpRight size={17} className="muted" />
                    </div>
                    {[
                      {
                        icon: Users,
                        title: "Administrar usuarios",
                        go: "users",
                      },
                      {
                        icon: Network,
                        title: "Organizar departamentos",
                        go: "organization",
                      },
                      {
                        icon: ShieldCheck,
                        title: "Consultar auditoría",
                        go: "audit",
                      },
                    ].map((q) => (
                      <button key={q.go} onClick={() => setView(q.go)}>
                        <q.icon size={18} />
                        <span>{q.title}</span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </section>
                  <section className="next-card">
                    <div className="next-icon">
                      <FileText size={20} />
                    </div>
                    <span className="eyebrow">EL SIGUIENTE PASO</span>
                    <h3>Facturación electrónica 4.4</h3>
                    <p>
                      La emisión y recepción de comprobantes llegarán en las
                      próximas fases.
                    </p>
                    <Badge tone="neutral">Próximamente</Badge>
                  </section>
                </div>
              </div>
              <div className="privacy-strip">
                <ShieldCheck size={17} />
                <span>Tu información es solo tuya.</span>
                <p>
                  Cada empresa cuenta con acceso independiente y permisos
                  controlados.
                </p>
                <LockKeyhole size={15} />
              </div>
            </>
          )}
          {view === "company" && company && (
            <CompanyWorkspace
              key={tenant + ":company:" + session.user.id}
              tenantId={tenant}
              company={company}
              onUsers={() => setView("users")}
              onSaved={async (id) => {
                const token = scope.current.capture();
                const data = await apiRequest("/companies");
                if (!scope.current.matches(token)) return;
                setCompanies(data.items);
                if (
                  id !== tenant ||
                  !data.items.some((r: Row) => r.id === id)
                ) {
                  if (data.items.some((r: Row) => r.id === id)) {
                    choose(id);
                    setView("company");
                  } else {
                    scope.current.clear();
                    setTenant("");
                    setOverview(null);
                  }
                } else await loadData();
                setNotice("Empresa guardada.");
              }}
            />
          )}
          {view === "organization" && (
            <section className="panel">
              <div className="tabs">
                {[
                  ["departments", "Departamentos"],
                  ["cost-centers", "Centros de costos"],
                  ["branches", "Sucursales"],
                  ["terminals", "Terminales"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={tab === id ? "selected" : ""}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="table-toolbar">
                <h3>
                  {tab === "departments"
                    ? "Departamentos"
                    : tab === "cost-centers"
                      ? "Centros de costos"
                      : tab === "branches"
                        ? "Sucursales"
                        : "Terminales"}{" "}
                  <span className="count-pill">{rows.length}</span>
                </h3>
                <select
                  aria-label="Filtrar por estado"
                  className="status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">Todos los estados</option>
                  <option value="true">Activos</option>
                  <option value="false">Inactivos</option>
                </select>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Buscar registros"
                    placeholder="Buscar…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              {listLoading ? (
                <div className="empty" role="status">
                  Buscando registros…
                </div>
              ) : filtered.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>
                          {tab === "cost-centers"
                            ? "Departamento"
                            : "Código / referencia"}
                        </th>
                        <th>Estado</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <span className="row-icon">
                              <FolderTree size={16} />
                            </span>
                            <strong>{r.name}</strong>
                          </td>
                          <td className="muted">
                            {r.code ||
                              r.department_id?.slice(0, 8) ||
                              r.id.slice(0, 8)}
                          </td>
                          <td>
                            <Badge tone={r.active ? "green" : "neutral"}>
                              {r.active ? "Activo" : "Inactivo"}
                            </Badge>
                          </td>
                          <td>
                            {can("organization.manage") && (
                              <button
                                className="table-action"
                                onClick={() => openModal(tab, r)}
                              >
                                Editar <ArrowUpRight size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={Network}
                  title="Dale estructura a tu empresa"
                  text="Crea el primer registro o ajusta tu búsqueda. Solo verás información dentro de tu alcance autorizado."
                />
              )}
              {next !== null && (
                <button className="text-button" onClick={() => loadData(true)}>
                  Cargar más
                </button>
              )}
            </section>
          )}
          {view === "users" && (
            <>
              <section className="panel">
                <div className="table-toolbar">
                  <div>
                    <h3>
                      Equipo de trabajo{" "}
                      <span className="count-pill">{rows.length}</span>
                    </h3>
                    <p>Accesos autorizados a esta empresa.</p>
                  </div>
                  {can("users.manage") && (
                    <button
                      className="button secondary"
                      onClick={() => openModal("role")}
                    >
                      <ShieldCheck size={15} />
                      Crear rol personalizado
                    </button>
                  )}
                </div>
                {rows.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Usuario</th>
                          <th>Rol</th>
                          <th>Alcance</th>
                          <th>Estado</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.user_id}>
                            <td>
                              <span className="row-icon">
                                <Users size={16} />
                              </span>
                              <strong>
                                {r.user_id === session.user.id
                                  ? session.user.name
                                  : r.user_id.slice(0, 8)}
                              </strong>
                              {r.user_id === session.user.id && (
                                <small className="you">Tú</small>
                              )}
                            </td>
                            <td>{r.roles?.join(", ") || "Sin rol"}</td>
                            <td>
                              {r.scope === "company"
                                ? "Toda la empresa"
                                : "Departamentos asignados"}
                            </td>
                            <td>
                              <Badge tone={r.active ? "green" : "neutral"}>
                                {r.active ? "Activo" : "Inactivo"}
                              </Badge>
                            </td>
                            <td>
                              {can("users.manage") && (
                                <button
                                  className="table-action"
                                  onClick={() => openModal("membership", r)}
                                >
                                  Administrar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={LockKeyhole}
                    title="Acceso restringido"
                    text="Necesitas permisos de administración de usuarios para consultar el equipo."
                  />
                )}
              </section>
              <div className="info-box">
                <ShieldCheck size={21} />
                <div>
                  <strong>Los permisos se verifican en cada operación</strong>
                  <p>
                    Los administradores requieren autenticación de dos factores.
                    Un usuario solo puede acceder a sus empresas y departamentos
                    autorizados.
                  </p>
                </div>
              </div>
            </>
          )}
          {view === "tax" && (
            <>
              <div className="info-box">
                <Clock3 size={22} />
                <div>
                  <strong>Preparación tributaria · Fase 1</strong>
                  <p>
                    Esta configuración se guarda como borrador. La validación
                    normativa, los certificados y la conexión con Hacienda se
                    implementarán en Fase 2.
                  </p>
                </div>
              </div>
              <section className="panel form-panel">
                <div className="panel-heading">
                  <h3>Ambiente y parámetros</h3>
                  <Badge tone="orange">Borrador</Badge>
                </div>
                <form
                  key={tenant + rows.length}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await post(
                        base + "/tax-settings",
                        Object.fromEntries(new FormData(e.currentTarget)),
                      );
                      setNotice("Configuración guardada como borrador.");
                      await loadData();
                    });
                  }}
                >
                  <div className="form-grid">
                    <Field label="Ambiente">
                      <select name="environment">
                        <option value="test">Pruebas</option>
                        <option value="production">
                          Producción · sin conexión
                        </option>
                      </select>
                    </Field>
                    <Field label="Moneda predeterminada">
                      <select name="currency">
                        <option value="CRC">CRC · Colón costarricense</option>
                        <option value="USD">USD · Dólar estadounidense</option>
                      </select>
                    </Field>
                    <Field
                      label="Fuente oficial"
                      name="source_url"
                      type="url"
                      required={false}
                    />
                    <Field
                      label="Observaciones"
                      name="notes"
                      required={false}
                    />
                  </div>
                  <div className="form-actions">
                    <span>
                      Sin credenciales ni certificados en este formulario.
                    </span>
                    <button
                      className="button primary"
                      disabled={busy || !can("tax.manage")}
                    >
                      Guardar borrador
                    </button>
                  </div>
                </form>
                {rows.map((r) => (
                  <div className="saved-config" key={r.environment}>
                    <Badge tone="neutral">
                      {r.environment === "test" ? "Pruebas" : "Producción"}
                    </Badge>
                    <strong>{r.currency}</strong>
                    <span>{r.notes || "Sin observaciones"}</span>
                  </div>
                ))}
              </section>
              <section className="panel">
                <div className="table-toolbar">
                  <div>
                    <h3>Actividades económicas</h3>
                    <p>
                      Registra únicamente códigos respaldados por una fuente
                      oficial.
                    </p>
                  </div>
                  {can("tax.manage") && (
                    <button
                      className="button secondary"
                      onClick={() => openModal("economic-activities")}
                    >
                      <Plus size={16} />
                      Registrar actividad
                    </button>
                  )}
                </div>
                <Activities
                  tenant={tenant}
                  refreshVersion={activitiesVersion}
                />
              </section>
            </>
          )}
          {view === "audit" && (
            <section className="panel">
              <div className="table-toolbar">
                <div>
                  <h3>Historial de operaciones</h3>
                  <p>
                    Registro de solo lectura. Las contraseñas y los secretos no
                    se registran.
                  </p>
                </div>
                <span className="audit-lock">
                  <LockKeyhole size={16} /> Protegido
                </span>
              </div>
              {rows.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Evento</th>
                        <th>Entidad</th>
                        <th>Usuario</th>
                        <th>Fecha y hora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <span className="row-icon">
                              <Activity size={16} />
                            </span>
                            {r.action}
                          </td>
                          <td>{r.entity}</td>
                          <td className="muted">
                            {r.actor_id?.slice(0, 8) || "Sistema"}
                          </td>
                          <td>
                            {new Intl.DateTimeFormat("es-CR", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "America/Costa_Rica",
                            }).format(new Date(r.created_at))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={ShieldCheck}
                  title="Sin eventos para mostrar"
                  text="Las operaciones aparecerán aquí cuando tengas permiso para consultarlas."
                />
              )}
              {next !== null && (
                <button className="text-button" onClick={() => loadData(true)}>
                  Cargar más
                </button>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>© {new Date().getFullYear()} Conta Fácil</span>
            <span>
              Hecho para tu empresa. Hecho para Costa Rica.
              <span className="cr-flag" />
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Cerrar"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            <div className="large-icon">
              <Plus size={23} />
            </div>
            <h2 id="modal-title">
              {modal.kind === "help"
                ? "Tu espacio, paso a paso"
                : modal.kind === "invite"
                  ? "Invitar a tu equipo"
                  : modal.kind === "membership"
                    ? "Administrar acceso"
                    : modal.kind === "role"
                      ? "Crear rol personalizado"
                      : (modal.row ? "Editar " : "Crear ") +
                        (
                          {
                            departments: "departamento",
                            "cost-centers": "centro de costos",
                            branches: "sucursal",
                            terminals: "terminal",
                            "economic-activities": "actividad económica",
                          } as Row
                        )[modal.kind]}
            </h2>
            {modal.kind === "help" ? (
              <>
                <p>
                  Empieza completando los datos de tu empresa. Luego organiza
                  tus departamentos e invita a las personas que tendrán acceso.
                </p>
                <p>
                  La facturación electrónica, la recepción por correo y la
                  contabilidad se habilitarán en las fases posteriores.
                </p>
                <button
                  className="button primary full"
                  onClick={() => setModal(null)}
                >
                  Entendido
                </button>
              </>
            ) : (
              <form onSubmit={saveModal}>
                {["invite", "membership"].includes(modal.kind) ? (
                  <>
                    {modal.kind === "invite" && (
                      <Field
                        label="Correo del usuario"
                        name="email"
                        type="email"
                      />
                    )}
                    <MembershipFields
                      row={modal.kind === "membership" ? modal.row : undefined}
                      roles={roles}
                      departments={departments}
                    />
                    <p className="form-hint">
                      La invitación no otorga acceso hasta que su titular la
                      acepte. Los cambios de acceso quedan auditados.
                    </p>
                  </>
                ) : modal.kind === "role" ? (
                  <>
                    <Field label="Nombre del rol" name="name" />
                    {[
                      "company.read",
                      "organization.read",
                      "users.read",
                      "tax.read",
                      "audit.read",
                      "customers.read",
                      "customers.manage",
                      "catalog.read",
                      "catalog.manage",
                      "invoices.read",
                      "invoices.manage",
                      "hacienda.read",
                      "hacienda.credentials.manage",
                      "hacienda.connection.test",
                      "collections.read",
                      "collections.manage",
                      "payables.read",
                      "payables.manage",
                      "document_workflow.assign",
                    ].map((p) => (
                      <label className="checkbox" key={p}>
                        <input name="permissions" type="checkbox" value={p} />
                        {
                          (
                            {
                              "company.read": "Ver empresa",
                              "organization.read": "Ver estructura",
                              "users.read": "Consultar usuarios",
                              "tax.read": "Consultar configuración tributaria",
                              "audit.read": "Ver auditoría",
                              "customers.read": "Ver clientes",
                              "customers.manage": "Gestionar clientes",
                              "catalog.read": "Ver productos",
                              "catalog.manage": "Gestionar productos",
                              "invoices.read": "Ver borradores",
                              "invoices.manage": "Gestionar borradores",
                              "hacienda.read": "Consultar Hacienda",
                              "hacienda.credentials.manage":
                                "Gestionar credenciales de Hacienda",
                              "hacienda.connection.test":
                                "Probar acceso a Hacienda",
                              "collections.read":
                                "Ver bandeja de cuentas por cobrar",
                              "collections.manage":
                                "Gestionar bandeja de cuentas por cobrar",
                              "payables.read":
                                "Ver bandeja de cuentas por pagar",
                              "payables.manage":
                                "Gestionar bandeja de cuentas por pagar",
                              "document_workflow.assign":
                                "Asignar documentos a departamentos",
                            } as Row
                          )[p]
                        }
                      </label>
                    ))}
                    <p className="form-hint">
                      La gestión de clientes, productos y borradores incluye su
                      consulta y requiere MFA. La administración de usuarios
                      permanece reservada al administrador.
                    </p>
                  </>
                ) : (
                  <>
                    <Field
                      label="Nombre"
                      name="name"
                      defaultValue={modal.row?.name}
                    />
                    {["branches", "terminals", "economic-activities"].includes(
                      modal.kind,
                    ) && (
                      <Field
                        label={
                          modal.kind === "economic-activities"
                            ? "Código oficial"
                            : "Código (" +
                              (modal.kind === "branches" ? "3" : "5") +
                              " dígitos)"
                        }
                        name="code"
                        defaultValue={modal.row?.code}
                      />
                    )}{" "}
                    {modal.kind === "economic-activities" && (
                      <Field
                        label="URL de la fuente oficial"
                        name="source_url"
                        type="url"
                        defaultValue={modal.row?.source_url}
                      />
                    )}{" "}
                    {modal.kind === "cost-centers" && (
                      <Field label="Departamento">
                        <select
                          name="department_id"
                          defaultValue={modal.row?.department_id}
                        >
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {modal.kind === "terminals" && (
                      <Field label="Sucursal">
                        <select
                          name="branch_id"
                          defaultValue={modal.row?.branch_id}
                        >
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {modal.row && (
                      <Field label="Estado">
                        <select
                          name="active"
                          defaultValue={String(modal.row.active)}
                        >
                          <option value="true">Activo</option>
                          <option value="false">Inactivo</option>
                        </select>
                      </Field>
                    )}
                  </>
                )}
                {error && (
                  <div className="alert" role="alert">
                    {error}
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </button>
                  <button disabled={busy} className="button primary">
                    {busy
                      ? "Guardando…"
                      : modal.kind === "invite"
                        ? "Enviar invitación"
                        : "Guardar"}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({ icon: Icon, title, text }: any) {
  return (
    <div className="empty">
      <div className="large-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Activities({ tenant, refreshVersion = 0 }: any) {
  const [items, setItems] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    apiRequest("/companies/" + tenant + "/economic-activities")
      .then((r) => {
        if (live) setItems(r.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [tenant, refreshVersion]);
  return error ? (
    <p className="alert">{error}</p>
  ) : items.length ? (
    <div className="activity-list">
      {items.map((i) => (
        <div key={i.id}>
          <span className="code-pill">{i.code}</span>
          <strong>{i.name}</strong>
          <a href={i.source_url} target="_blank" rel="noreferrer">
            Fuente <ArrowUpRight size={14} />
          </a>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      icon={FileText}
      title="Registra tu actividad económica"
      text="Consulta tu información tributaria y agrega el código y su fuente oficial."
    />
  );
}
function AccessCallback({ invite }: any) {
  const [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const fragment = useRef(new URLSearchParams(window.location.hash.slice(1)));
  useEffect(() => {
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);
  return (
    <div className="center-page">
      <div className="access-card">
        <Logo />
        <h2>{invite ? "Completa tu acceso" : "Nueva contraseña"}</h2>
        {done ? (
          <>
            <div className="notice">
              Listo. Ya puedes iniciar sesión con tu identificación.
            </div>
            <a className="button primary full" href="/">
              Ir al inicio de sesión
            </a>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              try {
                await post(
                  invite ? "/auth/invitations/accept" : "/auth/reset",
                  invite
                    ? {
                        ...data,
                        token: new URLSearchParams(location.search).get(
                          "invitation",
                        ),
                        access_token: fragment.current.get("access_token"),
                        country: "CR",
                      }
                    : {
                        ...data,
                        ...(new URLSearchParams(location.search).get(
                          "token_hash",
                        )
                          ? {
                              token_hash: new URLSearchParams(
                                location.search,
                              ).get("token_hash"),
                            }
                          : {
                              access_token:
                                fragment.current.get("access_token"),
                              refresh_token:
                                fragment.current.get("refresh_token"),
                            }),
                      },
                );
                setDone(true);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {invite && (
              <>
                <Field label="Nombre" name="name" />
                <Field label="Tipo de identificación">
                  <select name="type">
                    <option value="national">Cédula nacional</option>
                    <option value="dimex">DIMEX</option>
                    <option value="other">Otra</option>
                  </select>
                </Field>
                <Field label="Identificación" name="identification" />
              </>
            )}
            <Field
              label="Contraseña nueva (mínimo 12 caracteres)"
              name="password"
              type="password"
            />
            {error && <div className="alert">{error}</div>}
            <button disabled={busy} className="button primary full">
              {busy ? "Procesando…" : "Guardar y continuar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
