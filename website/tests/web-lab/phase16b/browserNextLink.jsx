// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
import { forwardRef } from "react";

const Link = forwardRef(function Link({ href, children, ...props }, ref) {
  return <a ref={ref} href={typeof href === "string" ? href : String(href)} {...props}>{children}</a>;
});

export default Link;
