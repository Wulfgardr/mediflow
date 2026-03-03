#!/usr/bin/env node
/* @Codex */

import fs from "node:fs";
import path from "node:path";

const LINEAR_API_URL = process.env.LINEAR_API_URL || "https://api.linear.app/graphql";
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const TEAM_NAME = process.env.LINEAR_TEAM_NAME || "Wulfgardr";
const PROJECT_NAME = process.env.LINEAR_PROJECT_NAME || "Mediflow";
const PROJECT_SLUG_ID = process.env.LINEAR_PROJECT_SLUG_ID || "";
const INPUT_PATH = process.env.LINEAR_IMPORT_CSV || path.join(process.cwd(), "docs", "linear-import-open.linear.csv");

if (!LINEAR_API_KEY) {
  console.error("Missing LINEAR_API_KEY.");
  process.exit(1);
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inQuotes) {
      if (char === "\"") {
        if (content[i + 1] === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = cells[index] ?? "";
    });
    return obj;
  });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function mapPriority(priority) {
  switch (normalize(priority)) {
    case "urgent":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
    default:
      return 0;
  }
}

function parseLabels(raw) {
  return String(raw || "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

async function gql(query, variables = {}) {
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

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`CSV not found: ${INPUT_PATH}`);
  }

  const rows = toObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8"))).filter((row) => normalize(row.Title));
  if (rows.length === 0) {
    console.log("No rows to import.");
    return;
  }

  const meta = await gql(`
    query {
      teams { nodes { id name key } }
      projects { nodes { id name slugId state } }
    }
  `);

  const team =
    meta.teams.nodes.find((t) => normalize(t.name) === normalize(TEAM_NAME) || normalize(t.key) === normalize(TEAM_NAME));
  if (!team) {
    throw new Error(`Team not found: ${TEAM_NAME}`);
  }

  const project = PROJECT_SLUG_ID
    ? meta.projects.nodes.find((p) => normalize(p.slugId) === normalize(PROJECT_SLUG_ID))
    : meta.projects.nodes.find((p) => normalize(p.name) === normalize(PROJECT_NAME));
  if (!project) {
    throw new Error(`Project not found: ${PROJECT_SLUG_ID || PROJECT_NAME}`);
  }

  const teamData = await gql(
    `
      query TeamData($teamId: String!, $projectId: String!) {
        team(id: $teamId) {
          id
          name
          labels { nodes { id name } }
          states { nodes { id name type } }
        }
        project(id: $projectId) {
          id
          name
          issues(first: 250) { nodes { id title identifier } }
        }
      }
    `,
    { teamId: team.id, projectId: project.id }
  );

  const backlogState =
    teamData.team.states.nodes.find((s) => normalize(s.type) === "backlog") ||
    teamData.team.states.nodes.find((s) => normalize(s.name) === "backlog");
  if (!backlogState) {
    throw new Error(`Backlog state not found for team ${team.name}`);
  }

  const existingTitleSet = new Set(teamData.project.issues.nodes.map((issue) => normalize(issue.title)));
  const labelIdByName = new Map(
    teamData.team.labels.nodes.map((label) => [normalize(label.name), label.id])
  );

  const neededLabels = new Set();
  for (const row of rows) {
    for (const label of parseLabels(row.Labels)) {
      neededLabels.add(label);
    }
  }

  for (const labelName of neededLabels) {
    const key = normalize(labelName);
    if (labelIdByName.has(key)) continue;

    const created = await gql(
      `
        mutation CreateLabel($input: IssueLabelCreateInput!) {
          issueLabelCreate(input: $input) {
            success
            issueLabel { id name }
          }
        }
      `,
      { input: { name: labelName, teamId: team.id } }
    );

    if (!created.issueLabelCreate?.success || !created.issueLabelCreate?.issueLabel?.id) {
      throw new Error(`Failed to create label: ${labelName}`);
    }

    labelIdByName.set(key, created.issueLabelCreate.issueLabel.id);
  }

  let createdCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const title = String(row.Title || "").trim();
    if (!title) continue;

    if (existingTitleSet.has(normalize(title))) {
      skippedCount += 1;
      continue;
    }

    const labelIds = parseLabels(row.Labels)
      .map((label) => labelIdByName.get(normalize(label)))
      .filter(Boolean);

    const input = {
      teamId: team.id,
      projectId: project.id,
      stateId: backlogState.id,
      title,
      description: String(row.Description || "").trim(),
      priority: mapPriority(row.Priority),
      labelIds,
    };

    const created = await gql(
      `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier title url }
          }
        }
      `,
      { input }
    );

    if (!created.issueCreate?.success || !created.issueCreate?.issue?.id) {
      throw new Error(`Failed to create issue: ${title}`);
    }

    existingTitleSet.add(normalize(title));
    createdCount += 1;
    console.log(`${created.issueCreate.issue.identifier} | ${title}`);
  }

  console.log(
    `Import completed: created=${createdCount}, skipped_existing=${skippedCount}, team=${team.name}, project=${project.name}`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

