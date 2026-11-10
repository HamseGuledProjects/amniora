import type { WebLabSpec, WebVulnerabilityModule } from "./schema";
import { boundWebLabContract } from "./contract";
import { seededRandom, stableLabId } from "./seed";
import { ecommerceV1 } from "./templates/ecommerce-v1";
import { reflectedXssV1 } from "./vulnerabilities/reflected-xss-v1";
import { storedXssV1 } from "./vulnerabilities/stored-xss-v1";

const storefronts = [
  { company: "Fern & Field", name: "Fern & Field", tagline: "Useful pieces for the everyday." },
  { company: "North Pier Goods", name: "North Pier Goods", tagline: "Considered essentials for home and work." },
  { company: "Cedar Lane Supply", name: "Cedar Lane Supply", tagline: "Small comforts, practical details." },
  { company: "Westbrook Market", name: "Westbrook Market", tagline: "Well-made finds for your daily routine." },
] as const;
const names = ["Alex Rivers", "Priya Shah", "Jordan Ellis", "Morgan Lee", "Casey Moore", "Taylor Green"] as const;
const categoryFixtures = ["Desk", "Travel", "Home", "Outdoors"] as const;
const productFixtures = [
  { name: "Canvas desk organiser", description: "Keep pens, notes and cables in one easy-to-reach place.", category: "Desk", price: "£18.00" },
  { name: "Compact travel pouch", description: "A light zip pouch for everyday small essentials.", category: "Travel", price: "£14.00" },
  { name: "Stoneware coffee cup", description: "A simple cup with a comfortable handle for slow mornings.", category: "Home", price: "£16.00" },
  { name: "Foldable picnic blanket", description: "A handy layer for parks, gardens and weekend trips.", category: "Outdoors", price: "£32.00" },
  { name: "Recycled paper notebook", description: "A sturdy pocket notebook for lists and quick sketches.", category: "Desk", price: "£9.00" },
  { name: "Insulated water bottle", description: "A reusable bottle sized for commutes and day trips.", category: "Travel", price: "£24.00" },
] as const;
const reviewFixtures = [
  "Arrived as described and has been useful every day.",
  "Good size and a thoughtful design. I would choose it again.",
  "The finish feels solid, and delivery was straightforward.",
  "A practical item that fits neatly into my routine.",
] as const;

function planEcommerceLab(seed: string, vulnerabilityModule: WebVulnerabilityModule): WebLabSpec {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(seed)) throw new Error("Seed must be 1–64 letters, digits, hyphens or underscores");
  const random = seededRandom(`${ecommerceV1.id}:${ecommerceV1.version}:${vulnerabilityModule.id}:${vulnerabilityModule.version}:${seed}`);
  const application = { ...random.pick(storefronts) };
  const first = random.int(names.length);
  const second = random.pick(names.map((_, index) => index).filter(index => index !== first));
  const third = random.pick(names.map((_, index) => index).filter(index => index !== first && index !== second));
  const categories: NonNullable<WebLabSpec["categories"]> = categoryFixtures.map((name, index) => ({ id: `category-${index + 1}`, name }));
  const offset = random.int(productFixtures.length);
  const products: NonNullable<WebLabSpec["products"]> = Array.from({ length: 4 }, (_, index) => {
    const fixture = productFixtures[(offset + index) % productFixtures.length];
    return {
      id: `product-${index + 1}`, name: fixture.name, description: fixture.description,
      categoryId: categories.find(category => category.name === fixture.category)!.id,
      priceDisplay: fixture.price, reviewEnabled: index === 0,
      reviews: [{ id: `review-${index + 1}`, authorId: "user-3", body: reviewFixtures[(index + random.int(reviewFixtures.length)) % reviewFixtures.length] }],
    };
  });
  const labId = stableLabId(seed, vulnerabilityModule.id, ecommerceV1.id);
  return {
    schemaVersion: 1, seed, labId, templateId: ecommerceV1.id, templateVersion: ecommerceV1.version,
    difficulty: "Beginner", durationMinutes: 30, application,
    users: [
      { id: "user-1", name: names[first], role: "customer" },
      { id: "user-2", name: names[second], role: "staff" },
      { id: "user-3", name: names[third], role: "customer" },
    ],
    session: { displayUserId: "user-1", mode: "fictional-display-only" },
    categories, products,
    routes: ecommerceV1.routes.map(path => ({ path, page: path === "/" ? "home" : path.slice(1) })),
    ...boundWebLabContract(ecommerceV1, vulnerabilityModule, "product-1", labId),
    resetState: { route: "/", query: "", completed: false },
  };
}

export function planBeginnerEcommerceReflectedXssLab(seed: string): WebLabSpec { return planEcommerceLab(seed, reflectedXssV1); }
export function planBeginnerEcommerceStoredXssLab(seed: string): WebLabSpec { return planEcommerceLab(seed, storedXssV1); }
