#!/usr/bin/env bash
# @Codex
set -euo pipefail

if [[ -z "${LINEAR_API_KEY:-}" ]]; then
  echo "Missing LINEAR_API_KEY."
  echo "Run: export LINEAR_API_KEY='<your_linear_api_key>'"
  exit 1
fi

if ! command -v expect >/dev/null 2>&1; then
  echo "Missing 'expect' binary. Install expect and retry."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEAM_NAME="${LINEAR_TEAM_NAME:-MediFlow}"
PROJECT_NAME="${LINEAR_PROJECT_NAME:-MediFlow}"

FILES=(
  "$ROOT_DIR/docs/linear-import-open.mf-core-q2.linear.csv"
  "$ROOT_DIR/docs/linear-import-open.mf-parity-q2.linear.csv"
  "$ROOT_DIR/docs/linear-import-open.mf-fse-q2.linear.csv"
)

for file in "${FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing CSV file: $file"
    echo "Run: npm run linear:prepare-import"
    exit 1
  fi
done

run_import() {
  local csv_file="$1"
  echo "Importing: $csv_file"

  LINEAR_API_KEY="$LINEAR_API_KEY" \
  TEAM_NAME="$TEAM_NAME" \
  PROJECT_NAME="$PROJECT_NAME" \
  CSV_FILE="$csv_file" \
  expect <<'EOF'
    log_user 1
    set timeout 300

    set api_key $env(LINEAR_API_KEY)
    set team_name $env(TEAM_NAME)
    set project_name $env(PROJECT_NAME)
    set csv_file $env(CSV_FILE)

    spawn npx -y @linear/import

    expect "Input your Linear API key"
    send -- "$api_key\r"

    expect "Which service would you like to import from?"
    # Move from "GitHub" to "Linear (CSV export)" -> 7 times down
    for {set i 0} {$i < 7} {incr i} {
      send -- "\033\[B"
    }
    send -- "\r"

    expect "Select your exported CSV file of Linear issues"
    send -- "$csv_file\r"

    expect {
      "Do you want to create a new team for imported issues?" {
        send -- "n\r"
      }
      timeout {
        send_user "\nTimeout waiting for team-creation prompt.\n"
        exit 1
      }
    }

    expect "Import into team:"
    # Filter to team by typing and confirm
    send -- "$team_name\r"

    expect {
      "Do you want to import to a specific project?" {
        send -- "y\r"
      }
      timeout {
        send_user "\nTimeout waiting for project inclusion prompt.\n"
        exit 1
      }
    }

    expect "Import into project:"
    # Filter to project by typing and confirm
    send -- "$project_name\r"

    expect "Do you want to assign these issues to yourself?"
    send -- "\r"

    expect {
      "issues imported to your team" {}
      eof {}
      timeout {
        send_user "\nImport flow did not complete in time.\n"
        exit 1
      }
    }
EOF
}

for file in "${FILES[@]}"; do
  run_import "$file"
done

echo "Done. Imported all CSV files for team '$TEAM_NAME' and project '$PROJECT_NAME'."

