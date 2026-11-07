export type RouteId =
  | "home"
  | "review"
  | "finding"
  | "freeing"
  | "done"
  | "drives"
  | "drive"
  | "big-files"
  | "restore"
  | "explore"
  | "duplicates"
  | "apps"
  | "developer";

export interface Route {
  id: RouteId;
  label: string;
  /** Sidebar group; routes without one (e.g. Review) aren't listed. */
  group?: "everyday" | "power";
  /** Sidebar item to highlight while this route is showing. */
  activeAs?: RouteId;
}

export const allRoutes: Route[] = [
  { id: "home", label: "Home", group: "everyday" },
  { id: "drives", label: "Drives", group: "everyday" },
  { id: "big-files", label: "Big files", group: "everyday" },
  { id: "restore", label: "Restore", group: "everyday" },
  { id: "explore", label: "Explore", group: "power" },
  { id: "duplicates", label: "Duplicates", group: "power" },
  { id: "apps", label: "Apps", group: "power" },
  { id: "developer", label: "Developer", group: "power" },
  { id: "review", label: "Review", activeAs: "home" },
  { id: "finding", label: "Review", activeAs: "home" },
  { id: "freeing", label: "Freeing", activeAs: "home" },
  { id: "done", label: "Done", activeAs: "home" },
  { id: "drive", label: "Drive", activeAs: "drives" },
];

export const defaultRouteId: RouteId = "home";

export const routesIn = (group: Route["group"]) => allRoutes.filter((r) => r.group === group);

export const routeById = (id: RouteId) => allRoutes.find((r) => r.id === id)!;
