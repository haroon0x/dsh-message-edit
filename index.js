/**
 * Host half of the message-edit bundle.
 *
 * Registers `POST /api/message-edit.rewind`, which restores every file the
 * addressed turn changed back to its turn-start content. Restoration data
 * comes from the `workspaceChanges` recorder: each listed file's diff holds
 * the turn's hunks, and a file is only restored when its current content
 * still matches the recorded turn-end side — a file edited again after the
 * turn is skipped rather than clobbered.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

/** Rewind route path; the Connection fetch bridge fences it to the owner. */
const REWIND_PATH = "/api/message-edit.rewind";

/** Services the rewind handler reads. */
export const inject = ["connection", "workspaceChanges"];

/**
 * Register the rewind route in Connection's authentication fence.
 * @param ctx - host context carrying the change recorder.
 */
export function apply(ctx) {
  ctx.connection.fetch.register({
    path: REWIND_PATH,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: (request) => handleRewind(ctx, request),
  });
}

/**
 * Restore the files one turn changed to their turn-start contents.
 * @param ctx - host context carrying the change recorder.
 * @param request - POST with JSON `{ sessionId, changesSeq }`.
 * @returns per-file outcomes as JSON.
 */
async function handleRewind(ctx, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }
  const { sessionId, changesSeq } = body ?? {};
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    !Number.isSafeInteger(changesSeq) ||
    changesSeq < 0
  ) {
    return new Response("Invalid rewind coordinates.", { status: 400 });
  }
  const summary = ctx.workspaceChanges.summary(sessionId, changesSeq);
  if (summary === void 0) {
    return new Response("Change summary unavailable.", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const results = [];
  for (let index = 0; index < summary.files.length; index++) {
    results.push(await rewindFile(ctx, summary, sessionId, changesSeq, index, request.signal));
  }
  const reverted = results.filter(
    (result) => result.status === "restored" || result.status === "deleted",
  ).length;
  return Response.json(
    { reverted, skipped: results.length - reverted, files: results },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Restore one listed file, skipping anything the turn itself could not have
 * produced (content drifted after the turn) or that has no recorded diff.
 * @returns `{ display, status, reason? }` — status `restored`, `deleted`,
 *   `skipped`, or `failed`.
 */
async function rewindFile(ctx, summary, sessionId, changesSeq, index, signal) {
  const file = summary.files[index];
  const absolute = path.isAbsolute(file.path)
    ? path.normalize(file.path)
    : path.join(summary.cwd, file.path);
  if (!path.isAbsolute(file.path)) {
    const root = summary.cwd.endsWith(path.sep) ? summary.cwd : summary.cwd + path.sep;
    if (absolute !== summary.cwd && !absolute.startsWith(root)) {
      return { display: file.display, status: "skipped", reason: "outside-workspace" };
    }
  }
  let diff;
  try {
    diff = await ctx.workspaceChanges.diff(sessionId, changesSeq, index, signal);
  } catch {
    return { display: file.display, status: "skipped", reason: "diff-error" };
  }
  if (diff === void 0 || diff.kind !== "text") {
    return { display: file.display, status: "skipped", reason: diff?.kind ?? "no-diff" };
  }
  let current = null;
  try {
    current = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
  } catch {
    return { display: file.display, status: "skipped", reason: "read-error" };
  }
  if (diff.before === false && current === null) {
    return { display: file.display, status: "skipped", reason: "already-gone" };
  }
  const restored = applyReverseHunks(current ?? "", diff);
  if (restored === void 0) {
    return { display: file.display, status: "skipped", reason: "changed-after-turn" };
  }
  try {
    if (diff.before === false) {
      rmSync(absolute, { force: true });
      return { display: file.display, status: "deleted" };
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, restored);
    return { display: file.display, status: "restored" };
  } catch {
    return { display: file.display, status: "failed" };
  }
}

/**
 * Rebuild the turn-start content from the current turn-end content by
 * undoing every recorded hunk. Verification of each hunk against the
 * current lines makes a file that drifted after the turn un-restorable.
 * @param current - current file content.
 * @param diff - the turn's recorded diff.
 * @returns turn-start content, or `undefined` when any hunk no longer matches.
 */
function applyReverseHunks(current, diff) {
  // Empty content is zero lines; this keeps the phantom "" that split()
  // leaves on "" from shifting every hunk by one line.
  const lines = current === "" ? [] : current.split("\n");
  const hunks = [...(diff.hunks ?? [])].sort((a, b) => b.newStart - a.newStart);
  for (const hunk of hunks) {
    const newSide = hunk.lines
      .filter((line) => line.startsWith("+") || line.startsWith(" "))
      .map((line) => line.slice(1));
    const oldSide = hunk.lines
      .filter((line) => line.startsWith("-") || line.startsWith(" "))
      .map((line) => line.slice(1));
    const start = hunk.newStart - 1;
    for (let j = 0; j < newSide.length; j++) {
      if (lines[start + j] !== newSide[j]) return undefined;
    }
    lines.splice(start, newSide.length, ...oldSide);
  }
  return lines.join("\n");
}
