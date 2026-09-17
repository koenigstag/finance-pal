/** Types for the icon-set generator, which is plain ESM so Vite can import it from its config. */
export declare function buildIconSets(outDir: string): Promise<{ tabler: number; simple: number }>;
export declare function iconSetsPlugin(outDir: string): { name: string; buildStart(): Promise<void> };
