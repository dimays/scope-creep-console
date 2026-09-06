import { NavLink } from "react-router";

const LINKS = [
  { to: "/work", label: "Board", end: true },
  { to: "/work/history", label: "History", end: false },
  { to: "/work/inputs", label: "Inputs", end: false },
];

export function WorkNav() {
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
