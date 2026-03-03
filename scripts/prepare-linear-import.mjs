#!/usr/bin/env node
/* @Codex */

import fs from "node:fs";
import path from "node:path";

const PRIORITY_MAP = {
  P1: "High",
  P2: "Medium",
  P3: "Low",
};

const OUTPUT_HEADERS = [
  "Title",
  "Description",
  "Priority",
  "Status",
  "Assignee",
  "Labels",
  "Estimate",
  "Created",
  "Started",
  "Completed",
  "Archived",
];

const cwd = process.cwd();
const inputPath = process.argv[2] || path.join(cwd, "docs", "linear-seed-issues.csv");
const outDir = process.argv[3] || path.join(cwd, "docs");

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

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function toObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0];

  return rows.slice(1).map((cells) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = cells[index] ?? "";
    });
    return object;
  });
}

function parseLabels(raw) {
  return String(raw || "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function normalizeProjectLabel(project) {
  return String(project || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toLinearRow(seedRow) {
  const project = String(seedRow.Project || "").trim();
  const projectLabel = normalizeProjectLabel(project);
  const labels = parseLabels(seedRow.Labels);

  if (projectLabel) {
    labels.push(`project/${projectLabel}`);
  }

  labels.push("source/linear-seed");
  const uniqueLabels = Array.from(new Set(labels));

  return {
    Title: String(seedRow.Title || "").trim(),
    Description: String(seedRow.Description || "").trim(),
    Priority: PRIORITY_MAP[String(seedRow.Priority || "").trim()] || "No priority",
    Status: "Backlog",
    Assignee: "",
    Labels: uniqueLabels.join(", "),
    Estimate: "",
    Created: "",
    Started: "",
    Completed: "",
    Archived: "",
    __project: project,
    __projectLabel: projectLabel,
  };
}

function writeCsv(filePath, rows) {
  const dataRows = rows.map((row) =>
    OUTPUT_HEADERS.map((header) => csvEscape(row[header] || "")).join(",")
  );

  const csv = `${OUTPUT_HEADERS.join(",")}\n${dataRows.join("\n")}\n`;
  fs.writeFileSync(filePath, csv, "utf8");
}

function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const parsed = toObjects(parseCsv(fs.readFileSync(inputPath, "utf8")));
  const rows = parsed.map(toLinearRow);

  const allPath = path.join(outDir, "linear-import-open.linear.csv");
  writeCsv(allPath, rows);

  const byProject = new Map();
  for (const row of rows) {
    const projectKey = row.__projectLabel || "unassigned";
    if (!byProject.has(projectKey)) {
      byProject.set(projectKey, []);
    }
    byProject.get(projectKey).push(row);
  }

  const written = [allPath];
  for (const [projectKey, projectRows] of byProject.entries()) {
    const filePath = path.join(outDir, `linear-import-open.${projectKey}.linear.csv`);
    writeCsv(filePath, projectRows);
    written.push(filePath);
  }

  for (const filePath of written) {
    const relative = path.relative(cwd, filePath) || filePath;
    console.log(relative);
  }
}

main();

