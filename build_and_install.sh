#!/usr/bin/env sh
set -eu

log() {
    printf '%s\n' "$*"
}

fail() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

have() {
    command -v "$1" >/dev/null 2>&1
}

detect_os() {
    case "$(uname -s)" in
        Darwin) printf 'darwin' ;;
        Linux) printf 'linux' ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT) printf 'win32' ;;
        *) fail "unsupported operating system: $(uname -s)" ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64) printf 'x64' ;;
        arm64|aarch64) printf 'arm64' ;;
        *) fail "unsupported architecture: $(uname -m)" ;;
    esac
}

detect_linux_libc() {
    if [ "${MAGLEV_LIBC:-}" = "glibc" ] || [ "${MAGLEV_LIBC:-}" = "musl" ]; then
        printf '%s' "$MAGLEV_LIBC"
        return
    fi

    if [ -f /etc/alpine-release ]; then
        printf 'musl'
        return
    fi

    if have getconf && getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
        printf 'glibc'
        return
    fi

    if have ldd; then
        ldd_output="$(ldd --version 2>&1 || true)"
        case "$ldd_output" in
            *musl*) printf 'musl'; return ;;
            *glibc*|*GNU\ libc*|*GLIBC*) printf 'glibc'; return ;;
        esac
    fi

    printf 'glibc'
}

build_target() {
    os="$1"
    arch="$2"
    libc="${3:-glibc}"

    case "$os:$arch:$libc" in
        darwin:arm64:*) printf 'bun-darwin-arm64' ;;
        darwin:x64:*) printf 'bun-darwin-x64' ;;
        linux:arm64:glibc) printf 'bun-linux-arm64' ;;
        linux:arm64:musl) printf 'bun-linux-arm64-musl' ;;
        linux:x64:glibc) printf 'bun-linux-x64-baseline' ;;
        linux:x64:musl) printf 'bun-linux-x64-musl-baseline' ;;
        win32:x64:*) printf 'bun-windows-x64' ;;
        *) fail "unsupported platform combination: $os/$arch/$libc" ;;
    esac
}

binary_name() {
    os="$1"

    case "$os" in
        win32) printf 'maglev.exe' ;;
        *) printf 'maglev' ;;
    esac
}

install_built_binary() {
    os="$(detect_os)"
    arch="$(detect_arch)"
    libc='glibc'
    if [ "$os" = "linux" ]; then
        libc="$(detect_linux_libc)"
    fi
    target="${MAGLEV_BUILD_TARGET:-$(build_target "$os" "$arch" "$libc")}"
    target_name="$(binary_name "$os")"
    script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
    source_path="$script_dir/cli/dist-exe/$target/$target_name"

    [ -f "$source_path" ] || fail "missing built binary at $source_path"

    bindir="${MAGLEV_INSTALL_DIR:-$HOME/.local/bin}"
    target_path="$bindir/$target_name"

    if [ ! -d "$bindir" ]; then
        if [ -w "$(dirname "$bindir")" ]; then
            mkdir -p "$bindir"
        elif have sudo; then
            sudo mkdir -p "$bindir"
        else
            fail "cannot create install directory $bindir"
        fi
    fi

    if [ -w "$bindir" ]; then
        install -m 755 "$source_path" "$target_path"
    elif have sudo; then
        sudo install -m 755 "$source_path" "$target_path"
    else
        fail "install directory $bindir is not writable and sudo is unavailable"
    fi

    log "Installed $target_name to $target_path"
}

main() {
    have bun || fail "bun is required"
    have git || fail "git is required"

    script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
    cache_dir="${BUN_INSTALL_CACHE_DIR:-$script_dir/.tmp/bun-cache}"
    tmp_dir="${TMPDIR:-/tmp}"
    os="$(detect_os)"
    arch="$(detect_arch)"
    libc='glibc'
    if [ "$os" = "linux" ]; then
        libc="$(detect_linux_libc)"
    fi
    build_target_name="${MAGLEV_BUILD_TARGET:-$(build_target "$os" "$arch" "$libc")}"

    mkdir -p "$cache_dir"

    if [ -d "$script_dir/node_modules" ] && [ "${FORCE:-0}" != "1" ]; then
        log "Reusing existing node_modules"
    else
        if [ -d "$cache_dir" ] && [ "$(find "$cache_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
            log "Installing dependencies with existing Bun cache at $cache_dir"
        else
            log "Installing dependencies with new Bun cache at $cache_dir"
        fi
        TMPDIR="$tmp_dir" bun install --omit optional --cache-dir "$cache_dir"
    fi

    log "Building standalone binary"
    TMPDIR="$tmp_dir" bun run download:tunwg
    TMPDIR="$tmp_dir" bun run build:web
    (cd "$script_dir/hub" && TMPDIR="$tmp_dir" bun run generate:embedded-web-assets)
    (cd "$script_dir/cli" && TMPDIR="$tmp_dir" bun run scripts/build-executable.ts --with-web-assets --target "$build_target_name")

    install_built_binary
}

main "$@"
