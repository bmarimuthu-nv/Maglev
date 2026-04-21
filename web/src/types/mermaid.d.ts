declare module 'mermaid' {
    type MermaidRenderResult = {
        svg: string
        bindFunctions?: ((element: Element) => void) | undefined
    }

    type MermaidApi = {
        initialize: (config: {
            startOnLoad?: boolean
            securityLevel?: 'strict' | 'loose' | 'antiscript' | 'sandbox'
            theme?: string
            themeVariables?: Record<string, string>
        }) => void
        render: (id: string, code: string) => Promise<MermaidRenderResult>
    }

    const mermaid: MermaidApi
    export default mermaid
}
