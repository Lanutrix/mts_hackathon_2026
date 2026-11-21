import MelonScene from "./MelonScene";
import type { MelonTracking } from "./melonModel";

export default function LandingOptic({
  tracking,
}: {
  tracking?: MelonTracking | null;
}) {
  return (
    <div className="landing-optic">
      <MelonScene active="all" hero tracking={tracking} />
    </div>
  );
}
