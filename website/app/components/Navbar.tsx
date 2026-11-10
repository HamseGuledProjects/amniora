import BrandLogo from "./BrandLogo";

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between py-8">
      <BrandLogo size="md" />

      <button className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300 hover:border-cyan-400 transition">
        MVP Build
      </button>
    </nav>
  );
}
