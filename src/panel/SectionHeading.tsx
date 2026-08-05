/**
 * The panel's own heading primitive. `PanelSection` cannot nest inside itself, so the
 * sub-headings are ours; there is one of them rather than one per caller.
 */
export type HeadingLevel = "section" | "group";

const STYLE: Record<HeadingLevel, Record<string, string>> = {
  section: { fontSize: "0.8em", opacity: "0.7", paddingTop: "0.6em" },
  group: { fontSize: "0.75em", opacity: "0.6", paddingTop: "0.4em" },
};

export function SectionHeading({ level, children }: { level: HeadingLevel; children: string }) {
  return (
    <div style={{ textTransform: "uppercase", letterSpacing: "0.08em", ...STYLE[level] }}>
      {children}
    </div>
  );
}
