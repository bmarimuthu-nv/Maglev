export function useLatestVersion(fallback: string = "latest") {
    return __MAGLEV_VERSION__ || fallback;
}
