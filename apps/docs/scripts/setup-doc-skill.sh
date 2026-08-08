#!/usr/bin/env bash
set -euo pipefail

target_mode="auto"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --silent|-y) shift ;;
    --target)
      target_mode="${2:?--target requires auto, claude, codex, or both}"
      shift 2
      ;;
    --target=*) target_mode="${1#--target=}"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$target_mode" in auto|claude|codex|both) ;; *) echo "Invalid target: $target_mode" >&2; exit 1 ;; esac

package_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(git -C "$package_dir" worktree list | awk 'NR == 1 { print $1 }')"
project_prefix="$(git -C "$package_dir" rev-parse --show-prefix)"
main_docs_dir="$repo_root/${project_prefix}src/content/docs"
skill_name="vector-image-detection-docs-wisdom"

if [ ! -d "$main_docs_dir" ]; then
  echo "Documentation directory not found: $main_docs_dir" >&2
  exit 1
fi

setup_target() {
  local agent_dir="$1"
  local skill_dir="$package_dir/.$agent_dir/skills/$skill_name"
  local global_dir="$HOME/.$agent_dir/skills"
  local global_link="$global_dir/$skill_name"
  mkdir -p "$skill_dir" "$global_dir"
  cat > "$skill_dir/SKILL.md" <<EOF
---
name: $skill_name
description: Search the Vector Image Detection documentation.
---

# Vector Image Detection documentation

Use the documentation files at $main_docs_dir as the project knowledge base.
EOF
  if [ -e "$global_link" ] || [ -L "$global_link" ]; then
    if [ ! -L "$global_link" ] || [ "$(readlink "$global_link")" != "$skill_dir" ]; then
      echo "Skipping $agent_dir skill: $global_link is owned by another file or project" >&2
      return
    fi
    rm -f "$global_link"
  fi
  ln -s "$skill_dir" "$global_link"
  echo "Linked $agent_dir skill: $global_link"
}

case "$target_mode" in
  auto)
    [ -d "$HOME/.claude" ] && setup_target claude
    [ -d "$HOME/.codex" ] && setup_target codex
    ;;
  claude) setup_target claude ;;
  codex) setup_target codex ;;
  both) setup_target claude; setup_target codex ;;
esac
