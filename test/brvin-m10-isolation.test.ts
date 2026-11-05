import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAuthorizedProjectsV2,
  retrieveBrvinForApplicationV2,
} from "../src/brvin/service-core";

const ENV_A = "00000000-0000-4000-8000-0000000000a1";
const ENV_B = "00000000-0000-4000-8000-0000000000b1";
const APP_A = "00000000-0000-4000-8000-0000000000a2";
const APP_B = "00000000-0000-4000-8000-0000000000b2";

type Project = { id: string; name: string; slug: string; description: string; status: string };
type Book = {
  id: string;
  title: string;
  search_prefix: string;
  page_count: number;
  indexed_pages: number;
  status: string;
  collection_id: string;
};

const teacherA: Project = {
  id: "teacher-a",
  name: "Teacher A Mathematics",
  slug: "teacher-a-mathematics",
  description: "Private knowledge for Teacher A",
  status: "active",
};
const teacherB: Project = {
  id: "teacher-b",
  name: "Teacher B Mathematics",
  slug: "teacher-b-mathematics",
  description: "Private knowledge for Teacher B",
  status: "active",
};
const shared: Project = {
  id: "shared",
  name: "Shared Exam Reference",
  slug: "shared-exam-reference",
  description: "Intentionally shared reference material",
  status: "active",
};

function makeHarness() {
  const projects = new Map([teacherA, teacherB, shared].map(project => [project.id, project]));
  const identities = new Map([
    [ENV_A, {
      environment_id: ENV_A, application_id: APP_A, environment_key: "production",
      environment_status: "active", resolved_application_id: APP_A,
      application_slug: "teacher-a-app", application_status: "active",
    }],
    [ENV_B, {
      environment_id: ENV_B, application_id: APP_B, environment_key: "production",
      environment_status: "active", resolved_application_id: APP_B,
      application_slug: "teacher-b-app", application_status: "active",
    }],
  ]);
  const grants = [
    { application_id: APP_A, project_id: teacherA.id, status: "active" },
    { application_id: APP_A, project_id: shared.id, status: "active" },
    { application_id: APP_B, project_id: teacherB.id, status: "active" },
    { application_id: APP_B, project_id: shared.id, status: "active" },
  ];
  const directBooks = [
    { project_id: teacherA.id, book_id: "book-a-direct" },
    { project_id: teacherB.id, book_id: "book-b-direct" },
    { project_id: shared.id, book_id: "book-shared" },
  ];
  const collectionGrants = [
    { project_id: teacherA.id, collection_id: "collection-a" },
    { project_id: teacherB.id, collection_id: "collection-b" },
  ];
  const books: Book[] = [
    { id: "book-a-direct", title: "Teacher A private formula", search_prefix: "teacher-a/direct/", page_count: 1, indexed_pages: 1, status: "ready", collection_id: "none" },
    { id: "book-a-collection", title: "Teacher A collection notes", search_prefix: "teacher-a/collection/", page_count: 1, indexed_pages: 1, status: "ready", collection_id: "collection-a" },
    { id: "book-a-unready", title: "Teacher A unready draft", search_prefix: "teacher-a/unready/", page_count: 2, indexed_pages: 1, status: "processing", collection_id: "collection-a" },
    { id: "book-b-direct", title: "Teacher B private method", search_prefix: "teacher-b/direct/", page_count: 1, indexed_pages: 1, status: "ready", collection_id: "none" },
    { id: "book-b-collection", title: "Teacher B collection notes", search_prefix: "teacher-b/collection/", page_count: 1, indexed_pages: 1, status: "ready", collection_id: "collection-b" },
    { id: "book-shared", title: "Shared exam reference", search_prefix: "shared/reference/", page_count: 1, indexed_pages: 1, status: "ready", collection_id: "none" },
    { id: "book-unassigned", title: "Unassigned source", search_prefix: "unassigned/source/", page_count: 1, indexed_pages: 1, status: "ready", collection_id: "none" },
  ];
  const search = vi.fn(async () => ({
    chunks: books
      .filter(book => book.status === "ready" && book.indexed_pages === book.page_count)
      .map(book => ({
        id: book.id + "-page-1",
        text: "unique knowledge retrieval " + book.title + " with a source-specific explanation",
        score: 0.99,
        item: { key: book.search_prefix + "page-000001.txt" },
      })),
  }));
  const statements: string[] = [];
  const DB = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM brvin_application_environments")) {
                return identities.get(String(values[0])) ?? null;
              }
              if (sql.includes("FROM brvin_application_project_grants g") &&
                  sql.includes("JOIN brvin_projects p") &&
                  sql.includes("WHERE g.application_id=?")) {
                const grant = grants.find(item =>
                  item.application_id === values[0] &&
                  item.project_id === values[1] &&
                  item.status === "active"
                );
                const project = grant ? projects.get(grant.project_id) : null;
                return project ?? null;
              }
              if (sql.includes("INSERT INTO brvin_project_search_usage")) return { query_count: 1 };
              if (sql.includes("SELECT query_count FROM brvin_project_search_usage")) return { query_count: 1 };
              return null;
            },
            async all() {
              if (sql.includes("FROM brvin_books b")) {
                const projectId = String(values[0]);
                const project = projects.get(projectId);
                if (!project || project.status !== "active") return { results: [] };
                const allowedBookIds = new Set(directBooks
                  .filter(item => item.project_id === projectId)
                  .map(item => item.book_id));
                const allowedCollections = new Set(collectionGrants
                  .filter(item => item.project_id === projectId)
                  .map(item => item.collection_id));
                const results = books
                  .filter(book =>
                    book.status === "ready" &&
                    book.indexed_pages === book.page_count &&
                    (allowedBookIds.has(book.id) || allowedCollections.has(book.collection_id))
                  )
                  .map(({ id, title, search_prefix, page_count }) => ({ id, title, search_prefix, page_count }));
                return { results };
              }
              if (sql.includes("FROM brvin_application_project_grants") && sql.includes("ORDER BY p.name")) {
                const applicationId = String(values[0]);
                const results = grants
                  .filter(grant => grant.application_id === applicationId && grant.status === "active")
                  .map(grant => projects.get(grant.project_id))
                  .filter((project): project is Project => Boolean(project && project.status === "active"));
                return { results };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const env = {
    DB,
    BRVIN_SEARCH: { get: () => ({ search, items: { list: vi.fn(), get: vi.fn() } }) },
    BRVIN_SEARCH_INSTANCE: "shared-index",
    BRVIN_MIN_SCORE: "0.2",
    BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT: "800",
  } as any;

  return { env, projects, identities, grants, directBooks, collectionGrants, books, search, statements };
}

describe("BRVIN M10 teacher project isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only the projects explicitly granted to each application's trusted environment", async () => {
    const h = makeHarness();
    const a = await listAuthorizedProjectsV2(h.env, ENV_A);
    const b = await listAuthorizedProjectsV2(h.env, ENV_B);

    expect(a).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({ projectId: "teacher-a", ready: true, authorizedSourceCount: 2 }),
        expect.objectContaining({ projectId: "shared", ready: true, authorizedSourceCount: 1 }),
      ]),
    });
    expect(a.ok && a.data.map(project => project.projectId)).not.toContain("teacher-b");
    expect(b).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({ projectId: "teacher-b", ready: true, authorizedSourceCount: 2 }),
        expect.objectContaining({ projectId: "shared", ready: true, authorizedSourceCount: 1 }),
      ]),
    });
    expect(b.ok && b.data.map(project => project.projectId)).not.toContain("teacher-a");
  });

  it("denies Teacher B access to Teacher A's project before quota reservation or search", async () => {
    const h = makeHarness();

    const result = await retrieveBrvinForApplicationV2(h.env, ENV_B, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });

    expect(result).toMatchObject({ ok: false, code: "PROJECT_NOT_AUTHORIZED", retryable: false });
    expect(h.statements.some(sql => sql.includes("INSERT INTO brvin_project_search_usage"))).toBe(false);
    expect(h.search).not.toHaveBeenCalled();
  });

  it("denies Teacher A access to Teacher B's project and prevents guessed project IDs from widening access", async () => {
    const h = makeHarness();

    const result = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherB.id, queries: ["unique knowledge retrieval"],
    });

    expect(result).toMatchObject({ ok: false, code: "PROJECT_NOT_AUTHORIZED" });
    expect(h.search).not.toHaveBeenCalled();
  });

  it("searches only the direct-book and collection sources assigned to the requested teacher project", async () => {
    const h = makeHarness();

    const result = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        searchedSources: 2,
        passages: expect.arrayContaining([
          expect.objectContaining({ bookId: "book-a-direct" }),
          expect.objectContaining({ bookId: "book-a-collection" }),
        ]),
      },
    });
    expect(result.ok && result.data.passages.map(item => item.bookId)).not.toContain("book-b-direct");
    expect(result.ok && result.data.passages.map(item => item.bookId)).not.toContain("book-shared");
    expect(result.ok && result.data.passages.map(item => item.bookId)).not.toContain("book-unassigned");
    expect(result.ok && result.data.passages.map(item => item.bookId)).not.toContain("book-a-unready");
    expect(h.search).toHaveBeenCalledWith(expect.objectContaining({
      ai_search_options: {
        retrieval: expect.objectContaining({
          filters: { folder: { $in: ["teacher-a/direct/", "teacher-a/collection/"] } },
        }),
      },
    }));
  });

  it("allows intentionally shared knowledge to both apps without exposing either teacher's private sources", async () => {
    const h = makeHarness();

    const [a, b] = await Promise.all([
      retrieveBrvinForApplicationV2(h.env, ENV_A, { projectId: shared.id, queries: ["unique knowledge retrieval"] }),
      retrieveBrvinForApplicationV2(h.env, ENV_B, { projectId: shared.id, queries: ["unique knowledge retrieval"] }),
    ]);

    for (const result of [a, b]) {
      expect(result).toMatchObject({
        ok: true,
        data: { searchedSources: 1, passages: [expect.objectContaining({ bookId: "book-shared" })] },
      });
      expect(result.ok && result.data.passages.map(item => item.bookId)).not.toContain("book-a-direct");
      expect(result.ok && result.data.passages.map(item => item.bookId)).not.toContain("book-b-direct");
    }
  });

  it("denies the very next retrieval after an application-project grant is revoked", async () => {
    const h = makeHarness();
    const allowed = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });
    expect(allowed.ok).toBe(true);

    const grant = h.grants.find(item => item.application_id === APP_A && item.project_id === teacherA.id);
    expect(grant).toBeDefined();
    if (grant) grant.status = "revoked";

    h.search.mockClear();
    h.statements.length = 0;
    const denied = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });

    expect(denied).toMatchObject({ ok: false, code: "PROJECT_NOT_AUTHORIZED" });
    expect(h.search).not.toHaveBeenCalled();
    expect(h.statements.some(sql => sql.includes("INSERT INTO brvin_project_search_usage"))).toBe(false);
  });

  it("automatically includes future ready books added to a collection already granted to a project", async () => {
    const h = makeHarness();
    const before = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });
    expect(before).toMatchObject({ ok: true, data: { searchedSources: 2 } });

    h.books.push({
      id: "book-a-added-later",
      title: "Teacher A later collection addition",
      search_prefix: "teacher-a/collection-later/",
      page_count: 1,
      indexed_pages: 1,
      status: "ready",
      collection_id: "collection-a",
    });
    const after = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });

    expect(after).toMatchObject({
      ok: true,
      data: {
        searchedSources: 3,
        passages: expect.arrayContaining([expect.objectContaining({ bookId: "book-a-added-later" })]),
      },
    });
  });

  it("fails closed for inactive projects and environments", async () => {
    const h = makeHarness();
    const project = h.projects.get(teacherA.id);
    if (project) project.status = "inactive";
    const inactiveProject = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: teacherA.id, queries: ["unique knowledge retrieval"],
    });
    expect(inactiveProject).toMatchObject({ ok: false, code: "PROJECT_INACTIVE" });
    expect(h.search).not.toHaveBeenCalled();

    const identity = h.identities.get(ENV_A);
    if (identity) identity.environment_status = "revoked";
    const inactiveEnvironment = await retrieveBrvinForApplicationV2(h.env, ENV_A, {
      projectId: shared.id, queries: ["unique knowledge retrieval"],
    });
    expect(inactiveEnvironment).toMatchObject({ ok: false, code: "ENVIRONMENT_INACTIVE" });
  });
});
