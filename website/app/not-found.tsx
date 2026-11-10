import PublicErrorPage from "./components/errors/PublicErrorPage";

export default function NotFound() {
  return (
    <PublicErrorPage
      label="404"
      title="Page not found"
      description="The page you're looking for may have moved, been removed or never existed."
      primaryHref="/"
      primaryLabel="Return home"
      secondaryHref="/login"
      secondaryLabel="Log in"
    />
  );
}
