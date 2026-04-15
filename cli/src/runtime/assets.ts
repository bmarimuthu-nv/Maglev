export async function ensureRuntimeAssets(): Promise<void> {
    // Legacy runtime asset extraction existed only for the retired managed
    // tunnel transport. Keep the hook as a no-op so command wiring stays
    // stable while the broker-based model remains the only live path.
}
