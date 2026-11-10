import type { WebTemplate } from "../schema";
import { ecommerceV1 } from "./ecommerce-v1";
import { helpdeskV1 } from "./helpdesk-v1";

/** Fixed reviewed templates; scenario JSON cannot supply renderers or bindings. */
export function webApplicationTemplate(id: unknown): WebTemplate | null {
  if (id === helpdeskV1.id) return helpdeskV1;
  if (id === ecommerceV1.id) return ecommerceV1;
  return null;
}
