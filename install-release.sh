#!/usr/bin/env sh
set -eu

log() {
    printf '%s\n' "$*"
}

warn() {
    printf 'warning: %s\n' "$*" >&2
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

resolve_artifact() {
    os="$1"
    arch="$2"
    libc="${3:-glibc}"

    case "$os:$arch:$libc" in
        darwin:arm64:*) printf 'maglev-darwin-arm64.tar.gz' ;;
        darwin:x64:*) printf 'maglev-darwin-x64.tar.gz' ;;
        linux:arm64:glibc) printf 'maglev-linux-arm64.tar.gz' ;;
        linux:arm64:musl) printf 'maglev-linux-arm64-musl.tar.gz' ;;
        linux:x64:glibc) printf 'maglev-linux-x64.tar.gz' ;;
        linux:x64:musl) printf 'maglev-linux-x64-musl.tar.gz' ;;
        win32:x64:*) printf 'maglev-win32-x64.zip' ;;
        *) fail "unsupported platform combination: $os/$arch/$libc" ;;
    esac
}

binary_name() {
    case "$1" in
        win32) printf 'maglev.exe' ;;
        *) printf 'maglev' ;;
    esac
}

download() {
    url="$1"
    output="$2"

    if have curl; then
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$url" -o "$output"
        else
            curl -fsSL "$url" -o "$output"
        fi
        return
    fi

    if have wget; then
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            wget -q --header="Authorization: Bearer $GITHUB_TOKEN" -O "$output" "$url"
        else
            wget -q -O "$output" "$url"
        fi
        return
    fi

    fail "curl or wget is required"
}

checksum_for() {
    checksums_file="$1"
    artifact="$2"

    awk -v artifact="$artifact" '$2 == artifact || $2 == "*" artifact { print $1; exit }' "$checksums_file"
}

file_sha256() {
    file="$1"

    if have sha256sum; then
        sha256sum "$file" | awk '{ print $1 }'
        return
    fi

    if have shasum; then
        shasum -a 256 "$file" | awk '{ print $1 }'
        return
    fi

    return 1
}

verify_checksum() {
    checksums_file="$1"
    artifact="$2"
    archive_path="$3"

    expected="$(checksum_for "$checksums_file" "$artifact")"
    if [ -z "$expected" ]; then
        warn "checksums.txt does not list $artifact; skipping checksum verification"
        return
    fi

    if ! actual="$(file_sha256 "$archive_path")"; then
        warn "sha256sum or shasum is not available; skipping checksum verification"
        return
    fi

    [ "$expected" = "$actual" ] || fail "checksum mismatch for $artifact"
    log "Verified checksum for $artifact"
}

extract_archive() {
    archive_path="$1"
    artifact="$2"
    extract_dir="$3"

    case "$artifact" in
        *.tar.gz)
            have tar || fail "tar is required to extract $artifact"
            tar -xzf "$archive_path" -C "$extract_dir"
            ;;
        *.zip)
            if have unzip; then
                unzip -q "$archive_path" -d "$extract_dir"
            elif have bsdtar; then
                bsdtar -xf "$archive_path" -C "$extract_dir"
            elif have powershell.exe; then
                powershell.exe -NoProfile -Command "Expand-Archive -Force '$archive_path' '$extract_dir'"
            else
                fail "unzip, bsdtar, or powershell.exe is required to extract $artifact"
            fi
            ;;
        *)
            fail "unsupported artifact format: $artifact"
            ;;
    esac
}

install_binary() {
    source_path="$1"
    target_path="$2"
    bindir="$(dirname "$target_path")"

    if [ ! -d "$bindir" ]; then
        if mkdir -p "$bindir" 2>/dev/null; then
            :
        elif have sudo; then
            sudo mkdir -p "$bindir"
        else
            fail "cannot create install directory $bindir"
        fi
    fi

    if [ -w "$bindir" ]; then
        if have install; then
            install -m 755 "$source_path" "$target_path"
        else
            cp "$source_path" "$target_path"
            chmod 755 "$target_path" 2>/dev/null || true
        fi
    elif have sudo; then
        if have install; then
            sudo install -m 755 "$source_path" "$target_path"
        else
            sudo cp "$source_path" "$target_path"
            sudo chmod 755 "$target_path"
        fi
    else
        fail "install directory $bindir is not writable and sudo is unavailable"
    fi
}

main() {
    repo="${MAGLEV_REPO:-bmarimuthu-nv/Maglev}"
    version="${MAGLEV_VERSION:-latest}"
    os="${MAGLEV_OS:-$(detect_os)}"
    arch="${MAGLEV_ARCH:-$(detect_arch)}"
    libc='glibc'

    if [ "$os" = "linux" ]; then
        libc="${MAGLEV_LIBC:-$(detect_linux_libc)}"
    fi

    artifact="${MAGLEV_ARTIFACT:-$(resolve_artifact "$os" "$arch" "$libc")}"
    bin_name="$(binary_name "$os")"
    bindir="${MAGLEV_INSTALL_DIR:-$HOME/.local/bin}"
    target_path="$bindir/$bin_name"

    if [ "$version" = "latest" ]; then
        release_url="https://github.com/$repo/releases/latest/download"
    else
        release_url="https://github.com/$repo/releases/download/$version"
    fi

    tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t maglev-install)"
    cleanup() {
        rm -rf "$tmp_dir"
    }
    trap cleanup EXIT INT TERM

    archive_path="$tmp_dir/$artifact"
    checksums_path="$tmp_dir/checksums.txt"

    log "Downloading $artifact from $repo ($version)"
    download "$release_url/$artifact" "$archive_path"

    if download "$release_url/checksums.txt" "$checksums_path"; then
        verify_checksum "$checksums_path" "$artifact" "$archive_path"
    else
        warn "could not download checksums.txt; skipping checksum verification"
    fi

    extract_archive "$archive_path" "$artifact" "$tmp_dir"

    source_path="$tmp_dir/$bin_name"
    [ -f "$source_path" ] || fail "release artifact did not contain $bin_name"

    install_binary "$source_path" "$target_path"
    log "Installed $bin_name to $target_path"

    case ":$PATH:" in
        *":$bindir:"*) ;;
        *) warn "$bindir is not on PATH; add it before running maglev" ;;
    esac
}

main "$@"
