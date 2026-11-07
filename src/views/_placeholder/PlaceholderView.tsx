import { routeById, type RouteId } from "@/routes";

/** Fallback for a route that doesn't have its screen built yet. */
export function PlaceholderView({ route }: { route: RouteId }) {
  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-2 px-[52px] py-11">
      <h2 className="text-4xl font-bold tracking-[-0.02em]">{routeById(route).label}</h2>
      <span className="text-base text-mut">Coming soon.</span>
    </div>
  );
}
