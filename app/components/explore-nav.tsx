import { NavLink } from "react-router";

const LINKS = [
  { to: "/explore", label: "Overview", end: true },
  { to: "/explore/agents", label: "Org", end: false },
  { to: "/explore/templates", label: "Templates", end: false },
  { to: "/explore/docs", label: "Docs", end: false },
  { to: "/explore/loops", label: "Loops", end: false },
  { to: "/explore/timeline", label: "Timeline", end: false },
  { to: "/explore/consistency", label: "Consistency", end: false },
];

export function ExploreNav() {
  return (
    <nav className="explore-nav">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            isActive ? "explore-nav__link explore-nav__link--active" : "explore-nav__link"
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
