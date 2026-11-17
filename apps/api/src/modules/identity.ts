import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { AppConfig } from "../config";
import { hash, randomToken, seal, unseal } from "../security/crypto";
import { csrfForSession } from "../security/csrf";
import { HttpError, type Claims } from "../db";
import { normalizeIdentification } from "../../../../packages/domain/src/identity";
export type Principal = {
  userId: string;
  sessionId: string;
  claims: Claims;
  tokens: { access_token: string; refresh_token: string };
  csrf: string;
};
declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}
export function identity(pool: pg.Pool, config: AppConfig) {
  const client = () =>
    createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  function claims(token: string): Claims {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  }
  async function limit(key: string, max = 8) {
    const r = await pool.query(
      `insert into private.rate_limits(key,count,reset_at) values($1,1,now()+interval '15 minutes') on conflict(key) do update set count=case when private.rate_limits.reset_at<now() then 1 else private.rate_limits.count+1 end,reset_at=case when private.rate_limits.reset_at<now() then now()+interval '15 minutes' else private.rate_limits.reset_at end returning count`,
      [hash(key)],
    );
    if (r.rows[0].count > max)
      throw new HttpError(
        429,
        "Demasiados intentos. Intenta nuevamente más tarde.",
      );
  }
  function cookie(reply: FastifyReply, value: string) {
    reply.setCookie("cf_session", value, {
      path: "/",
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 28800,
    });
  }
  async function issue(
    reply: FastifyReply,
    userId: string,
    tokens: { access_token: string; refresh_token: string },
  ) {
    const c = claims(tokens.access_token),
      sid = randomToken(),
      csrf = csrfForSession(sid, config.SESSION_KEY);
    await pool.query(
      `insert into private.sessions(id,user_id,auth_session_id,encrypted_tokens,csrf_hash,expires_at) values($1,$2,$3,$4,$5,now()+interval '8 hours')`,
      [
        hash(sid),
        userId,
        c.session_id,
        seal(tokens, config.SESSION_KEY),
        hash(csrf),
      ],
    );
    cookie(reply, sid);
    await pool.query(
      "insert into private.access_events(user_id,event) values($1,'login')",
      [userId],
    );
    return { csrf };
  }
  async function authenticate(req: FastifyRequest): Promise<Principal> {
    const sid = req.cookies.cf_session;
    if (!sid) throw new HttpError(401, "Inicia sesión para continuar.");
    const r = await pool.query(
      `select s.*,p.active from private.sessions s join public.profiles p on p.id=s.user_id where s.id=$1 and s.revoked_at is null and s.expires_at>now() and s.last_seen>now()-interval '30 minutes'`,
      [hash(sid)],
    );
    const row = r.rows[0];
    if (!row?.active)
      throw new HttpError(401, "La sesión expiró o fue revocada.");
    let tokens = unseal<{ access_token: string; refresh_token: string }>(
      row.encrypted_tokens,
      config.SESSION_KEY,
    );
    const auth = client();
    let c = claims(tokens.access_token);
    if ((c as Claims & { exp: number }).exp * 1000 < Date.now() + 60000) {
      const { data, error } = await auth.auth.refreshSession({
        refresh_token: tokens.refresh_token,
      });
      if (error || !data.session) throw new HttpError(401, "La sesión expiró.");
      tokens = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      };
      c = claims(tokens.access_token);
      await pool.query(
        "update private.sessions set encrypted_tokens=$2 where id=$1",
        [row.id, seal(tokens, config.SESSION_KEY)],
      );
    }
    const { data, error } = await auth.auth.getUser(tokens.access_token);
    if (error || data.user?.id !== row.user_id)
      throw new HttpError(401, "La sesión expiró.");
    await pool.query(
      "update private.sessions set last_seen=now() where id=$1",
      [row.id],
    );
    if (!req.url.startsWith("/api/auth/") && c.aal !== "aal2") {
      const required = await pool.query(
        "select exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id join public.memberships m on m.tenant_id=mr.tenant_id and m.user_id=mr.user_id where mr.user_id=$1 and m.active and r.code='admin') or exists(select 1 from private.platform_operators where user_id=$1) required",
        [row.user_id],
      );
      if (required.rows[0].required)
        throw new HttpError(403, "Completa la autenticación de dos factores.");
    }
    const principal = {
      userId: row.user_id,
      sessionId: row.id,
      claims: c,
      tokens,
      csrf: row.csrf_hash,
    };
    req.principal = principal;
    return principal;
  }
  async function authClient(p: Principal) {
    const auth = client();
    const { error } = await auth.auth.setSession(p.tokens);
    if (error) throw new HttpError(401, "La sesión expiró.");
    return auth;
  }
  async function routes(app: FastifyInstance) {
    app.addHook("onRequest", async (req) => {
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
        if (req.headers.origin !== config.APP_ORIGIN)
          throw new HttpError(403, "Origen no permitido.");
        const publicRoutes = [
          "/api/auth/login",
          "/api/auth/recover",
          "/api/auth/reset",
          "/api/auth/invitations/accept",
        ];
        if (!publicRoutes.includes(req.url.split("?")[0])) {
          let p: Principal;
          try {
            p = await authenticate(req);
          } catch (error) {
            if (
              req.url.split("?")[0] === "/api/auth/logout" &&
              error instanceof HttpError &&
              error.statusCode === 401
            )
              return;
            throw error;
          }
          if (
            typeof req.headers["x-csrf-token"] !== "string" ||
            hash(req.headers["x-csrf-token"]) !== p.csrf
          )
            throw new HttpError(
              403,
              "La solicitud de seguridad expiró. Recarga la página.",
            );
        }
      }
    });
    app.post("/api/auth/login", async (req, reply) => {
      const input = z
        .object({
          country: z.string().default("CR"),
          type: z.enum(["national", "dimex", "other"]),
          identification: z.string().min(1).max(40),
          password: z.string().min(1).max(256),
        })
        .parse(req.body);
      await limit("ip:" + req.ip, 30);
      const value = normalizeIdentification({
        country: input.country,
        type: input.type,
        value: input.identification,
      });
      await limit("login:" + input.country + ":" + input.type + ":" + value);
      const r = await pool.query(
        "select * from private.login_directory where country=$1 and identification_type=$2 and identification=$3",
        [input.country, input.type, value],
      );
      const email =
        r.rows[0]?.email ??
        "unknown-" + hash(value).slice(0, 20) + "@invalid.example";
      const { data, error } = await client().auth.signInWithPassword({
        email,
        password: input.password,
      });
      if (error || !data.user || !data.session) {
        await pool.query(
          "insert into private.access_events(event) values('login_failed')",
        );
        throw new HttpError(401, "Identificación o contraseña incorrecta.");
      }
      const profile = await pool.query(
        "select active from public.profiles where id=$1",
        [data.user.id],
      );
      if (!profile.rows[0]?.active)
        throw new HttpError(401, "Identificación o contraseña incorrecta.");
      return issue(reply, data.user.id, {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    });
    app.get("/api/auth/session", async (req) => {
      const p = await authenticate(req);
      const r = await pool.query(
        "select name from public.profiles where id=$1",
        [p.userId],
      );
      const csrf = csrfForSession(req.cookies.cf_session!, config.SESSION_KEY);
      if (p.csrf !== hash(csrf))
        await pool.query(
          "update private.sessions set csrf_hash=$2 where id=$1",
          [p.sessionId, hash(csrf)],
        );
      const isAdmin = await pool.query(
        `select exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id join public.memberships m on m.tenant_id=mr.tenant_id and m.user_id=mr.user_id where mr.user_id=$1 and m.active and r.code='admin') or exists(select 1 from private.platform_operators where user_id=$1) required`,
        [p.userId],
      );
      const auth = await authClient(p);
      const factors = await auth.auth.mfa.listFactors();
      return {
        user: { id: p.userId, name: r.rows[0].name },
        csrf,
        aal: p.claims.aal,
        mfaRequired: isAdmin.rows[0].required,
        factors:
          factors.data?.totp.map((f) => ({ id: f.id, status: f.status })) ?? [],
      };
    });
    app.post("/api/auth/logout", async (req, reply) => {
      const p = req.principal;
      if (!p) {
        if (req.cookies.cf_session)
          await pool.query(
            "update private.sessions set revoked_at=now() where id=$1",
            [hash(req.cookies.cf_session)],
          );
        reply.clearCookie("cf_session", { path: "/" });
        return { ok: true };
      }
      await pool.query(
        "update private.sessions set revoked_at=now() where user_id=$1",
        [p.userId],
      );
      await admin.auth.admin.signOut(p.tokens.access_token, "global");
      reply.clearCookie("cf_session", { path: "/" });
      return { ok: true };
    });
    app.post("/api/auth/recover", async (req) => {
      const input = z
        .object({
          country: z.string().default("CR"),
          type: z.string(),
          identification: z.string().min(1).max(40),
        })
        .parse(req.body);
      await limit("recovery-ip:" + req.ip, 10);
      const value = normalizeIdentification({
        country: input.country,
        type: input.type,
        value: input.identification,
      });
      const r = await pool.query(
        "select email from private.login_directory where country=$1 and identification_type=$2 and identification=$3",
        [input.country, input.type, value],
      );
      if (r.rows[0])
        await client().auth.resetPasswordForEmail(r.rows[0].email, {
          redirectTo: config.APP_ORIGIN + "/reset",
        });
      return {
        message:
          "Si los datos corresponden a una cuenta, recibirás instrucciones en tu correo.",
      };
    });
    app.post("/api/auth/reset", async (req, reply) => {
      await limit("reset:" + req.ip, 10);
      const input = z
        .object({
          token_hash: z.string().min(1).optional(),
          access_token: z.string().min(20).optional(),
          refresh_token: z.string().min(1).max(4096).optional(),
          password: z.string().min(12).max(256),
        })
        .parse(req.body);
      const auth = client();
      let userId: string;
      if (input.token_hash) {
        const { data, error } = await auth.auth.verifyOtp({
          token_hash: input.token_hash,
          type: "recovery",
        });
        if (error || !data.user)
          throw new HttpError(400, "Enlace vencido o inválido.");
        userId = data.user.id;
      } else {
        if (!input.access_token || !input.refresh_token)
          throw new HttpError(400, "Enlace vencido o inválido.");
        const verified = await auth.auth.getUser(input.access_token);
        if (verified.error || !verified.data.user)
          throw new HttpError(400, "Enlace vencido o inválido.");
        const started = await auth.auth.setSession({
          access_token: input.access_token,
          refresh_token: input.refresh_token,
        });
        if (started.error)
          throw new HttpError(400, "Enlace vencido o inválido.");
        userId = verified.data.user.id;
      }
      const factors = await auth.auth.mfa.listFactors();
      if (factors.data?.totp.some((f) => f.status === "verified"))
        throw new HttpError(
          403,
          "La recuperación de una cuenta con MFA requiere el procedimiento de soporte verificado.",
        );
      const updated = await auth.auth.updateUser({ password: input.password });
      if (updated.error)
        throw new HttpError(400, "No se pudo actualizar la contraseña.");
      await pool.query(
        "update private.sessions set revoked_at=now() where user_id=$1",
        [userId],
      );
      await auth.auth.signOut({ scope: "global" });
      reply.clearCookie("cf_session", { path: "/" });
      return { ok: true };
    });
    app.post("/api/auth/mfa/enroll", async (req) => {
      const auth = await authClient(req.principal!);
      const { data, error } = await auth.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Conta Fácil",
        friendlyName: "Conta Fácil " + Date.now(),
      });
      if (error)
        throw new HttpError(400, "No se pudo iniciar el segundo factor.");
      return {
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      };
    });
    app.post("/api/auth/mfa/verify", async (req) => {
      const p = req.principal!,
        input = z
          .object({ factorId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
          .parse(req.body);
      await limit("mfa:" + p.userId, 12);
      const auth = await authClient(p);
      const { data, error } = await auth.auth.mfa.challengeAndVerify({
        factorId: input.factorId,
        code: input.code,
      });
      if (error || !data)
        throw new HttpError(400, "Código incorrecto o vencido.");
      await pool.query(
        "update private.sessions set encrypted_tokens=$2 where id=$1",
        [
          p.sessionId,
          seal(
            {
              access_token: data.access_token,
              refresh_token: data.refresh_token,
            },
            config.SESSION_KEY,
          ),
        ],
      );
      return { ok: true };
    });
  }
  return { authenticate, admin, client, limit, routes };
}
