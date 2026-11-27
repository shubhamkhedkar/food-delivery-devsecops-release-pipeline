#!/usr/bin/env bash
# ShellCheck the EC2 bootstrap templates: render every Terraform interpolation (${...}) with a
# placeholder, turn escaped $${...} back into shell syntax, and lint the result as bash.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for tpl in "$ROOT"/infra/terraform/templates/*.sh.tftpl; do
  sed -E -e 's/\$\{[a-z_]+(\.[a-z_]+)?\}/placeholder/g' -e 's/\$\$\{/${/g' "$tpl" |
    shellcheck --shell=bash --severity=style - || { echo "ShellCheck failed: ${tpl#"$ROOT"/}" >&2; exit 1; }
  echo "ok  - ${tpl#"$ROOT"/}"
done
