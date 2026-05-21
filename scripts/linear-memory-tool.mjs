#!/usr/bin/env node
/* @Codex */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_ARCHIVE = path.join(
  process.cwd(),
  "docs",
  "linear-completed-issues-archive-2026-05-21.md"
);
const LINEAR_API_URL = process.env.LINEAR_API_URL || "https://api.linear.app/graphql";
const LINEAR_API_KEY = process.env.LINEAR_API_KEY || "";

function usage() {
  console.log(`Linear memory tool

Usage:
  node scripts/linear-memory-tool.mjs memory-check "<query>" [--archive <file>] [--limit <n>]
  node scripts/linear-memory-tool.mjs archive-plan [--archive <file>] [--all] [--format md|json]
  node scripts/linear-memory-tool.mjs snapshot-linear [--team Wulfgardr] [--project Mediflow] [--state Done] [--out <file>] [--limit <n>]
  node scripts/linear-memory-tool.mjs archive-linear [--archive <file>] [--ids WUL-1,WUL-2] [--all] [--execute]
  node scripts/linear-memory-tool.mjs delete-linear [--archive <file>] [--ids WUL-1,WUL-2] [--all] --execute --confirm-delete

Commands:
  memory-check   Search completed-issue memory before creating or working on a new Linear issue.
  archive-plan   Print the archived Done issue batch, defaulting to priority archive candidates.
  snapshot-linear Fetch Done issues from Linear and write a repo-local Markdown archive.
  archive-linear Archive issues in Linear via GraphQL. Dry-run unless --execute is passed.
  delete-linear  Move issues to Linear trash via GraphQL. Requires --execute --confirm-delete.

Environment for Linear side effects:
  LINEAR_API_KEY required for --execute
  LINEAR_API_URL optional, defaults to https://api.linear.app/graphql
`);
}

function readArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value) {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function parseTableLine(line) {
  if (!line.trim().startsWith("|")) return null;
  if (/^\|\s*-+/.test(line.trim())) return null;

  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  const firstCell = cells[0] || "";
  const match = firstCell.match(/\[(WUL-\d+)\]\(([^)]+)\)/);
  if (!match) return null;

  return {
    id: match[1],
    url: match[2],
    title: cells[1] || "",
    completed: cells[2] || "",
    context: cells[3] || "",
    notes: cells[4] || "",
  };
}

function loadArchive(archivePath) {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  const content = fs.readFileSync(archivePath, "utf8");
  const lines = content.split(/\r?\n/);
  const allIssues = [];
  const priorityIds = new Set();
  let inPrioritySection = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      inPrioritySection = line.includes("Candidati Prioritari Da Archiviare In Linear");
    }

    const issue = parseTableLine(line);
    if (!issue) continue;

    allIssues.push(issue);
    if (inPrioritySection) {
      priorityIds.add(issue.id);
    }
  }

  const byId = new Map();
  for (const issue of allIssues) {
    if (!byId.has(issue.id)) {
      byId.set(issue.id, issue);
    }
  }

  return {
    content,
    allIssues: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
    priorityIssues: [...byId.values()]
      .filter((issue) => priorityIds.has(issue.id))
      .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
  };
}

function selectIssues(archive, options) {
  if (options.ids.length > 0) {
    const wanted = new Set(options.ids);
    const selected = archive.allIssues.filter((issue) => wanted.has(issue.id));
    const found = new Set(selected.map((issue) => issue.id));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(`Issue IDs not found in archive: ${missing.join(", ")}`);
    }
    return selected;
  }

  return options.all ? archive.allIssues : archive.priorityIssues;
}

function parseIds(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .map((value) => {
      if (!/^WUL-\d+$/.test(value)) {
        throw new Error(`Invalid issue identifier: ${value}`);
      }
      return value;
    });
}

function escapeCell(value) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function priorityName(value) {
  switch (Number(value)) {
    case 1:
      return "Urgent";
    case 2:
      return "High";
    case 3:
      return "Medium";
    case 4:
      return "Low";
    default:
      return "No priority";
  }
}

function runMemoryCheck(archive) {
  const query = process.argv[3] || "";
  const limit = Number(readArg("--limit", "8"));
  if (!query.trim()) {
    throw new Error('Missing query. Example: npm run linear:memory-check -- "smart import ricette farmaci"');
  }

  const queryTokens = tokenize(query);
  const scored = archive.allIssues
    .map((issue) => {
      const haystack = `${issue.id} ${issue.title} ${issue.context} ${issue.notes}`;
      const issueTokens = tokenize(haystack);
      let score = 0;
      for (const token of queryTokens) {
        if (issueTokens.has(token)) score += 2;
        if (normalize(issue.title).includes(token)) score += 1;
      }
      return { issue, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.issue.id.localeCompare(b.issue.id, "en", { numeric: true }))
    .slice(0, Number.isFinite(limit) ? limit : 8);

  if (scored.length === 0) {
    console.log(`Archive check: no likely duplicate found for "${query}".`);
    return;
  }

  console.log(`Archive check: ${scored.length} related completed issue(s) found for "${query}".`);
  for (const { issue, score } of scored) {
    console.log(`- ${issue.id} | score=${score} | ${issue.title}`);
    console.log(`  ${issue.url}`);
    if (issue.completed) console.log(`  completed: ${issue.completed}`);
    if (issue.context) console.log(`  context: ${issue.context}`);
    if (issue.notes) console.log(`  notes: ${issue.notes}`);
  }
}

function runArchivePlan(archive, options) {
  const issues = selectIssues(archive, options);
  const format = readArg("--format", "md");

  if (format === "json") {
    console.log(JSON.stringify({ count: issues.length, issues }, null, 2));
    return;
  }

  console.log(`# Linear archive plan\n`);
  console.log(`- Source archive: ${options.archivePath}`);
  console.log(`- Scope: ${options.all ? "all archived issues" : "priority archive candidates"}`);
  console.log(`- Count: ${issues.length}\n`);
  for (const issue of issues) {
    console.log(`- ${issue.id}: ${issue.title}`);
  }
}

async function gql(query, variables = {}) {
  if (!LINEAR_API_KEY) {
    throw new Error("Missing LINEAR_API_KEY for Linear side effects.");
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    const details = payload.errors ? JSON.stringify(payload.errors) : response.statusText;
    throw new Error(`Linear API error: ${details}`);
  }
  return payload.data;
}

async function archiveIssue(identifier, trash) {
  const result = await gql(
    `
      mutation ArchiveIssue($id: String!, $trash: Boolean) {
        issueArchive(id: $id, trash: $trash) {
          success
          entity {
            id
            identifier
            archivedAt
            trashed
            url
          }
        }
      }
    `,
    { id: identifier, trash }
  );

  const archived = result.issueArchive;
  if (!archived?.success) {
    throw new Error(`Linear did not confirm archive for ${identifier}.`);
  }
  return archived.entity;
}

async function fetchLinearDoneIssues(options) {
  const pageSize = Math.min(Number(readArg("--limit", "100")) || 100, 250);
  const teamName = readArg("--team", "Wulfgardr");
  const projectName = readArg("--project", "Mediflow");
  const stateName = readArg("--state", "Done");
  const issues = [];
  let cursor = null;

  do {
    const result = await gql(
      `
        query DoneIssues($after: String, $first: Int!, $team: String!, $project: String!, $state: String!) {
          issues(
            first: $first
            after: $after
            filter: {
              team: { name: { eq: $team } }
              project: { name: { eq: $project } }
              state: { name: { eq: $state } }
              archivedAt: { null: true }
            }
            orderBy: updatedAt
          ) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              identifier
              title
              url
              completedAt
              updatedAt
              createdAt
              priority
              branchName
              parent { identifier title }
              project { name }
              state { name type }
              labels { nodes { name } }
            }
          }
        }
      `,
      { after: cursor, first: pageSize, team: teamName, project: projectName, state: stateName }
    );

    const connection = result.issues;
    issues.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);

  return issues.sort((a, b) => a.identifier.localeCompare(b.identifier, "en", { numeric: true }));
}

function renderSnapshotMarkdown(issues, options) {
  const teamName = readArg("--team", "Wulfgardr");
  const projectName = readArg("--project", "Mediflow");
  const stateName = readArg("--state", "Done");
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Linear Completed Issues Archive - ${today}`,
    "",
    "Stato documento: `SECONDARY` (snapshot operativo di igiene Linear).",
    "",
    "Questo archivio conserva in Markdown le issue Linear `Done` usate come storico operativo, cosi la superficie attiva di Linear puo restare dedicata a nuove issue utili. La fonte autorevole resta Git/PR/docs per il codice consegnato; questo file conserva memoria di processo dopo la pulizia Linear.",
    "",
    "## Metodo",
    "",
    `- Workspace/team: \`${teamName}\`.`,
    `- Project principale: \`${projectName}\`.`,
    `- Stato interrogato: \`${stateName}\`.`,
    `- Data snapshot: ${today}.`,
    `- Issue non archiviate trovate: ${issues.length}.`,
    "- Complexity check: not applicable; igiene tracker/documentazione, nessun hot path.",
    "",
    "## Issue Done Salvate",
    "",
    "| Issue | Titolo | Completed | Priority | Labels | Parent | Branch |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const issue of issues) {
    const labels = issue.labels.nodes.map((label) => label.name).join(", ");
    const parent = issue.parent ? `${issue.parent.identifier} ${issue.parent.title}` : "-";
    lines.push(
      `| [${issue.identifier}](${issue.url}) | ${escapeCell(issue.title)} | ${escapeCell((issue.completedAt || "").slice(0, 10))} | ${priorityName(issue.priority)} | ${escapeCell(labels || "-")} | ${escapeCell(parent)} | ${escapeCell(issue.branchName || "-")} |`
    );
  }

  lines.push(
    "",
    "## Uso Operativo",
    "",
    "Prima di creare o lavorare una nuova issue, cercare qui con:",
    "",
    "```bash",
    "npm run linear:memory-check -- \"<tema o problema>\"",
    "```",
    "",
    "Prima di eliminare issue da Linear, verificare che questo snapshot sia committato.",
    "",
    "## Note Di Sicurezza",
    "",
    "- Nessun dato paziente o contenuto clinico reale e stato esportato in questo file.",
    "- Sono stati salvati solo metadati di tracker: ID, titolo, stato, date, label, parent, branch e URL Linear.",
    "- Le descrizioni complete non vengono duplicate qui.",
    ""
  );

  return lines.join("\n");
}

async function runSnapshotLinear() {
  const outPath = path.resolve(readArg("--out", DEFAULT_ARCHIVE));
  const issues = await fetchLinearDoneIssues();
  const markdown = renderSnapshotMarkdown(issues);
  fs.writeFileSync(outPath, markdown, "utf8");
  console.log(`Snapshot written: ${outPath}`);
  console.log(`Done issues captured: ${issues.length}`);
}

async function runLinearSideEffect(archive, options) {
  const issues = selectIssues(archive, options);
  const execute = hasFlag("--execute");
  const deleteMode = options.command === "delete-linear";

  if (execute && deleteMode && !hasFlag("--confirm-delete")) {
    throw new Error("delete-linear requires --confirm-delete when --execute is used.");
  }

  console.log(`${deleteMode ? "Delete" : "Archive"} plan: ${issues.length} issue(s).`);
  for (const issue of issues) {
    console.log(`- ${issue.id}: ${issue.title}`);
  }

  if (!execute) {
    console.log("\nDry-run only. Re-run with --execute to apply Linear side effects.");
    if (deleteMode) {
      console.log("Delete mode uses Linear issueArchive(..., trash: true). Keep the repo Markdown archive first.");
    }
    return;
  }

  for (const issue of issues) {
    const entity = await archiveIssue(issue.id, deleteMode);
    console.log(
      `${deleteMode ? "deleted" : "archived"} ${issue.id} -> archivedAt=${entity?.archivedAt || "n/a"} trashed=${entity?.trashed || false}`
    );
  }
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const archivePath = path.resolve(readArg("--archive", DEFAULT_ARCHIVE));
  const archive = loadArchive(archivePath);
  const options = {
    command,
    archivePath,
    all: hasFlag("--all"),
    ids: parseIds(readArg("--ids", "")),
  };

  if (command === "snapshot-linear") {
    await runSnapshotLinear();
  } else if (command === "memory-check") {
    runMemoryCheck(archive);
  } else if (command === "archive-plan") {
    runArchivePlan(archive, options);
  } else if (command === "archive-linear" || command === "delete-linear") {
    await runLinearSideEffect(archive, options);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
