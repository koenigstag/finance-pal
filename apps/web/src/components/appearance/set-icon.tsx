import { useSetIcon, type IconSet } from './icon-sets';

/**
 * An icon from one of the fetched sets, drawn like a lucide one: 24px, currentColor, and the same
 * stroke for Tabler's outlines. Nothing is drawn until its shard arrives.
 */
export function FetchedIcon({ set, name, className }: { set: IconSet; name: string; className?: string }) {
  const icon = useSetIcon(set, name);
  if (!icon) {
    return null;
  }

  if (icon.path) {
    // A brand mark: one filled path, drawn in the current color rather than the brand's own, so it
    // follows the account's color like every other icon.
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d={icon.path} />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      // From the generated sets, which are built from the packages — not from anything a user typed.
      dangerouslySetInnerHTML={{ __html: icon.markup ?? '' }}
    />
  );
}
