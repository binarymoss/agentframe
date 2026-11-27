#!/usr/bin/env bash
set -euo pipefail

skills_dir="$HOME/.agents/skills"
skill_only=false
for arg in "$@"; do
  case "$arg" in
    --claude) skills_dir="$HOME/.claude/skills" ;;
    --skill-only) skill_only=true ;;
    *)
      printf 'Usage: bash install.sh [--skill-only] [--claude]\n' >&2
      exit 2
      ;;
  esac
done

installer_path="${BASH_SOURCE[0]:-}"

install_skill() (
  target_dir="$skills_dir/agentframe"
  source_file=
  if [[ -n "$installer_path" ]]; then
    source_file="$(dirname -- "$installer_path")/skills/agentframe/SKILL.md"
  fi
  mkdir -p -- "$target_dir"
  temp_file=$(mktemp "$target_dir/.SKILL.md.XXXXXXXX")
  trap 'rm -f -- "$temp_file"' EXIT

  if [[ -f "$source_file" ]]; then
    cp -- "$source_file" "$temp_file"
  else
    curl -fsSL -o "$temp_file" \
      https://raw.githubusercontent.com/binarymoss/agentframe/main/skills/agentframe/SKILL.md
  fi

  mv -fT -- "$temp_file" "$target_dir/SKILL.md"
  printf 'Installed %s\n' "$target_dir/SKILL.md"
)

if [[ "$skill_only" == true ]]; then
  install_skill
  exit 0
fi

if command -v nix >/dev/null; then
  printf 'Nix detected. Add github:binarymoss/agentframe as an input in your flake.nix manually.\n'
  exit 0
fi

node_ready() {
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 26 ? 0 : 1)' 2>/dev/null
}

ffmpeg_ready() {
  command -v ffprobe >/dev/null &&
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -E '[[:space:]]libx264[[:space:]]' >/dev/null
}

find_browser() {
  if [[ -x "${AGENTFRAME_BROWSER_PATH:-}" ]]; then
    printf '%s\n' "$AGENTFRAME_BROWSER_PATH"
  else
    command -v chromium || command -v chromium-browser ||
      command -v google-chrome || command -v google-chrome-stable
  fi
}

install_system_dependencies() {
  local node_package=nodejs npm_package=npm browser_package=chromium pnpm_package=
  local -a manager elevate=() packages=()

  if command -v apt-get >/dev/null; then
    manager=(apt-get install)
    if grep -Eq '^ID="?ubuntu"?$' /etc/os-release; then
      browser_package=chromium-browser
    fi
    if apt-cache show pnpm >/dev/null 2>&1; then
      pnpm_package=pnpm
    elif apt-cache show node-pnpm >/dev/null 2>&1; then
      pnpm_package=node-pnpm
    fi
  elif command -v dnf >/dev/null; then
    manager=(dnf install)
    if dnf -q list --available nodejs26-bin >/dev/null 2>&1; then
      node_package=nodejs26-bin
      npm_package=nodejs26-npm
    fi
    if dnf -q list --available pnpm >/dev/null 2>&1; then
      pnpm_package=pnpm
    fi
  elif command -v pacman >/dev/null; then
    manager=(pacman -S --needed)
    pnpm_package=pnpm
  else
    return 0
  fi

  node_ready || packages+=("$node_package")
  ffmpeg_ready || packages+=(ffmpeg)
  find_browser >/dev/null || packages+=("$browser_package")
  if ! command -v pnpm >/dev/null; then
    if [[ -n "$pnpm_package" ]]; then
      packages+=("$pnpm_package")
    elif ! command -v npm >/dev/null; then
      packages+=("$npm_package")
    fi
  fi

  if ((${#packages[@]})); then
    if ((EUID != 0)); then
      elevate=(sudo)
    fi
    local input=/dev/stdin
    if [[ -z "$installer_path" ]]; then
      input=/dev/null
      if [[ -t 1 ]]; then
        input=/dev/tty
      fi
    fi
    "${elevate[@]}" "${manager[@]}" "${packages[@]}" < "$input"
    hash -r
  fi
}

if ! node_ready || ! ffmpeg_ready || ! find_browser >/dev/null || ! command -v pnpm >/dev/null; then
  install_system_dependencies
fi
if ! node_ready; then
  printf 'Node.js 26 or newer is required. If your distro does not provide it, install it separately and rerun this script.\n' >&2
  exit 1
fi
if ! ffmpeg_ready || ! find_browser >/dev/null; then
  printf 'Install FFmpeg with libx264 and ffprobe, and Chromium with H.264 decoding, then rerun this script.\n' >&2
  exit 1
fi

pnpm_home="${PNPM_HOME:-$HOME/.local/share/pnpm}"
pnpm_path="$pnpm_home/bin:$pnpm_home:$PATH"
if command -v pnpm >/dev/null &&
   mkdir -p -- "$pnpm_home/bin" &&
   PNPM_HOME="$pnpm_home" PATH="$pnpm_path" pnpm add -g agentframe; then
  export PATH="$pnpm_path"
else
  if ! command -v npm >/dev/null; then
    printf 'pnpm could not install AgentFrame and npm is unavailable. Install npm or fix pnpm, then rerun this script.\n' >&2
    exit 1
  fi
  printf 'Installing AgentFrame with npm.\n'
  npm install --global --prefix "$HOME/.local" agentframe
  export PATH="$HOME/.local/bin:$PATH"
fi
if ! cli_path=$(command -v agentframe); then
  printf 'AgentFrame was installed but its executable was not found on PATH.\n' >&2
  exit 1
fi

install_skill
printf 'Add %s to PATH if it is not already there.\n' "$(dirname -- "$cli_path")"
