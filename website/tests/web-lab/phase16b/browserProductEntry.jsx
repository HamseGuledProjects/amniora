// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* Real Saved Lab product entry for the disposable Phase 16B host. */
import { createRoot } from "react-dom/client";
import LabPage from "../../../app/dashboard/saved/[id]/page";

createRoot(document.getElementById("root")).render(<LabPage />);
window.__phase16bProductUi = { ready: true };
