import type { Env } from "../config/env";
import { ensureAnalyticsSchema, recordBrvinActivity } from "../analytics/db";
import { json } from "../http/response";
import { BrvinRetrievalError, retrieveBrvinProjectContext } from "./retrieval";

type AdminRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const APP_STATUSES = ["active", "suspended", "revoked"] as const;
const ENVIRONMENT_STATUSES = ["active", "disabled", "revoked"] as const;

function message(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\r\n]+/gu, " ").slice(0, 240);
}

function fail(error: string, status: number): Response {
  return json({ ok: false, error }, status);
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

function makeSlug(value: string, max: number): string {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, max)
    .replace(/-+$/gu, "");
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function record(
  env: Env,
  eventType: string,
  messageText: string,
  details: Record<string, unknown>,
  projectId?: string,
): Promise<void> {
  await recordBrvinActivity(env, {
    projectId,
    agent: "BRVIN application administration",
    phase: "governance",
    eventType,
    status: "completed",
    message: messageText,
    details: { actor: "admin-dashboard", ...details },
  });
}

/**
 * Administrator-only registry read model. Environment IDs are shown here
 * because the protected dashboard is where an engineer/admin copies the
 * trusted identity for a reviewed Service Binding configuration.
 */
export async function brvinApplications(env: Env): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  try {
    await ensureAnalyticsSchema(env);
    const [applications, environments, grants, projects] = await Promise.all([
      env.DB.prepare(
        "SELECT id,slug,name,description,status,created_at,updated_at " +
        "FROM brvin_applications ORDER BY name COLLATE NOCASE"
      ).all<AdminRow>(),
      env.DB.prepare(
        "SELECT id,application_id,environment_key,display_name,status,created_at,updated_at,revoked_at,revoked_by " +
        "FROM brvin_application_environments ORDER BY application_id,environment_key,created_at"
      ).all<AdminRow>(),
      env.DB.prepare(
        "SELECT g.id,g.application_id,g.project_id,g.status,g.created_at,g.created_by,g.revoked_at,g.revoked_by," +
        "p.name AS project_name,p.slug AS project_slug,p.status AS project_status " +
        "FROM brvin_application_project_grants g " +
        "JOIN brvin_projects p ON p.id=g.project_id " +
        "ORDER BY g.application_id,p.name COLLATE NOCASE,g.created_at DESC"
      ).all<AdminRow>(),
      env.DB.prepare(
        "SELECT id,name,slug,description,status,created_at,updated_at " +
        "FROM brvin_projects ORDER BY name COLLATE NOCASE"
      ).all<AdminRow>(),
    ]);

    const environmentRows = environments.results ?? [];
    const grantRows = grants.results ?? [];
    const projectRows = projects.results ?? [];
    const items = (applications.results ?? []).map((app) => {
      const appId = String(app.id);
      const appEnvironments = environmentRows
        .filter((item) => item.application_id === appId)
        .map((item) => ({
          id: String(item.id),
          environmentKey: String(item.environment_key),
          displayName: String(item.display_name ?? ""),
          status: String(item.status),
          createdAt: Number(item.created_at ?? 0),
          updatedAt: Number(item.updated_at ?? 0),
          revokedAt: item.revoked_at === null || item.revoked_at === undefined
            ? null : Number(item.revoked_at),
          revokedBy: item.revoked_by ? String(item.revoked_by) : null,
        }));
      const appGrants = grantRows
        .filter((item) => item.application_id === appId)
        .map((item) => ({
          id: String(item.id),
          projectId: String(item.project_id),
          projectName: String(item.project_name ?? ""),
          projectSlug: String(item.project_slug ?? ""),
          projectStatus: String(item.project_status ?? ""),
          status: String(item.status),
          createdAt: Number(item.created_at ?? 0),
          createdBy: item.created_by ? String(item.created_by) : null,
          revokedAt: item.revoked_at === null || item.revoked_at === undefined
            ? null : Number(item.revoked_at),
          revokedBy: item.revoked_by ? String(item.revoked_by) : null,
        }));
      return {
        id: appId,
        slug: String(app.slug),
        name: String(app.name),
        description: String(app.description ?? ""),
        status: String(app.status),
        createdAt: Number(app.created_at ?? 0),
        updatedAt: Number(app.updated_at ?? 0),
        environments: appEnvironments,
        grants: appGrants,
        activeEnvironmentCount: appEnvironments.filter((item) => item.status === "active").length,
        activeProjectCount: appGrants.filter((item) =>
          item.status === "active" && item.projectStatus === "active"
        ).length,
      };
    });

    return json({
      ok: true,
      applications: items,
      projects: projectRows.map((project) => ({
        id: String(project.id),
        name: String(project.name),
        slug: String(project.slug),
        description: String(project.description ?? ""),
        status: String(project.status),
        createdAt: Number(project.created_at ?? 0),
        updatedAt: Number(project.updated_at ?? 0),
      })),
    });
  } catch (error) {
    return json({ ok: false, error: message(error) }, 502);
  }
}

export async function createBrvinApplication(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid application details.", 400);

  const name = cleanText(body.name, 100);
  const description = cleanText(body.description, 500);
  const slug = makeSlug(name, 64);
  const environmentKey = makeSlug(cleanText(body.environmentKey, 64) || "production", 32);
  const displayName = cleanText(body.environmentDisplayName, 80) ||
    (environmentKey ? environmentKey[0].toUpperCase() + environmentKey.slice(1) : "");
  if (!name || !slug) return fail("Enter an application name that can form a valid slug.", 400);
  if (!environmentKey) return fail("Enter a valid first environment key.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const existing = await env.DB.prepare(
      "SELECT id FROM brvin_applications WHERE slug = ?"
    ).bind(slug).first<{ id: string }>();
    if (existing) return fail("An application with this slug already exists. Choose a different name.", 409);

    const now = Date.now();
    const applicationId = crypto.randomUUID().toLowerCase();
    const environmentId = crypto.randomUUID().toLowerCase();
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO brvin_applications (id,slug,name,description,status,created_at,updated_at) " +
        "VALUES (?,?,?,?, 'active',?,?)"
      ).bind(applicationId, slug, name, description, now, now),
      env.DB.prepare(
        "INSERT INTO brvin_application_environments " +
        "(id,application_id,environment_key,display_name,status,created_at,updated_at) " +
        "SELECT ?,id,?,?, 'active',?,? FROM brvin_applications WHERE id=? AND status='active'"
      ).bind(environmentId, environmentKey, displayName, now, now, applicationId),
    ]);
    if (results.some((result) => !result.success)) {
      throw new Error("D1 did not confirm the application and first environment transaction.");
    }

    const [createdApplication, createdEnvironment] = await Promise.all([
      env.DB.prepare(
        "SELECT id,slug,name,description,status FROM brvin_applications WHERE id=?"
      ).bind(applicationId).first<AdminRow>(),
      env.DB.prepare(
        "SELECT id,application_id,environment_key,display_name,status " +
        "FROM brvin_application_environments WHERE id=?"
      ).bind(environmentId).first<AdminRow>(),
    ]);
    if (
      createdApplication?.id !== applicationId ||
      createdEnvironment?.id !== environmentId ||
      createdEnvironment.application_id !== applicationId
    ) {
      throw new Error("The new application identity could not be verified after creation.");
    }

    await record(env, "application.created",
      "A BRVIN application and its first trusted environment identity were created.",
      { applicationId, applicationSlug: slug, environmentId, environmentKey });

    return json({
      ok: true,
      application: {
        id: applicationId, slug, name, description, status: "active",
      },
      environment: {
        id: environmentId, environmentKey, displayName, status: "active",
      },
    }, 201);
  } catch (error) {
    return json({ ok: false, error: message(error) }, 409);
  }
}

export async function createBrvinEnvironment(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid environment details.", 400);
  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  const environmentKey = makeSlug(cleanText(body.environmentKey, 64), 32);
  const displayName = cleanText(body.displayName, 80) ||
    (environmentKey ? environmentKey[0].toUpperCase() + environmentKey.slice(1) : "");
  if (!isUuid(applicationId)) return fail("Select a valid application.", 400);
  if (!environmentKey) return fail("Enter a valid environment key.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const application = await env.DB.prepare(
      "SELECT id,status FROM brvin_applications WHERE id=?"
    ).bind(applicationId).first<{ id: string; status: string }>();
    if (!application) return fail("Application not found.", 404);
    if (application.status !== "active") return fail("Only an active application can receive a new environment.", 409);

    const existing = await env.DB.prepare(
      "SELECT id,status FROM brvin_application_environments " +
      "WHERE application_id=? AND environment_key=? ORDER BY created_at DESC LIMIT 1"
    ).bind(applicationId, environmentKey).first<{ id: string; status: string }>();

    if (existing?.status === "active") {
      return fail("This application already has an active environment with that key.", 409);
    }

    const now = Date.now();
    if (existing?.status === "disabled") {
      await env.DB.prepare(
        "UPDATE brvin_application_environments SET status='active',display_name=?,updated_at=? " +
        "WHERE id=? AND status='disabled'"
      ).bind(displayName, now, existing.id).run();
      await record(env, "application.environment_reactivated",
        "A disabled BRVIN environment identity was reactivated by an administrator.",
        { applicationId, environmentId: existing.id, environmentKey });
      return json({
        ok: true,
        reactivated: true,
        environment: { id: existing.id, environmentKey, displayName, status: "active" },
      });
    }

    const environmentId = crypto.randomUUID().toLowerCase();
    const result = await env.DB.prepare(
      "INSERT INTO brvin_application_environments " +
      "(id,application_id,environment_key,display_name,status,created_at,updated_at) " +
      "VALUES (?,?,?,?, 'active',?,?)"
    ).bind(environmentId, applicationId, environmentKey, displayName, now, now).run();
    if (!result.success) throw new Error("D1 did not confirm the new environment identity.");

    await record(env, "application.environment_created",
      "A new trusted BRVIN environment identity was created.",
      { applicationId, environmentId, environmentKey });
    return json({
      ok: true,
      reactivated: false,
      environment: { id: environmentId, environmentKey, displayName, status: "active" },
    }, 201);
  } catch (error) {
    return json({ ok: false, error: message(error) }, 409);
  }
}

export async function setBrvinApplicationStatus(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid application status details.", 400);
  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!isUuid(applicationId)) return fail("Select a valid application.", 400);
  if (!isOneOf(status, APP_STATUSES)) return fail("Choose active, suspended or revoked.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const application = await env.DB.prepare(
      "SELECT id,slug,status FROM brvin_applications WHERE id=?"
    ).bind(applicationId).first<{ id: string; slug: string; status: string }>();
    if (!application) return fail("Application not found.", 404);
    if (application.status === "revoked" && status !== "revoked") {
      return fail("A revoked application identity cannot be reactivated. Create a new application identity instead.", 409);
    }
    if (application.status === status) {
      return json({ ok: true, applicationId, status, unchanged: true });
    }
    if (application.status === "suspended" && status === "revoked") {
      // Revocation is allowed from the suspended state as an explicit final action.
    }
    if (application.status === "active" && status === "active") {
      return json({ ok: true, applicationId, status, unchanged: true });
    }

    const now = Date.now();
    const statements = [
      env.DB.prepare(
        "UPDATE brvin_applications SET status=?,updated_at=? WHERE id=?"
      ).bind(status, now, applicationId),
    ];
    if (status === "revoked") {
      statements.push(
        env.DB.prepare(
          "UPDATE brvin_application_environments SET status='revoked',revoked_at=?,revoked_by='admin-dashboard',updated_at=? " +
          "WHERE application_id=? AND status IN ('active','disabled')"
        ).bind(now, now, applicationId),
        env.DB.prepare(
          "UPDATE brvin_application_project_grants SET status='revoked',revoked_at=?,revoked_by='admin-dashboard' " +
          "WHERE application_id=? AND status='active'"
        ).bind(now, applicationId),
      );
    }
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("D1 did not confirm the application status change.");

    await record(env, status === "revoked" ? "application.revoked"
      : status === "suspended" ? "application.suspended" : "application.reactivated",
    "A BRVIN application access status was changed by an administrator.",
    { applicationId, applicationSlug: application.slug, previousStatus: application.status, status });
    return json({ ok: true, applicationId, status });
  } catch (error) {
    return json({ ok: false, error: message(error) }, 502);
  }
}

export async function setBrvinEnvironmentStatus(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid environment status details.", 400);
  const environmentId = typeof body.environmentId === "string" ? body.environmentId : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!isUuid(environmentId)) return fail("Select a valid environment identity.", 400);
  if (!isOneOf(status, ENVIRONMENT_STATUSES)) return fail("Choose active, disabled or revoked.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const environment = await env.DB.prepare(
      "SELECT e.id,e.application_id,e.environment_key,e.status,a.status AS application_status " +
      "FROM brvin_application_environments e JOIN brvin_applications a ON a.id=e.application_id WHERE e.id=?"
    ).bind(environmentId).first<{
      id: string; application_id: string; environment_key: string; status: string; application_status: string;
    }>();
    if (!environment) return fail("Environment identity not found.", 404);
    if (environment.status === "revoked" && status !== "revoked") {
      return fail("A revoked environment identity cannot be reactivated. Create a new environment identity instead.", 409);
    }
    if (status === "active" && environment.application_status !== "active") {
      return fail("Reactivate the parent application before activating this environment.", 409);
    }
    if (environment.status === status) {
      return json({ ok: true, environmentId, status, unchanged: true });
    }
    const now = Date.now();
    const result = status === "revoked"
      ? await env.DB.prepare(
        "UPDATE brvin_application_environments SET status='revoked',revoked_at=?,revoked_by='admin-dashboard',updated_at=? WHERE id=? AND status IN ('active','disabled')"
      ).bind(now, now, environmentId).run()
      : status === "disabled"
        ? await env.DB.prepare(
          "UPDATE brvin_application_environments SET status='disabled',updated_at=? WHERE id=? AND status='active'"
        ).bind(now, environmentId).run()
        : await env.DB.prepare(
          "UPDATE brvin_application_environments SET status='active',updated_at=? WHERE id=? AND status='disabled'"
        ).bind(now, environmentId).run();
    if (!result.success) throw new Error("D1 did not confirm the environment status change.");

    await record(env, status === "revoked" ? "application.environment_revoked"
      : status === "disabled" ? "application.environment_disabled" : "application.environment_reactivated",
    "A BRVIN environment identity status was changed by an administrator.",
    { applicationId: environment.application_id, environmentId, environmentKey: environment.environment_key, previousStatus: environment.status, status });
    return json({ ok: true, environmentId, status });
  } catch (error) {
    return json({ ok: false, error: message(error) }, 502);
  }
}

export async function setBrvinProjectGrant(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid project-grant details.", 400);
  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!isUuid(applicationId)) return fail("Select a valid application.", 400);
  if (!projectId || projectId.length > 128) return fail("Select a valid project.", 400);
  if (action !== "grant" && action !== "revoke") return fail("Choose grant or revoke.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const [application, project, activeGrant] = await Promise.all([
      env.DB.prepare("SELECT id,status FROM brvin_applications WHERE id=?")
        .bind(applicationId).first<{ id: string; status: string }>(),
      env.DB.prepare("SELECT id,status FROM brvin_projects WHERE id=?")
        .bind(projectId).first<{ id: string; status: string }>(),
      env.DB.prepare(
        "SELECT id FROM brvin_application_project_grants WHERE application_id=? AND project_id=? AND status='active'"
      ).bind(applicationId, projectId).first<{ id: string }>(),
    ]);
    if (!application) return fail("Application not found.", 404);
    if (!project) return fail("Project not found.", 404);

    if (action === "grant") {
      if (application.status !== "active") return fail("Only an active application can receive project access.", 409);
      if (project.status !== "active") return fail("Activate the project before granting it to an application.", 409);
      if (activeGrant) return json({ ok: true, applicationId, projectId, status: "active", unchanged: true });

      const id = crypto.randomUUID().toLowerCase();
      const now = Date.now();
      const result = await env.DB.prepare(
        "INSERT INTO brvin_application_project_grants " +
        "(id,application_id,project_id,status,created_at,created_by) VALUES (?,?,?,'active',?,'admin-dashboard')"
      ).bind(id, applicationId, projectId, now).run();
      if (!result.success) throw new Error("D1 did not confirm the application-project grant.");
      await record(env, "application.project_granted",
        "A BRVIN project was granted to an application.",
        { applicationId, projectId, grantId: id }, projectId);
      return json({ ok: true, applicationId, projectId, grantId: id, status: "active" }, 201);
    }

    if (!activeGrant) return json({ ok: true, applicationId, projectId, status: "revoked", unchanged: true });
    const now = Date.now();
    const result = await env.DB.prepare(
      "UPDATE brvin_application_project_grants SET status='revoked',revoked_at=?,revoked_by='admin-dashboard' " +
      "WHERE id=? AND status='active'"
    ).bind(now, activeGrant.id).run();
    if (!result.success) throw new Error("D1 did not confirm the project-grant revocation.");
    await record(env, "application.project_grant_revoked",
      "A BRVIN application-project grant was revoked.",
      { applicationId, projectId, grantId: activeGrant.id }, projectId);
    return json({ ok: true, applicationId, projectId, grantId: activeGrant.id, status: "revoked" });
  } catch (error) {
    return json({ ok: false, error: message(error) }, 409);
  }
}

export async function updateBrvinProject(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid project details.", 400);
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const name = cleanText(body.name, 100);
  const description = cleanText(body.description, 500);
  const slug = makeSlug(name, 64);
  if (!projectId || projectId.length > 128) return fail("Select a valid project.", 400);
  if (!name || !slug) return fail("Enter a valid project name.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB.prepare(
      "SELECT p.id,p.name,p.slug,p.status," +
      "EXISTS(SELECT 1 FROM brvin_service_clients c WHERE c.project_id=p.id) AS has_legacy_identity " +
      "FROM brvin_projects p WHERE p.id=?"
    ).bind(projectId).first<{
      id: string; name: string; slug: string; status: string; has_legacy_identity: number;
    }>();
    if (!project) return fail("Project not found.", 404);

    // A v1 client ID is deployment configuration. Never silently rewrite it
    // when an administrator edits a legacy project's display name.
    const finalSlug = Number(project.has_legacy_identity) > 0 ? project.slug : slug;
    const result = await env.DB.prepare(
      "UPDATE brvin_projects SET name=?,slug=?,description=?,updated_at=? WHERE id=?"
    ).bind(name, finalSlug, description, Date.now(), projectId).run();
    if (!result.success) throw new Error("D1 did not confirm the project update.");

    await record(env, "project.updated",
      "A BRVIN project name or description was updated.",
      { projectId, previousName: project.name, name, slug: finalSlug, legacySlugPreserved: finalSlug === project.slug },
      projectId,
    );
    return json({
      ok: true,
      project: { id: projectId, name, slug: finalSlug, description, status: project.status },
      legacySlugPreserved: finalSlug === project.slug,
    });
  } catch (error) {
    return json({ ok: false, error: message(error) }, 409);
  }
}

export async function testBrvinProjectKnowledge(env: Env, request: Request): Promise<Response> {
  const body = await readObject(request);
  if (!body) return fail("Enter a text query for this project.", 400);
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const query = cleanText(body.query, 2_000);
  if (!projectId || projectId.length > 128) return fail("Select a valid project.", 400);
  if (!query) return fail("Enter a query to test the project's knowledge.", 400);
  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB!.prepare(
      "SELECT id,name,slug,status FROM brvin_projects WHERE id=?"
    ).bind(projectId).first<{ id: string; name: string; slug: string; status: string }>();
    if (!project) return fail("Project not found.", 404);
    if (project.status !== "active") return fail("Activate this project before testing its knowledge.", 409);

    const context = await retrieveBrvinProjectContext(env, project.slug, query);
    return json({
      ok: true,
      project: { id: project.id, name: project.name, slug: project.slug },
      query,
      searchedSources: context.searchedSources,
      searchCount: context.searchCount,
      passages: context.passages.map((passage) => ({
        id: passage.id,
        bookTitle: passage.bookTitle,
        pdfPage: passage.pdfPage,
        printedPage: passage.printedPage,
        section: passage.section,
        score: passage.score,
        citation: passage.bookTitle + " — PDF page " + passage.pdfPage +
          (passage.printedPage ? " · printed page " + passage.printedPage : ""),
        text: passage.text,
      })),
    });
  } catch (error) {
    if (error instanceof BrvinRetrievalError) {
      return fail(error.message, error.retryable ? 502 : 409);
    }
    return fail(message(error), 502);
  }
}

export async function setBrvinProjectStatus(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return fail("The BRVIN database is not configured.", 503);
  const body = await readObject(request);
  if (!body) return fail("Enter valid project status details.", 400);
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!projectId || projectId.length > 128) return fail("Select a valid project.", 400);
  if (status !== "active" && status !== "inactive") return fail("Choose active or inactive.", 400);

  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB.prepare(
      "SELECT id,name,status FROM brvin_projects WHERE id=?"
    ).bind(projectId).first<{ id: string; name: string; status: string }>();
    if (!project) return fail("Project not found.", 404);
    if (project.status === status) return json({ ok: true, projectId, status, unchanged: true });

    const now = Date.now();
    const result = await env.DB.prepare(
      "UPDATE brvin_projects SET status=?,updated_at=? WHERE id=?"
    ).bind(status, now, projectId).run();
    if (!result.success) throw new Error("D1 did not confirm the project status change.");
    await record(env, status === "inactive" ? "project.deactivated" : "project.activated",
      "A BRVIN project was " + (status === "inactive" ? "deactivated." : "activated."),
      { projectId, projectName: project.name, previousStatus: project.status, status }, projectId);
    return json({ ok: true, projectId, status });
  } catch (error) {
    return json({ ok: false, error: message(error) }, 502);
  }
}
